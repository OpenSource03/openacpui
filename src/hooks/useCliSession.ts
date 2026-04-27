import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CliSessionEvent,
  CliSessionState,
  CliStartOptions,
  CliResumeOptions,
} from "@shared/types/cli-engine";

interface UseCliSessionInput {
  /**
   * Session id of the active CLI session, or null when no CLI session is
   * active. Driving this hook off the active session id (rather than a
   * separate "engine selector") matches how useClaude / useACP / useCodex
   * are wired in `useEngineBase` — keeps the per-engine hook surface
   * uniform.
   */
  activeSessionId: string | null;
}

const INITIAL_STATE: CliSessionState = {
  sessionId: "",
  terminalId: "",
  pid: null,
  status: "starting",
  exitCode: null,
  errorMessage: null,
  ready: false,
};

/**
 * Renderer-side state mirror for the CLI engine. Most of the chat content
 * lives in the xterm buffer hosted by `<CliChatPanel>` — this hook only
 * tracks lifecycle metadata (terminalId, pid, status, errors) so the UI can
 * show "starting / running / exited / error" affordances and reattach to
 * an already-live pty after a window reload.
 *
 * No `messages` array, no `isProcessing` flag — both would lie. CLI mode
 * deliberately gives up structured chat state in exchange for full TUI
 * fidelity.
 */
export function useCliSession({ activeSessionId }: UseCliSessionInput) {
  const [state, setState] = useState<CliSessionState | null>(null);
  const stateRef = useRef<CliSessionState | null>(null);
  stateRef.current = state;
  // Eagerly tracks the sessionId we *intend* to follow during a pending
  // start/resume IPC (set synchronously before awaiting, cleared on
  // result/error). Used by the event filter so an early-arriving
  // `exited` / `spawn_failed` for a session that hasn't committed to
  // React state yet still gets routed to the right hook. Clearing it
  // once the IPC resolves prevents stale references from accepting
  // events for already-discarded sessions.
  const intendedSessionIdRef = useRef<string | null>(null);
  // Highest-priority result-state guard: setting this just before IPC
  // returns means the result-handler can also detect "we already have an
  // exited event for this sessionId; don't flip back to running".
  const exitedEarlyRef = useRef<Set<string>>(new Set());

  // Reset on session switch — the previous session's state is now stale.
  useEffect(() => {
    // Clear any pending start/resume intent that doesn't match the new
    // active session, so events for the discarded session can't slip past
    // the filter.
    if (intendedSessionIdRef.current && intendedSessionIdRef.current !== activeSessionId) {
      intendedSessionIdRef.current = null;
    }
    if (!activeSessionId) {
      setState(null);
      return;
    }
    let cancelled = false;
    void window.claude.cli.getLive(activeSessionId).then((live) => {
      if (cancelled) return;
      if (!live) {
        // No live pty for this session — wait for an explicit start/resume
        // call before flipping into the "starting" UI.
        setState(null);
        return;
      }
      setState({
        ...INITIAL_STATE,
        sessionId: activeSessionId,
        terminalId: live.terminalId,
        pid: live.pid,
        status: "running",
        ready: true,
      });
    }).catch(() => {
      if (cancelled) return;
      setState(null);
    });
    return () => { cancelled = true; };
  }, [activeSessionId]);

  // Subscribe to lifecycle events for the active session. We filter every
  // event by sessionId — including spawned/resumed — so that a CLI session
  // started in another window/tab can't overwrite our state. Without this,
  // a stray cli:event would clobber the panel.
  //
  // Filter checks against three sources, ordered most-eager first:
  //   1. intendedSessionIdRef — set synchronously by start/resume before
  //      the IPC promise resolves; covers the early-event race where an
  //      `exited` arrives during the IPC await window before React has
  //      committed the placeholder state.
  //   2. stateRef.current.sessionId — for the steady-state path.
  //   3. activeSessionId — argument from the layout, useful as a final
  //      backstop on remount when stateRef has been wiped.
  useEffect(() => {
    const unsubscribe = window.claude.cli.onEvent((event: CliSessionEvent) => {
      const idsToMatch = new Set<string>();
      if (intendedSessionIdRef.current) idsToMatch.add(intendedSessionIdRef.current);
      if (stateRef.current?.sessionId) idsToMatch.add(stateRef.current.sessionId);
      if (activeSessionId) idsToMatch.add(activeSessionId);
      const eventSessionId = event.type === "session_identified"
        ? event.provisionalSessionId
        : event.sessionId;
      if (!idsToMatch.has(eventSessionId)) return;

      // Early-exit guard: if an exit/failure event is fired before
      // start()/resume() has committed the running state, mark this
      // sessionId as already-exited so the IPC result handler doesn't
      // overwrite the dead state with a phantom "running".
      if (
        event.type === "exited" ||
        event.type === "spawn_failed" ||
        event.type === "resume_failed"
      ) {
        exitedEarlyRef.current.add(eventSessionId);
      }
      setState((prev) => {
        switch (event.type) {
          case "spawned":
          case "resumed":
            return {
              sessionId: event.sessionId,
              terminalId: event.terminalId,
              pid: event.pid,
              status: "running",
              exitCode: null,
              errorMessage: null,
              ready: prev?.ready ?? false,
            };
          case "session_identified":
            // Forked session got its real id — rekey local state.
            if (!prev) return prev;
            return { ...prev, sessionId: event.sessionId };
          case "spawn_failed":
          case "resume_failed":
            return {
              sessionId: event.sessionId,
              terminalId: event.terminalId ?? prev?.terminalId ?? "",
              pid: event.pid ?? prev?.pid ?? null,
              status: "error",
              exitCode: null,
              errorMessage: event.error,
              ready: false,
            };
          case "exited":
            if (!prev) return prev;
            return {
              ...prev,
              status: "exited",
              exitCode: event.code,
            };
          default: {
            // exhaustive check — adding a new event type without handling
            // it here will surface as a tsc error.
            const _exhaustive: never = event;
            void _exhaustive;
            return prev;
          }
        }
      });
    });
    return unsubscribe;
  }, [activeSessionId]);

  // Set the running state directly off the start/resume IPC result rather
  // than relying on the spawned/resumed event arriving after React has
  // committed the placeholder state. Without this, the event filter can
  // drop the very first event because stateRef hasn't been populated yet,
  // leaving the panel stuck on "Starting claude…". The event handler
  // itself remains as a fallback for late-arriving events (and for the
  // exit/error event chain which always comes through cli:event).
  //
  // Race guard: the CLI process can also exit *during* the IPC await
  // window (bad flag, immediate auth failure). When that happens, the
  // event subscription marks the sessionId in `exitedEarlyRef` so the
  // result handler below knows not to overwrite the dead state.
  const start = useCallback(async (opts: CliStartOptions) => {
    intendedSessionIdRef.current = opts.sessionId;
    exitedEarlyRef.current.delete(opts.sessionId);
    setState({ ...INITIAL_STATE, sessionId: opts.sessionId });
    try {
      const result = await window.claude.cli.start(opts);
      if (!result.ok) {
        setState({
          ...INITIAL_STATE,
          sessionId: opts.sessionId,
          status: "error",
          errorMessage: result.error,
        });
        return result;
      }
      if (exitedEarlyRef.current.has(result.sessionId)) {
        // Exit event already arrived & set the state — don't clobber it.
        return result;
      }
      setState((prev) => ({
        ...INITIAL_STATE,
        sessionId: result.sessionId,
        terminalId: result.terminalId,
        pid: result.pid,
        status: "running",
        ready: prev?.ready ?? false,
      }));
      return result;
    } finally {
      // Always clear the intended id once the IPC settles. Without this,
      // stale ids accumulate across multiple start calls and the event
      // filter starts accepting events for long-discarded sessions.
      if (intendedSessionIdRef.current === opts.sessionId) {
        intendedSessionIdRef.current = null;
      }
    }
  }, []);

  const resume = useCallback(async (opts: CliResumeOptions) => {
    intendedSessionIdRef.current = opts.sessionId;
    exitedEarlyRef.current.delete(opts.sessionId);
    setState({ ...INITIAL_STATE, sessionId: opts.sessionId });
    try {
      const result = await window.claude.cli.resume(opts);
      if (!result.ok) {
        setState({
          ...INITIAL_STATE,
          sessionId: opts.sessionId,
          status: "error",
          errorMessage: result.error,
        });
        return result;
      }
      if (exitedEarlyRef.current.has(result.sessionId)) {
        return result;
      }
      setState((prev) => ({
        ...INITIAL_STATE,
        sessionId: result.sessionId,
        terminalId: result.terminalId,
        pid: result.pid,
        status: "running",
        ready: prev?.ready ?? false,
      }));
      return result;
    } finally {
      if (intendedSessionIdRef.current === opts.sessionId) {
        intendedSessionIdRef.current = null;
      }
    }
  }, []);

  const stop = useCallback(async (sessionId: string) => {
    return await window.claude.cli.stop(sessionId);
  }, []);

  /**
   * Mark `ready=true` once the first non-empty stdout chunk arrives.
   * Called by `<CliChatPanel>` from its terminal:data handler so the
   * "starting…" overlay can disappear at the right moment.
   */
  const markReady = useCallback(() => {
    setState((prev) => (prev && !prev.ready ? { ...prev, ready: true } : prev));
  }, []);

  return { state, start, resume, stop, markReady };
}
