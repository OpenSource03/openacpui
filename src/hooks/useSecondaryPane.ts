/**
 * useSecondaryPane — manages the right-side chat pane in split-chat mode.
 *
 * Runs independent engine hooks (useClaude / useACP / useCodex) for whatever
 * session is assigned to pane 1.  The primary useSessionManager is untouched;
 * this hook is composed separately in useAppOrchestrator.
 *
 * Design: each engine hook filters IPC events by _sessionId, so having two
 * useClaude instances active simultaneously is safe — they never cross-talk.
 */

import { useState, useCallback, useMemo, useRef } from "react";
import type { ChatSession, UIMessage, PermissionRequest, EngineId } from "@/types";
import type { AppPermissionBehavior } from "@/types";
import type { BackgroundSessionState } from "@/lib/background-session-store";
import { useClaude } from "./useClaude";
import { useACP } from "./useACP";
import { useCodex } from "./useCodex";

export interface SecondaryPaneState {
  /** The session ID currently shown in pane 1 (null = pane is empty) */
  sessionId: string | null;
  /** The ChatSession object for pane 1 (derived from sessions list) */
  session: ChatSession | null;
  /** Messages for pane 1 */
  messages: UIMessage[];
  /** Whether pane 1 is actively processing (streaming / waiting) */
  isProcessing: boolean;
  /** Whether the underlying engine process is connected */
  isConnected: boolean;
  /** Pending tool-permission request for pane 1 */
  pendingPermission: PermissionRequest | null;
  /** Respond to a pending permission in pane 1 */
  respondPermission: (behavior: AppPermissionBehavior, updatedInput?: Record<string, unknown>, newMode?: string, updatedPerms?: unknown[]) => Promise<void>;
  /** Send a message to pane 1's session */
  send: (text: string, images?: import("@/types").ImageAttachment[]) => Promise<void>;
  /** Stop the current turn in pane 1 */
  stop: () => void;
  /** Interrupt the current turn in pane 1 */
  interrupt: () => void;
  /** Switch pane 1 to a different session (loads messages from store/disk) */
  switchSecondarySession: (
    sessionId: string | null,
    sessions: ChatSession[],
    getBackgroundState: (id: string) => BackgroundSessionState | undefined,
  ) => Promise<void>;
  /** Close pane 1 (clears sessionId) */
  clearSecondarySession: () => void;
}

export function useSecondaryPane(): SecondaryPaneState {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [activeEngine, setActiveEngine] = useState<EngineId>("claude");

  // Run all three engine hooks — only the one matching activeEngine gets a non-null sessionId
  const claudeId = activeEngine === "claude" ? sessionId : null;
  const acpId = activeEngine === "acp" ? sessionId : null;
  const codexId = activeEngine === "codex" ? sessionId : null;

  const claude = useClaude({
    sessionId: claudeId,
    initialMessages: activeEngine === "claude" ? initialMessages : [],
  });

  const acp = useACP({
    sessionId: acpId,
    initialMessages: activeEngine === "acp" ? initialMessages : [],
  });

  const codex = useCodex({
    sessionId: codexId,
    initialMessages: activeEngine === "codex" ? initialMessages : [],
  });

  // Pick the active engine's state
  const engine = activeEngine === "codex" ? codex : activeEngine === "acp" ? acp : claude;

  const switchSecondarySession = useCallback(
    async (
      newSessionId: string | null,
      sessions: ChatSession[],
      getBackgroundState: (id: string) => BackgroundSessionState | undefined,
    ) => {
      if (!newSessionId) {
        setSessionId(null);
        setSession(null);
        setInitialMessages([]);
        return;
      }

      const session = sessions.find((s) => s.id === newSessionId);
      const engine: EngineId = session?.engine ?? "claude";
      setSession(session ?? null);

      // 1. Try BackgroundSessionStore first (live in-memory state, has latest msgs)
      const stored = getBackgroundState(newSessionId);
      if (stored && stored.messages.length > 0) {
        setActiveEngine(engine);
        setInitialMessages(stored.messages);
        setSessionId(newSessionId);
        return;
      }

      // 2. Fall back to persisted session on disk
      if (session) {
        try {
          const persisted = await window.claude.sessions.load(session.projectId, newSessionId);
          const msgs: UIMessage[] = persisted?.messages ?? [];
          setActiveEngine(engine);
          setInitialMessages(msgs);
          setSessionId(newSessionId);
          return;
        } catch {
          // Silently fall through — open empty pane rather than showing an error
        }
      }

      // 3. Open empty pane for sessions with no persisted history yet
      setActiveEngine(engine);
      setInitialMessages([]);
      setSessionId(newSessionId);
    },
    [],
  );

  const clearSecondarySession = useCallback(() => {
    setSessionId(null);
    setSession(null);
    setInitialMessages([]);
  }, []);

  const noopRespond: SecondaryPaneState["respondPermission"] = useCallback(async () => {}, []);
  const noopSend = useCallback(async () => {}, []);
  const noopVoid = useCallback(() => {}, []);

  const engineSendRef = useRef(engine.send);
  engineSendRef.current = engine.send;
  const stableSend = useCallback(async (text: string, images?: import("@/types").ImageAttachment[]) => {
    await engineSendRef.current(text, images);
  }, []);

  const respondPermission = "respondPermission" in engine ? engine.respondPermission : noopRespond;
  const send = "send" in engine ? stableSend : noopSend;
  const stop = "stop" in engine ? engine.stop : noopVoid;
  const interrupt = "interrupt" in engine ? engine.interrupt : noopVoid;

  return useMemo(() => ({
    sessionId,
    session,
    messages: engine.messages,
    isProcessing: engine.isProcessing,
    isConnected: engine.isConnected,
    pendingPermission: engine.pendingPermission,
    respondPermission,
    send,
    stop,
    interrupt,
    switchSecondarySession,
    clearSecondarySession,
  }), [
    sessionId, session, engine.messages, engine.isProcessing, engine.isConnected,
    engine.pendingPermission, respondPermission, send, stop, interrupt,
    switchSecondarySession, clearSecondarySession,
  ]);
}
