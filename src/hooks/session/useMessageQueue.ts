import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageAttachment, UIMessage } from "../../types";
import type { CollaborationMode } from "../../types/codex-protocol/CollaborationMode";
import { imageAttachmentsToCodexInputs } from "../../lib/codex-adapter";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { buildSdkContent } from "../../lib/protocol";
import {
  collectQueuedMessageIds,
  finalizeQueuedMessage,
  prioritizeQueuedEntry,
  removeQueuedEntry,
  removeQueuedMessage,
} from "./message-queue-utils";
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
  const inFlightQueuedIdRef = useRef<Map<string, string>>(new Map());
  const [sendNextId, setSendNextId] = useState<string | null>(null);
  const [inFlightQueuedId, setInFlightQueuedId] = useState<string | null>(null);

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

  const syncActiveQueueState = useCallback(() => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId || sessionId === DRAFT_ID) {
      setQueuedCount(0);
      setInFlightQueuedId(null);
      return;
    }
    setQueuedCount(messageQueueRef.current.get(sessionId)?.length ?? 0);
    setInFlightQueuedId(inFlightQueuedIdRef.current.get(sessionId) ?? null);
  }, [activeSessionIdRef, messageQueueRef, setQueuedCount]);

  /** Add a message to the queue and show it in chat immediately with isQueued styling */
  const enqueueMessage = useCallback((text: string, images?: ImageAttachment[], displayText?: string) => {
    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) return;

    const msgId = `user-queued-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const queue = getQueueForSession(activeId);
    queue.push({ text, images, displayText, messageId: msgId });
    syncActiveQueueState();
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
  }, [activeSessionIdRef, engine.setMessages, getQueueForSession, syncActiveQueueState]);

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

  const clearQueueForSession = useCallback((sessionId: string, targetSetMessages: typeof engine.setMessages) => {
    const queue = messageQueueRef.current.get(sessionId) ?? [];
    const queuedIds = collectQueuedMessageIds(queue, inFlightQueuedIdRef.current.get(sessionId));
    messageQueueRef.current.delete(sessionId);
    boundaryWaitRef.current.delete(sessionId);
    inFlightQueuedIdRef.current.delete(sessionId);
    if (activeSessionIdRef.current === sessionId) {
      setSendNextId(null);
    }
    syncActiveQueueState();
    if (queuedIds.size > 0) {
      targetSetMessages((prev) => prev.filter((message) => !queuedIds.has(message.id)));
    }
  }, [activeSessionIdRef, engine.setMessages, messageQueueRef, syncActiveQueueState]);

  /** Clear the entire queue and remove queued messages from chat */
  const clearQueue = useCallback(() => {
    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) {
      setQueuedCount(0);
      setInFlightQueuedId(null);
      return;
    }

    clearQueueForSession(activeId, engine.setMessages);
  }, [activeSessionIdRef, clearQueueForSession, engine.setMessages, setQueuedCount]);

  const drainNextQueuedMessage = useCallback(async () => {
    if (isDrainingRef.current) return;
    if (engine.isProcessing) return;

    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) return;
    if (!liveSessionIdsRef.current.has(activeId)) return;
    if (inFlightQueuedIdRef.current.has(activeId)) return;
    const queue = messageQueueRef.current.get(activeId);
    if (!queue || queue.length === 0) return;

    const sessionEngine = sessionsRef.current.find((s) => s.id === activeId)?.engine ?? "claude";
    const targetSetMessages = sessionEngine === "codex" ? codex.setMessages : sessionEngine === "acp" ? acp.setMessages : claude.setMessages;
    const targetSetIsProcessing = sessionEngine === "codex" ? codex.setIsProcessing : sessionEngine === "acp" ? acp.setIsProcessing : claude.setIsProcessing;

    const next = queue[0]!;
    inFlightQueuedIdRef.current.set(activeId, next.messageId);
    syncActiveQueueState();
    isDrainingRef.current = true;

    const handleSendError = (message = "Failed to send queued message.") => {
      const currentQueue = messageQueueRef.current.get(activeId) ?? [];
      const nextQueue = removeQueuedEntry(currentQueue, next.messageId);
      if (nextQueue.length > 0) {
        messageQueueRef.current.set(activeId, nextQueue);
      } else {
        messageQueueRef.current.delete(activeId);
        boundaryWaitRef.current.delete(activeId);
      }
      inFlightQueuedIdRef.current.delete(activeId);
      setSendNextId((prev) => prev === next.messageId ? null : prev);
      syncActiveQueueState();
      targetSetMessages((prev) => removeQueuedMessage(prev, next.messageId));
      targetSetMessages((prev) => [
        ...prev,
        {
          id: `system-send-error-${Date.now()}`,
          role: "system" as const,
          content: message,
          isError: true,
          timestamp: Date.now(),
        },
      ]);
      targetSetIsProcessing(false);
    };

    const finalizeQueuedSend = () => {
      const currentQueue = messageQueueRef.current.get(activeId) ?? [];
      const nextQueue = removeQueuedEntry(currentQueue, next.messageId);
      if (nextQueue.length > 0) {
        messageQueueRef.current.set(activeId, nextQueue);
      } else {
        messageQueueRef.current.delete(activeId);
        boundaryWaitRef.current.delete(activeId);
      }
      inFlightQueuedIdRef.current.delete(activeId);
      setSendNextId((prev) => prev === next.messageId ? null : prev);
      syncActiveQueueState();
      targetSetMessages((prev) => finalizeQueuedMessage(prev, next.messageId));
    };

    try {
      if (sessionEngine === "acp") {
        targetSetIsProcessing(true);
        const result = await window.claude.acp.prompt(activeId, next.text, next.images);
        if (result?.error) handleSendError();
        else finalizeQueuedSend();
      } else if (sessionEngine === "codex") {
        targetSetIsProcessing(true);
        const session = sessionsRef.current.find((s) => s.id === activeId);
        let codexCollabMode: CollaborationMode | undefined;
        try {
          codexCollabMode = buildCodexCollabMode(startOptionsRef.current.planMode, session?.model);
        } catch (err) {
          handleSendError(err instanceof Error ? err.message : String(err));
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
        else finalizeQueuedSend();
      } else {
        targetSetIsProcessing(true);
        const content = buildSdkContent(next.text, next.images);
        const result = await window.claude.send(activeId, {
          type: "user",
          message: { role: "user", content },
        });
        if (result?.error || result?.ok === false) handleSendError();
        else finalizeQueuedSend();
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
    clearQueueForSession,
    codex.setIsProcessing,
    codex.setMessages,
    codexEffortRef,
    engine.isProcessing,
    engine.setMessages,
    liveSessionIdsRef,
    messageQueueRef,
    sessionsRef,
    startOptionsRef,
    syncActiveQueueState,
  ]);

  const sendQueuedMessageNext = useCallback(async (messageId: string) => {
    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) return;

    const queue = messageQueueRef.current.get(activeId) ?? [];
    const reorderedQueue = prioritizeQueuedEntry(queue, messageId);
    if (reorderedQueue === queue && queue[0]?.messageId !== messageId) return;
    if (reorderedQueue !== queue) {
      messageQueueRef.current.set(activeId, reorderedQueue);
    }
    setSendNextId(messageId);
    syncActiveQueueState();
    reorderQueuedMessagesInUI((reorderedQueue !== queue ? reorderedQueue : queue).map((entry) => entry.messageId));

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
    syncActiveQueueState,
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
      setInFlightQueuedId(null);
      boundaryWaitRef.current.clear();
      return;
    }
    syncActiveQueueState();
  }, [activeSessionId, messageQueueRef, setQueuedCount, syncActiveQueueState]);

  useEffect(() => {
    if (engine.isProcessing) return;
    void drainNextQueuedMessage();
  }, [activeSessionId, drainNextQueuedMessage, engine.isProcessing]);

  return { enqueueMessage, clearQueue, sendQueuedMessageNext, sendNextId, inFlightQueuedId };
}
