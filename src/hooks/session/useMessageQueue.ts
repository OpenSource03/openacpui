import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineId, ImageAttachment, UIMessage } from "../../types";
import type { CollaborationMode } from "../../types/codex-protocol/CollaborationMode";
import { imageAttachmentsToCodexInputs } from "../../lib/engine/codex-adapter";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { buildSdkContent } from "../../lib/engine/protocol";
import { createSystemMessage } from "../../lib/message-factory";
import { buildCodexCollabMode, DRAFT_ID } from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks, QueuedMessage } from "./types";

interface UseMessageQueueParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  activeSessionId: string | null;
}

type BoundaryWaitState =
  | { kind: "after_stream" }
  | { kind: "after_tool"; pendingToolMessageIdsAtClick: string[] }
  | { kind: "asap" };

export function useMessageQueue({ refs, setters, engines, activeSessionId }: UseMessageQueueParams) {
  const { claude, acp, codex, engine } = engines;
  const { setQueuedCount } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    messageQueueRef,
    messagesRef,
    startOptionsRef,
    codexEffortRef,
  } = refs;
  const drainingSessionIdsRef = useRef<Set<string>>(new Set());
  const boundaryWaitRef = useRef<Map<string, BoundaryWaitState>>(new Map());
  // Guards against draining with stale isProcessing from the previous session.
  // When activeSessionId changes, engine.isProcessing still reflects the OLD session's
  // value until useEngineBase's reset effect runs — which happens AFTER the drain effect.
  const sessionSwitchGuardRef = useRef(false);
  const [switchDrainRetryTick, setSwitchDrainRetryTick] = useState(0);
  const [sendNextId, setSendNextId] = useState<string | null>(null);

  const getPendingToolMessageIds = useCallback((messages: UIMessage[]) => {
    const ids: string[] = [];
    for (const m of messages) {
      if (m.role === "tool_call" && !m.toolResult && !m.toolError) ids.push(m.id);
    }
    return ids;
  }, []);

  const isToolMessageStillPending = useCallback((messages: UIMessage[], messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || msg.role !== "tool_call") return false;
    return !msg.toolResult && !msg.toolError;
  }, []);

  const hasStreamingAssistant = useCallback((messages: UIMessage[]) => {
    for (const m of messages) {
      if (m.role === "assistant" && m.isStreaming) return true;
    }
    return false;
  }, []);

  const getQueueForSession = useCallback((sessionId: string): QueuedMessage[] => {
    const existing = messageQueueRef.current.get(sessionId);
    if (existing) return existing;
    const created: QueuedMessage[] = [];
    messageQueueRef.current.set(sessionId, created);
    return created;
  }, [messageQueueRef]);

  const getSessionEngine = useCallback((sessionId: string) => {
    return sessionsRef.current.find((s) => s.id === sessionId)?.engine ?? "claude";
  }, [sessionsRef]);

  const reorderSentQueuedMessage = useCallback((prev: UIMessage[], messageId: string) => {
    const index = prev.findIndex((m) => m.id === messageId);
    if (index < 0) return prev;
    const sentMessage = { ...prev[index], isQueued: false };
    const rest = prev.filter((m) => m.id !== messageId);
    const nonQueued = rest.filter((m) => !m.isQueued);
    const queued = rest.filter((m) => m.isQueued);
    return [...nonQueued, sentMessage, ...queued];
  }, []);

  const updateSessionMessages = useCallback((
    sessionId: string,
    sessionEngine: EngineId,
    updater: (prev: UIMessage[]) => UIMessage[],
  ) => {
    // CLI engine has no React-controlled message list (chat lives in
    // xterm), so message-queue helpers are no-ops for it.
    if (sessionEngine === "cli") return;
    if (sessionId === activeSessionIdRef.current) {
      const targetSetMessages = sessionEngine === "codex"
        ? codex.setMessages
        : sessionEngine === "acp"
          ? acp.setMessages
          : claude.setMessages;
      targetSetMessages(updater);
      return;
    }
    backgroundStoreRef.current.updateMessages(sessionId, updater);
  }, [activeSessionIdRef, acp.setMessages, backgroundStoreRef, claude.setMessages, codex.setMessages]);

  const setSessionProcessing = useCallback((
    sessionId: string,
    sessionEngine: EngineId,
    isProcessing: boolean,
  ) => {
    if (sessionEngine === "cli") return;
    if (sessionId === activeSessionIdRef.current) {
      const targetSetIsProcessing = sessionEngine === "codex"
        ? codex.setIsProcessing
        : sessionEngine === "acp"
          ? acp.setIsProcessing
          : claude.setIsProcessing;
      targetSetIsProcessing(isProcessing);
      return;
    }
    backgroundStoreRef.current.setProcessing(sessionId, isProcessing);
  }, [activeSessionIdRef, acp.setIsProcessing, backgroundStoreRef, claude.setIsProcessing, codex.setIsProcessing]);

  const clearQueueForSession = useCallback((sessionId: string) => {
    if (!sessionId || sessionId === DRAFT_ID) {
      if (sessionId === activeSessionIdRef.current) {
        setQueuedCount(0);
      }
      return;
    }

    const queue = messageQueueRef.current.get(sessionId) ?? [];
    const queuedIds = new Set(queue.map((q) => q.messageId));
    messageQueueRef.current.delete(sessionId);
    boundaryWaitRef.current.delete(sessionId);
    drainingSessionIdsRef.current.delete(sessionId);
    setSendNextId((prev) => (prev && queuedIds.has(prev) ? null : prev));
    if (sessionId === activeSessionIdRef.current) {
      setQueuedCount(0);
    }
    if (queuedIds.size === 0) return;

    const sessionEngine = getSessionEngine(sessionId);
    updateSessionMessages(sessionId, sessionEngine, (prev) => prev.filter((m) => !queuedIds.has(m.id)));
  }, [
    activeSessionIdRef,
    getSessionEngine,
    messageQueueRef,
    setQueuedCount,
    updateSessionMessages,
  ]);

  /** Add a message to the queue and show it in chat immediately with isQueued styling */
  const enqueueMessage = useCallback((text: string, images?: ImageAttachment[], displayText?: string) => {
    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) return;

    const msgId = `user-queued-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const queue = getQueueForSession(activeId);
    queue.push({ text, images, displayText, messageId: msgId });
    setQueuedCount(queue.length);
    engine.setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        role: "user" as const,
        content: text,
        timestamp: Date.now(),
        isQueued: true,
        ...(images?.length ? { images } : {}),
        ...(displayText ? { displayContent: displayText } : {}),
      },
    ]);
  }, [activeSessionIdRef, engine.setMessages, getQueueForSession, setQueuedCount]);

  const reorderQueuedMessagesInUI = useCallback((orderedMessageIds: string[]) => {
    const rank = new Map<string, number>();
    for (let i = 0; i < orderedMessageIds.length; i++) {
      rank.set(orderedMessageIds[i], i);
    }

    engine.setMessages((prev) => {
      const nonQueued: UIMessage[] = [];
      const queued: UIMessage[] = [];
      for (const message of prev) {
        if (message.isQueued) {
          queued.push(message);
        } else {
          nonQueued.push(message);
        }
      }
      if (queued.length <= 1) return prev;

      queued.sort((a, b) => {
        const aRank = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bRank = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) return aRank - bRank;
        return a.timestamp - b.timestamp;
      });

      return [...nonQueued, ...queued];
    });
  }, [engine.setMessages]);

  /** Clear the entire queue and remove queued messages from chat */
  const clearQueue = useCallback(() => {
    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) {
      setQueuedCount(0);
      return;
    }
    clearQueueForSession(activeId);
  }, [activeSessionIdRef, clearQueueForSession, setQueuedCount]);

  const drainQueuedMessageForSession = useCallback(async (sessionId: string) => {
    if (!sessionId || sessionId === DRAFT_ID) return false;
    if (drainingSessionIdsRef.current.has(sessionId)) return false;
    if (!liveSessionIdsRef.current.has(sessionId)) return false;

    const isActiveSession = sessionId === activeSessionIdRef.current;
    const sessionProcessing = isActiveSession
      ? engine.isProcessing
      : (backgroundStoreRef.current.get(sessionId)?.isProcessing ?? false);
    if (sessionProcessing) return false;

    const queue = messageQueueRef.current.get(sessionId);
    if (!queue || queue.length === 0) return false;

    const sessionEngine = getSessionEngine(sessionId);
    const next = queue.shift()!;
    if (queue.length === 0) {
      messageQueueRef.current.delete(sessionId);
      boundaryWaitRef.current.delete(sessionId);
    }
    setSendNextId((prev) => prev === next.messageId ? null : prev);
    if (isActiveSession) {
      setQueuedCount(queue.length);
    }
    drainingSessionIdsRef.current.add(sessionId);

    updateSessionMessages(sessionId, sessionEngine, (prev) => reorderSentQueuedMessage(prev, next.messageId));

    const handleSendError = (message = "Failed to send queued message.") => {
      // Preserve remaining queued messages — only the failed one should drop.
      // The old behavior (clearQueueForSession) wiped the entire queue even if
      // only a single send failed, losing work the user had queued up.
      const currentQueue = messageQueueRef.current.get(sessionId) ?? [];
      const remainingQueue = currentQueue.filter((q) => q.messageId !== next.messageId);
      if (remainingQueue.length > 0) {
        messageQueueRef.current.set(sessionId, remainingQueue);
      } else {
        messageQueueRef.current.delete(sessionId);
        boundaryWaitRef.current.delete(sessionId);
      }
      setSendNextId((prev) => prev === next.messageId ? null : prev);
      if (sessionId === activeSessionIdRef.current) {
        setQueuedCount(remainingQueue.length);
      }
      updateSessionMessages(sessionId, sessionEngine, (prev) => {
        const withoutFailed = prev.filter((m) => m.id !== next.messageId);
        return [
          ...withoutFailed,
          createSystemMessage(message, true),
        ];
      });
      setSessionProcessing(sessionId, sessionEngine, false);
    };

    try {
      if (sessionEngine === "cli") {
        // CLI sessions don't go through the message queue — the user types
        // directly into the CLI's own xterm prompt. If we somehow get here,
        // drop the queued message rather than fall through to the SDK send
        // path. (`liveSessionIdsRef` doesn't track CLI sessions either, so
        // this branch is also gated upstream by `liveSessionIdsRef.has(id)`.)
        return false;
      } else if (sessionEngine === "acp") {
        setSessionProcessing(sessionId, sessionEngine, true);
        const result = await window.claude.acp.prompt(sessionId, next.text, next.images);
        if (result?.error) handleSendError("Failed to send queued message.");
      } else if (sessionEngine === "codex") {
        setSessionProcessing(sessionId, sessionEngine, true);
        const session = sessionsRef.current.find((s) => s.id === sessionId);
        let codexCollabMode: CollaborationMode | undefined;
        try {
          codexCollabMode = buildCodexCollabMode(startOptionsRef.current.planMode, session?.model);
        } catch (err) {
          // Use the same preserve-remaining-queue semantics as handleSendError.
          // A misconfigured plan mode for one message shouldn't nuke the rest.
          handleSendError(err instanceof Error ? err.message : String(err));
          return false;
        }
        const result = await window.claude.codex.send(
          sessionId,
          next.text,
          imageAttachmentsToCodexInputs(next.images),
          codexEffortRef.current,
          codexCollabMode,
        );
        if (result?.error) handleSendError("Failed to send queued message.");
      } else {
        setSessionProcessing(sessionId, sessionEngine, true);
        const content = buildSdkContent(next.text, next.images);
        const result = await window.claude.send(sessionId, {
          type: "user",
          message: { role: "user", content },
        });
        if (result?.error || result?.ok === false) handleSendError("Failed to send queued message.");
      }
      return true;
    } catch {
      handleSendError("Failed to send queued message.");
      return false;
    } finally {
      drainingSessionIdsRef.current.delete(sessionId);
    }
  }, [
    activeSessionIdRef,
    backgroundStoreRef,
    clearQueueForSession,
    codexEffortRef,
    engine.isProcessing,
    getSessionEngine,
    liveSessionIdsRef,
    messageQueueRef,
    reorderSentQueuedMessage,
    sessionsRef,
    setQueuedCount,
    setSessionProcessing,
    startOptionsRef,
    updateSessionMessages,
  ]);

  const drainNextQueuedMessage = useCallback(async () => {
    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) return false;
    return drainQueuedMessageForSession(activeId);
  }, [activeSessionIdRef, drainQueuedMessageForSession]);

  const continueQueuedBackgroundSession = useCallback((sessionId: string) => {
    if (!sessionId || sessionId === DRAFT_ID) return false;
    if (sessionId === activeSessionIdRef.current) return false;
    if (drainingSessionIdsRef.current.has(sessionId)) return false;
    if (!liveSessionIdsRef.current.has(sessionId)) return false;
    if (backgroundStoreRef.current.get(sessionId)?.isProcessing) return false;
    const queue = messageQueueRef.current.get(sessionId);
    if (!queue || queue.length === 0) return false;
    void drainQueuedMessageForSession(sessionId);
    return true;
  }, [activeSessionIdRef, backgroundStoreRef, drainQueuedMessageForSession, liveSessionIdsRef, messageQueueRef]);

  const unqueueMessage = useCallback((messageId: string) => {
    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) return;

    const queue = messageQueueRef.current.get(activeId);
    if (!queue) return;

    const queueIndex = queue.findIndex((entry) => entry.messageId === messageId);
    if (queueIndex < 0) return;

    queue.splice(queueIndex, 1);
    if (queue.length === 0) {
      messageQueueRef.current.delete(activeId);
      boundaryWaitRef.current.delete(activeId);
    } else if (sendNextId === messageId) {
      boundaryWaitRef.current.delete(activeId);
    }

    setSendNextId((prev) => prev === messageId ? null : prev);
    setQueuedCount(queue.length);
    engine.setMessages((prev) => prev.filter((message) => message.id !== messageId));
  }, [
    activeSessionIdRef,
    engine.setMessages,
    messageQueueRef,
    sendNextId,
    setQueuedCount,
  ]);

  const sendQueuedMessageNext = useCallback(async (messageId: string) => {
    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) return;

    const queue = messageQueueRef.current.get(activeId) ?? [];
    const queueIndex = queue.findIndex((entry) => entry.messageId === messageId);
    if (queueIndex < 0) return;

    if (queueIndex > 0) {
      const [selected] = queue.splice(queueIndex, 1);
      queue.unshift(selected);
    }
    setSendNextId(messageId);
    setQueuedCount(queue.length);
    reorderQueuedMessagesInUI(queue.map((entry) => entry.messageId));

    // Boundary-aware behavior:
    // 1) never interrupt while currently streaming assistant text
    // 2) when in tools phase, interrupt once at least one pending tool completes
    // 3) otherwise interrupt on the next safe processing gap
    if (engine.isProcessing) {
      const currentMessages = messagesRef.current;
      const pendingToolMessageIds = getPendingToolMessageIds(currentMessages);
      const waitState: BoundaryWaitState = hasStreamingAssistant(currentMessages)
        ? { kind: "after_stream" }
        : pendingToolMessageIds.length > 0
          ? { kind: "after_tool", pendingToolMessageIdsAtClick: pendingToolMessageIds }
          : { kind: "asap" };
      boundaryWaitRef.current.set(activeId, waitState);
      return;
    }

    if (!liveSessionIdsRef.current.has(activeId)) return;
    await drainNextQueuedMessage();
  }, [
    activeSessionIdRef,
    drainNextQueuedMessage,
    engine.isProcessing,
    getPendingToolMessageIds,
    hasStreamingAssistant,
    liveSessionIdsRef,
    messagesRef,
    messageQueueRef,
    reorderQueuedMessagesInUI,
    setQueuedCount,
  ]);

  useEffect(() => {
    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) return;
    const waitState = boundaryWaitRef.current.get(activeId);
    if (!waitState) return;
    if (!engine.isProcessing) {
      boundaryWaitRef.current.delete(activeId);
      return;
    }
    if (!liveSessionIdsRef.current.has(activeId)) {
      boundaryWaitRef.current.delete(activeId);
      return;
    }

    const currentMessages = messagesRef.current;
    const streaming = hasStreamingAssistant(currentMessages);
    let shouldInterrupt = false;
    if (!streaming) {
      if (waitState.kind === "after_stream") shouldInterrupt = true;
      else if (waitState.kind === "after_tool") {
        shouldInterrupt = waitState.pendingToolMessageIdsAtClick.some(
          (messageId) => !isToolMessageStillPending(currentMessages, messageId),
        );
      }
      else shouldInterrupt = true;
    }
    if (!shouldInterrupt) return;

    boundaryWaitRef.current.delete(activeId);
    const sessionEngine = sessionsRef.current.find((s) => s.id === activeId)?.engine ?? "claude";
    suppressNextSessionCompletion(activeId);
    if (sessionEngine === "acp") {
      void window.claude.acp.cancel(activeId);
    } else if (sessionEngine === "codex") {
      void window.claude.codex.interrupt(activeId);
    } else {
      void window.claude.interrupt(activeId);
    }
  }, [
    activeSessionId,
    activeSessionIdRef,
    engine.isProcessing,
    engine.messages,
    isToolMessageStillPending,
    hasStreamingAssistant,
    liveSessionIdsRef,
    messagesRef,
    sessionsRef,
  ]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID) {
      setQueuedCount(0);
      setSendNextId(null);
      boundaryWaitRef.current.clear();
      return;
    }
    setQueuedCount(messageQueueRef.current.get(activeSessionId)?.length ?? 0);
  }, [activeSessionId, messageQueueRef, setQueuedCount]);

  // Mark session switches so the drain effect below skips one cycle.
  // Also bump a retry tick so we always get a second pass after the new
  // session state's reset effect has had a chance to settle, even when the
  // restored session is already idle and `isProcessing` stays false.
  // Declared BEFORE the drain effect so it runs first (React fires effects in declaration order).
  useEffect(() => {
    sessionSwitchGuardRef.current = true;
    setSwitchDrainRetryTick((prev) => prev + 1);
  }, [activeSessionId]);

  useEffect(() => {
    // Skip drain on the render where activeSessionId just changed — engine.isProcessing
    // is still stale from the previous session and would incorrectly trigger the drain.
    if (sessionSwitchGuardRef.current) {
      sessionSwitchGuardRef.current = false;
      return;
    }
    if (engine.isProcessing) return;
    void drainNextQueuedMessage();
  }, [activeSessionId, drainNextQueuedMessage, engine.isProcessing, switchDrainRetryTick]);

  return {
    enqueueMessage,
    clearQueue,
    unqueueMessage,
    sendQueuedMessageNext,
    continueQueuedBackgroundSession,
    sendNextId,
  };
}
