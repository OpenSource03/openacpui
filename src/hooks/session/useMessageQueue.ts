import { useCallback, useEffect } from "react";
import type { ImageAttachment } from "../../types";
import type { CollaborationMode } from "../../types/codex-protocol/CollaborationMode";
import { imageAttachmentsToCodexInputs } from "../../lib/codex-adapter";
import { buildSdkContent } from "../../lib/protocol";
import { buildCodexCollabMode, DRAFT_ID } from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks } from "./types";

interface UseMessageQueueParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
}

export function useMessageQueue({ refs, setters, engines }: UseMessageQueueParams) {
  const { claude, acp, codex, engine } = engines;
  const { setQueuedCount } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    liveSessionIdsRef,
    messageQueueRef,
    startOptionsRef,
    codexEffortRef,
  } = refs;

  /** Add a message to the queue and show it in chat immediately with isQueued styling */
  const enqueueMessage = useCallback((text: string, images?: ImageAttachment[], displayText?: string) => {
    const msgId = `user-queued-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    messageQueueRef.current.push({ text, images, displayText, messageId: msgId });
    setQueuedCount(messageQueueRef.current.length);
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
  }, [engine.setMessages]);

  /** Clear the entire queue and remove queued messages from chat */
  const clearQueue = useCallback(() => {
    const queuedIds = new Set(messageQueueRef.current.map((q) => q.messageId));
    messageQueueRef.current = [];
    setQueuedCount(0);
    if (queuedIds.size > 0) {
      engine.setMessages((prev) => prev.filter((m) => !queuedIds.has(m.id)));
    }
  }, [engine.setMessages]);

  // Drain one queued message when the current turn completes.
  // Uses engine-specific setMessages (not `engine.setMessages`) to avoid stale closure
  // if the active engine reference changes between renders.
  useEffect(() => {
    if (engine.isProcessing) return;
    if (messageQueueRef.current.length === 0) return;
    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) return;
    if (!liveSessionIdsRef.current.has(activeId)) return;

    const next = messageQueueRef.current.shift()!;
    setQueuedCount(messageQueueRef.current.length);

    const sessionEngine = sessionsRef.current.find((s) => s.id === activeId)?.engine ?? "claude";
    // Pick the correct engine's setMessages to avoid stale closure
    const targetSetMessages = sessionEngine === "codex" ? codex.setMessages : sessionEngine === "acp" ? acp.setMessages : claude.setMessages;
    const targetSetIsProcessing = sessionEngine === "codex" ? codex.setIsProcessing : sessionEngine === "acp" ? acp.setIsProcessing : claude.setIsProcessing;

    // Clear isQueued flag on the message already in chat
    targetSetMessages((prev) =>
      prev.map((m) => (m.id === next.messageId ? { ...m, isQueued: false } : m)),
    );

    /** Show error + clear remaining queue on send failure */
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

    if (sessionEngine === "acp") {
      acp.setIsProcessing(true);
      window.claude.acp.prompt(activeId, next.text, next.images).then((result) => {
        if (result?.error) handleSendError();
      }).catch(handleSendError);
    } else if (sessionEngine === "codex") {
      codex.setIsProcessing(true);
      // Pass collaborationMode when plan mode is active so Codex server enters plan mode
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
      window.claude.codex.send(
        activeId,
        next.text,
        imageAttachmentsToCodexInputs(next.images),
        codexEffortRef.current,
        codexCollabMode,
      ).then((result) => {
        if (result?.error) handleSendError();
      }).catch(handleSendError);
    } else {
      claude.setIsProcessing(true);
      const content = buildSdkContent(next.text, next.images);
      window.claude.send(activeId, {
        type: "user",
        message: { role: "user", content },
      }).then((result) => {
        if (result?.error || result?.ok === false) handleSendError();
      }).catch(handleSendError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.isProcessing]);

  return { enqueueMessage, clearQueue };
}
