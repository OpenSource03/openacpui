import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageAttachment, UIMessage } from "../../types";
import type { CollaborationMode } from "../../types/codex-protocol/CollaborationMode";
import { imageAttachmentsToCodexInputs } from "../../lib/codex-adapter";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { buildSdkContent } from "../../lib/protocol";
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
    messageQueueRef,
    messagesRef,
    startOptionsRef,
    codexEffortRef,
  } = refs;
  const isDrainingRef = useRef(false);
  const boundaryWaitRef = useRef<Map<string, BoundaryWaitState>>(new Map());
  // Guards against draining with stale isProcessing from the previous session.
  // When activeSessionId changes, engine.isProcessing still reflects the OLD session's
  // value until useEngineBase's reset effect runs — which happens AFTER the drain effect.
  const sessionSwitchGuardRef = useRef(false);
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

    const queue = messageQueueRef.current.get(activeId) ?? [];
    const queuedIds = new Set(queue.map((q) => q.messageId));
    messageQueueRef.current.delete(activeId);
    boundaryWaitRef.current.delete(activeId);
    setSendNextId(null);
    setQueuedCount(0);
    if (queuedIds.size > 0) {
      engine.setMessages((prev) => prev.filter((m) => !queuedIds.has(m.id)));
    }
  }, [activeSessionIdRef, engine.setMessages, messageQueueRef, setQueuedCount]);

  const drainNextQueuedMessage = useCallback(async () => {
    if (isDrainingRef.current) return;
    if (engine.isProcessing) return;

    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) return;
    if (!liveSessionIdsRef.current.has(activeId)) return;
    const queue = messageQueueRef.current.get(activeId);
    if (!queue || queue.length === 0) return;

    const sessionEngine = sessionsRef.current.find((s) => s.id === activeId)?.engine ?? "claude";
    const targetSetMessages = sessionEngine === "codex" ? codex.setMessages : sessionEngine === "acp" ? acp.setMessages : claude.setMessages;
    const targetSetIsProcessing = sessionEngine === "codex" ? codex.setIsProcessing : sessionEngine === "acp" ? acp.setIsProcessing : claude.setIsProcessing;

    const next = queue.shift()!;
    if (queue.length === 0) {
      messageQueueRef.current.delete(activeId);
      boundaryWaitRef.current.delete(activeId);
    }
    setSendNextId((prev) => prev === next.messageId ? null : prev);
    setQueuedCount(queue.length);
    isDrainingRef.current = true;

    // Clear isQueued and move the just-sent user message to the bottom of the
    // non-queued section so it appears where it was actually sent.
    targetSetMessages((prev) => {
      const index = prev.findIndex((m) => m.id === next.messageId);
      if (index < 0) return prev;
      const sentMessage = { ...prev[index], isQueued: false };
      const rest = prev.filter((m) => m.id !== next.messageId);
      const nonQueued = rest.filter((m) => !m.isQueued);
      const queued = rest.filter((m) => m.isQueued);
      return [...nonQueued, sentMessage, ...queued];
    });

    const handleSendError = () => {
      targetSetMessages((prev) => [
        ...prev,
        {
          id: `system-send-error-${Date.now()}`,
          role: "system" as const,
          content: "Failed to send queued message.",
          isError: true,
          timestamp: Date.now(),
        },
      ]);
      targetSetIsProcessing(false);
      clearQueue();
    };

    try {
      if (sessionEngine === "acp") {
        targetSetIsProcessing(true);
        const result = await window.claude.acp.prompt(activeId, next.text, next.images);
        if (result?.error) handleSendError();
      } else if (sessionEngine === "codex") {
        targetSetIsProcessing(true);
        const session = sessionsRef.current.find((s) => s.id === activeId);
        let codexCollabMode: CollaborationMode | undefined;
        try {
          codexCollabMode = buildCodexCollabMode(startOptionsRef.current.planMode, session?.model);
        } catch (err) {
          targetSetMessages((prev) => [
            ...prev,
            {
              id: `system-send-error-${Date.now()}`,
              role: "system" as const,
              content: err instanceof Error ? err.message : String(err),
              isError: true,
              timestamp: Date.now(),
            },
          ]);
          targetSetIsProcessing(false);
          clearQueue();
          return;
        }
        const result = await window.claude.codex.send(
          activeId,
          next.text,
          imageAttachmentsToCodexInputs(next.images),
          codexEffortRef.current,
          codexCollabMode,
        );
        if (result?.error) handleSendError();
      } else {
        targetSetIsProcessing(true);
        const content = buildSdkContent(next.text, next.images);
        const result = await window.claude.send(activeId, {
          type: "user",
          message: { role: "user", content },
        });
        if (result?.error || result?.ok === false) handleSendError();
      }
    } catch {
      handleSendError();
    } finally {
      isDrainingRef.current = false;
    }
  }, [
    activeSessionIdRef,
    acp.setIsProcessing,
    acp.setMessages,
    claude.setIsProcessing,
    claude.setMessages,
    clearQueue,
    codex.setIsProcessing,
    codex.setMessages,
    codexEffortRef,
    engine.isProcessing,
    liveSessionIdsRef,
    messageQueueRef,
    sessionsRef,
    setQueuedCount,
    startOptionsRef,
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
  // Declared BEFORE the drain effect so it runs first (React fires effects in declaration order).
  useEffect(() => {
    sessionSwitchGuardRef.current = true;
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
  }, [activeSessionId, drainNextQueuedMessage, engine.isProcessing]);

  return { enqueueMessage, clearQueue, sendQueuedMessageNext, sendNextId };
}
