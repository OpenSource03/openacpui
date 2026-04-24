import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_SESSION_TERMINAL_STATE,
  parseStoredTerminalState,
  reconcileTerminalState,
  type SessionTerminalState,
  type SessionTerminalsState,
  type TerminalTab,
} from "@/lib/terminal-tabs";

export type { TerminalTab, SessionTerminalState };

const STORAGE_KEY = "harnss-session-terminals";
/**
 * Mirror of session/types.ts DRAFT_ID. Duplicated here to avoid a circular
 * import — this hook doesn't otherwise depend on session code.
 */
const DRAFT_SESSION_ID = "__draft__";

/**
 * Module-level listener list so imperative callers (session CRUD, draft
 * materialization) that sit above this hook in the component tree can drive
 * its state changes alongside the corresponding IPC calls.
 */
type Listener = {
  onDestroy: (sessionId: string) => void;
  onRemap: (fromSessionId: string, toSessionId: string) => void;
};
const listeners = new Set<Listener>();

/** Called from imperative code to notify all mounted hooks of a session delete. */
export function notifySessionTerminalsDestroyed(sessionId: string): void {
  for (const l of listeners) l.onDestroy(sessionId);
}

/** Called from imperative code to notify all mounted hooks of a session id remap. */
export function notifySessionTerminalsRemap(fromSessionId: string, toSessionId: string): void {
  for (const l of listeners) l.onRemap(fromSessionId, toSessionId);
}

export function useSessionTerminals() {
  const [stateBySession, setStateBySession] = useState<SessionTerminalsState>({});
  const [isReady, setIsReady] = useState(false);
  const stateBySessionRef = useRef(stateBySession);
  stateBySessionRef.current = stateBySession;
  const ensuringSessionIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    // One-time cleanup of the legacy space-keyed terminals blob. Its contents
    // are incompatible with the session-scoped schema and the pty processes it
    // referenced are dead anyway (pty doesn't survive app restart).
    localStorage.removeItem("harnss-space-terminals");

    const hydrate = async () => {
      const persisted = parseStoredTerminalState(localStorage.getItem(STORAGE_KEY));
      try {
        const result = await window.claude.terminal.list();
        if (cancelled) return;
        const live = result.terminals ?? [];
        setStateBySession(reconcileTerminalState(persisted, live));
      } catch {
        if (cancelled) return;
        setStateBySession({});
      } finally {
        if (!cancelled) setIsReady(true);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isReady) return;
    // Drafts are ephemeral — never persist. Prevents draft terminal tab metadata
    // from bleeding into the next draft across app restarts.
    const persistable = { ...stateBySession };
    delete persistable[DRAFT_SESSION_ID];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  }, [isReady, stateBySession]);

  // Subscribe to module-level notifications from imperative callers (session
  // CRUD / draft materialization) so state stays in sync with their IPC calls.
  useEffect(() => {
    const listener: Listener = {
      onDestroy: (sessionId) => {
        setStateBySession((prev) => {
          if (!(sessionId in prev)) return prev;
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
      },
      onRemap: (fromSessionId, toSessionId) => {
        if (fromSessionId === toSessionId) return;
        setStateBySession((prev) => {
          const src = prev[fromSessionId];
          if (!src) return prev;
          const next = { ...prev };
          delete next[fromSessionId];
          const existing = next[toSessionId];
          if (existing) {
            next[toSessionId] = {
              tabs: [...src.tabs, ...existing.tabs],
              activeTabId: src.activeTabId ?? existing.activeTabId,
            };
          } else {
            next[toSessionId] = src;
          }
          return next;
        });
      },
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const getSessionState = useCallback(
    (sessionId: string): SessionTerminalState =>
      stateBySession[sessionId] ?? EMPTY_SESSION_TERMINAL_STATE,
    [stateBySession],
  );

  const setActiveTab = useCallback((sessionId: string, tabId: string | null) => {
    setStateBySession((prev) => {
      const curr = prev[sessionId] ?? EMPTY_SESSION_TERMINAL_STATE;
      if (curr.activeTabId === tabId) return prev;
      return {
        ...prev,
        [sessionId]: {
          ...curr,
          activeTabId: tabId,
        },
      };
    });
  }, []);

  const createTerminal = useCallback(async (sessionId: string, cwd?: string) => {
    const result = await window.claude.terminal.create({
      cwd: cwd || undefined,
      cols: 80,
      rows: 24,
      sessionId,
    });
    const terminalId = result.terminalId;
    if (result.error || !terminalId) return;

    setStateBySession((prev) => {
      const curr = prev[sessionId] ?? EMPTY_SESSION_TERMINAL_STATE;
      const existing = curr.tabs.find((tab) => tab.terminalId === terminalId);
      if (existing) {
        return {
          ...prev,
          [sessionId]: {
            ...curr,
            activeTabId: existing.id,
          },
        };
      }
      const tab: TerminalTab = {
        id: terminalId,
        terminalId,
        label: `Terminal ${curr.tabs.length + 1}`,
      };
      return {
        ...prev,
        [sessionId]: {
          tabs: [...curr.tabs, tab],
          activeTabId: tab.id,
        },
      };
    });
  }, []);

  const ensureTerminal = useCallback(async (sessionId: string, cwd?: string) => {
    if (!isReady) return;
    if ((stateBySessionRef.current[sessionId]?.tabs.length ?? 0) > 0) return;
    if (ensuringSessionIdsRef.current.has(sessionId)) return;

    ensuringSessionIdsRef.current.add(sessionId);
    try {
      if ((stateBySessionRef.current[sessionId]?.tabs.length ?? 0) === 0) {
        await createTerminal(sessionId, cwd);
      }
    } finally {
      ensuringSessionIdsRef.current.delete(sessionId);
    }
  }, [createTerminal, isReady]);

  const closeTerminal = useCallback(async (sessionId: string, tabId: string) => {
    const sessionState = stateBySessionRef.current[sessionId];
    const tab = sessionState?.tabs.find((t) => t.id === tabId);
    if (tab) {
      await window.claude.terminal.destroy(tab.terminalId);
    }

    setStateBySession((prev) => {
      const curr = prev[sessionId];
      if (!curr) return prev;
      const nextTabs = curr.tabs.filter((t) => t.id !== tabId);
      const nextActiveTabId = curr.activeTabId === tabId
        ? (nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].id : null)
        : curr.activeTabId;
      return {
        ...prev,
        [sessionId]: {
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
        },
      };
    });
  }, []);

  /** Kill all pty processes for a session and drop its tab list. Called on session delete. */
  const destroySessionTerminals = useCallback(async (sessionId: string) => {
    await window.claude.terminal.destroySession(sessionId);
    setStateBySession((prev) => {
      if (!(sessionId in prev)) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  /**
   * Transfer a session's terminal tabs and pty ownership to a new session id.
   * Used when a draft session materializes into a real session — its pre-created
   * terminals (if any) carry over.
   */
  const remapSession = useCallback(async (fromSessionId: string, toSessionId: string) => {
    if (fromSessionId === toSessionId) return;
    await window.claude.terminal.remapSession(fromSessionId, toSessionId);
    setStateBySession((prev) => {
      const src = prev[fromSessionId];
      if (!src) return prev;
      const next = { ...prev };
      delete next[fromSessionId];
      const existing = next[toSessionId];
      if (existing) {
        next[toSessionId] = {
          tabs: [...src.tabs, ...existing.tabs],
          activeTabId: src.activeTabId ?? existing.activeTabId,
        };
      } else {
        next[toSessionId] = src;
      }
      return next;
    });
  }, []);

  return {
    getSessionState,
    setActiveTab,
    isReady,
    createTerminal,
    ensureTerminal,
    closeTerminal,
    destroySessionTerminals,
    remapSession,
  };
}
