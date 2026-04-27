import { startTransition, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { ChatSession, McpServerConfig, PersistedSession, Project, ACPConfigOption } from "@/types";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { capture, reportError } from "../../lib/analytics/analytics";
import { bgAgentStore } from "../../lib/background/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import { notifySessionTerminalsDestroyed } from "@/hooks/useSessionTerminals";
import {
  deleteBrowserSession,
  makeSessionBrowserPersistKey,
} from "@/components/browser/browser-utils";
import { clearAllComposerStateForSession } from "@/lib/composer-draft-storage";
import {
  DRAFT_ID,
  DEFAULT_PERMISSION_MODE,
  getEffectiveClaudePermissionMode,
} from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks, StartOptions } from "./types";

interface UseSessionCrudParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
  // From persistence
  saveCurrentSession: () => Promise<void>;
  seedBackgroundStore: () => void;
  // From draft materialization
  eagerStartSession: (projectId: string, options?: StartOptions) => Promise<void>;
  eagerStartAcpSession: (projectId: string, options?: StartOptions, overrideServers?: McpServerConfig[]) => Promise<void>;
  prefetchCodexModels: (preferredModel?: string) => Promise<void>;
  probeMcpServers: (projectId: string, overrideServers?: McpServerConfig[]) => Promise<void>;
  abandonEagerSession: (reason?: string) => void;
  abandonDraftAcpSession: (reason?: string) => void;
  // From session cache
  cacheSessionPayload: (data: PersistedSession) => void;
  consumeCachedSessionPayload: (sessionId: string) => PersistedSession | null;
  applyLoadedSession: (id: string, data: PersistedSession) => void;
  evictFromCache: (sessionId: string) => void;
  // From message queue
  clearQueue: () => void;
}

export function useSessionCrud({
  refs,
  setters,
  engines,
  findProject,
  getProjectCwd,
  saveCurrentSession,
  seedBackgroundStore,
  eagerStartSession,
  eagerStartAcpSession,
  prefetchCodexModels,
  probeMcpServers,
  abandonEagerSession,
  abandonDraftAcpSession,
  cacheSessionPayload,
  consumeCachedSessionPayload,
  applyLoadedSession,
  evictFromCache,
  clearQueue,
}: UseSessionCrudParams) {
  const { acp } = engines;
  const {
    setSessions,
    setActiveSessionId,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setInitialSlashCommands,
    setInitialPermission,
    setInitialRawAcpPermission,
    setStartOptions,
    setDraftProjectId,
    setDraftMcpStatuses,
    setAcpConfigOptionsLoading,
    setAcpMcpStatuses,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    preStartedSessionIdRef,
    draftProjectIdRef,
    startOptionsRef,
    acpAgentIdRef,
    acpAgentSessionIdRef,
    messageQueueRef,
    switchSessionRef,
    onSpaceChangeRef,
  } = refs;

  const switchRequestIdRef = useRef(0);

  const clearSessionPlanMode = useCallback((session: ChatSession) => {
    const normalizedPermissionMode = session.permissionMode?.trim() || DEFAULT_PERMISSION_MODE;

    setSessions((prev) => prev.map((entry) => (
      entry.id === session.id && entry.planMode
        ? { ...entry, planMode: false }
        : entry
    )));

    window.claude.sessions.load(session.projectId, session.id).then((data) => {
      if (!data?.planMode) return;
      return window.claude.sessions.save({ ...data, planMode: false });
    }).catch(() => { /* session may have been deleted */ });

    if ((session.engine ?? "claude") !== "claude" || !liveSessionIdsRef.current.has(session.id)) {
      return;
    }

    const effectiveMode = getEffectiveClaudePermissionMode({
      permissionMode: normalizedPermissionMode,
      planMode: false,
    });
    window.claude.setPermissionMode(session.id, effectiveMode).then((result) => {
      if (result?.error) {
        toast.error("Failed to update plan mode", { description: result.error });
      }
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to update plan mode", { description: message });
    });
  }, [liveSessionIdsRef, setSessions]);

  // ── Create a new session (draft) ──

  const createSession = useCallback(
    async (projectId: string, options?: StartOptions) => {
      abandonEagerSession("new_draft");
      abandonDraftAcpSession("new_draft");
      acpAgentIdRef.current = null;
      acpAgentSessionIdRef.current = null;
      setAcpMcpStatuses([]);
      seedBackgroundStore();
      void saveCurrentSession();
      const draftEngine = options?.engine ?? "claude";
      setStartOptions(options ?? {});
      setDraftProjectId(projectId);
      setInitialMessages([]);
      setInitialMeta(null);
      setInitialConfigOptions([]);
      setInitialSlashCommands([]);
      setAcpConfigOptionsLoading(draftEngine === "acp");
      setInitialPermission(null);
      setInitialRawAcpPermission(null);
      // Explicitly clear ACP state — when activeSessionId is already DRAFT_ID,
      // useACP's reset effect won't fire, so stale messages (e.g. from a failed start) would persist
      acp.setMessages([]);
      acp.setIsProcessing(false);
      // Discard any stale draft tool-panel customizations and pty processes
      // before entering a fresh draft. Leftovers could happen if a previous
      // draft was abandoned without either materialization or explicit cancel.
      useSettingsStore.getState().clearSessionSettings(DRAFT_ID);
      notifySessionTerminalsDestroyed(DRAFT_ID);
      void window.claude.terminal.destroySession(DRAFT_ID).catch((err) => {
        reportError("TERMINAL_DESTROY_STALE_DRAFT", err);
      });
      deleteBrowserSession(makeSessionBrowserPersistKey(DRAFT_ID));
      clearAllComposerStateForSession(DRAFT_ID);
      setActiveSessionId(DRAFT_ID);
      // Remove any leftover pending DRAFT_ID session from a previous failed ACP start
      setSessions((prev) => prev.filter(s => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })));

      if (draftEngine === "claude") {
        // Eager start for Claude engine (fire-and-forget)
        eagerStartSession(projectId, options);
        // Set immediate "pending" statuses while SDK connects
        window.claude.mcp.list(projectId).then(servers => {
          if (activeSessionIdRef.current === DRAFT_ID && draftProjectIdRef.current === projectId) {
            setDraftMcpStatuses(servers.map(s => ({
              name: s.name,
              status: "pending" as const,
            })));
          }
        }).catch(() => { /* IPC failure */ });
      } else if (draftEngine === "acp") {
        eagerStartAcpSession(projectId, options);
        probeMcpServers(projectId);
      } else if (draftEngine === "cli") {
        // CLI engine: nothing to eager-start in the draft phase. The
        // actual `claude` pty is spawned on first send (or via a
        // session-row affordance), since spawn cost is too high to do
        // speculatively for every draft.
        setDraftMcpStatuses([]);
      } else {
        // Codex: no eager start; prefetch model list for the picker.
        setDraftMcpStatuses([]);
        prefetchCodexModels(options?.model);
      }
    },
    [saveCurrentSession, seedBackgroundStore, eagerStartSession, eagerStartAcpSession, abandonEagerSession, abandonDraftAcpSession, prefetchCodexModels, probeMcpServers],
  );

  // ── Switch to an existing session ──

  const switchSession = useCallback(
    async (id: string) => {
      if (id === activeSessionIdRef.current) return;
      const requestId = ++switchRequestIdRef.current;

      abandonEagerSession("switch_session");
      abandonDraftAcpSession("switch_session");
      acpAgentIdRef.current = null;
      acpAgentSessionIdRef.current = null;
      seedBackgroundStore();
      void saveCurrentSession();

      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;
      clearSessionPlanMode(session);
      setStartOptions((prev) => ({
        ...prev,
        engine: session.engine ?? "claude",
        model: session.model,
        effort: session.effort,
        permissionMode: session.permissionMode,
        planMode: false,
        agentId: session.agentId,
      }));

      // Switch to the correct space for this session's project — ensures that
      // clicking a permission toast (or any cross-space navigation) lands in the right space
      const sessionProject = refs.projectsRef.current.find((p) => p.id === session.projectId);
      if (sessionProject) {
        onSpaceChangeRef.current?.(sessionProject.spaceId || "default");
      }

      // Restore from the in-memory session cache if available.
      const bgState = backgroundStoreRef.current.consume(id);
      if (bgState) {
        const normalizedBgSessionInfo = bgState.sessionInfo?.permissionMode === "plan"
          ? {
              ...bgState.sessionInfo,
              permissionMode: session.permissionMode?.trim() || DEFAULT_PERMISSION_MODE,
            }
          : bgState.sessionInfo;
        startTransition(() => {
          setInitialMessages(bgState.messages);
          setInitialMeta({
            isProcessing: bgState.isProcessing,
            isConnected: bgState.isConnected,
            sessionInfo: normalizedBgSessionInfo,
            totalCost: bgState.totalCost,
            contextUsage: bgState.contextUsage,
            isCompacting: bgState.isCompacting,
          });
          setInitialPermission(bgState.pendingPermission);
          setInitialRawAcpPermission(bgState.rawAcpPermission);
          setInitialSlashCommands(bgState.slashCommands ?? []);
          setActiveSessionId(id);
          setDraftProjectId(null);
          setSessions((prev) =>
            prev.filter(s => s.id !== DRAFT_ID).map((s) => ({
              ...s,
              isActive: s.id === id,
              ...(s.id === id ? { hasPendingPermission: false } : {}),
            })),
          );
        });
        toast.dismiss(`permission-${id}`);
        return;
      }

      const cachedData = consumeCachedSessionPayload(id);
      if (cachedData) {
        applyLoadedSession(id, { ...cachedData, planMode: false });
        return;
      }

      // Fall back to loading from disk (non-live session)
      const data = await window.claude.sessions.load(session.projectId, id);
      if (requestId !== switchRequestIdRef.current) return;
      if (data) {
        cacheSessionPayload({ ...data, planMode: false });
        const restored = consumeCachedSessionPayload(id);
        if (restored) {
          applyLoadedSession(id, { ...restored, planMode: false });
        }
      }
    },
    [
      abandonDraftAcpSession,
      abandonEagerSession,
      applyLoadedSession,
      cacheSessionPayload,
      consumeCachedSessionPayload,
      saveCurrentSession,
      seedBackgroundStore,
      setActiveSessionId,
      setDraftProjectId,
      setInitialMessages,
      setInitialMeta,
      setInitialPermission,
      setInitialRawAcpPermission,
      setInitialSlashCommands,
      setSessions,
      setStartOptions,
    ],
  );

  // Keep switchSessionRef in sync for stable toast callbacks
  switchSessionRef.current = switchSession;

  // ── Delete a session ──

  const deleteSession = useCallback(
    async (id: string) => {
      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;
      evictFromCache(id);
      if (liveSessionIdsRef.current.has(id)) {
        suppressNextSessionCompletion(id);
        if (session.engine === "codex") {
          await window.claude.codex.stop(id);
        } else if (session.engine === "acp") {
          await window.claude.acp.stop(id);
        } else if (session.engine === "cli") {
          await window.claude.cli.stop(id);
        } else {
          await window.claude.stop(id, "session_delete");
        }
        liveSessionIdsRef.current.delete(id);
      }
      // CLI sessions don't use liveSessionIdsRef (they're not in the SDK's
      // active-session map), but we still need to make sure the pty dies.
      // cli.stop is idempotent so calling it unconditionally is safe.
      if (session.engine === "cli") {
        await window.claude.cli.stop(id).catch(() => { /* already gone */ });
      }
      backgroundStoreRef.current.delete(id);
      messageQueueRef.current.delete(id);
      bgAgentStore.clearSession(id);
      // Dismiss any permission toast for this session
      toast.dismiss(`permission-${id}`);
      await window.claude.sessions.delete(session.projectId, id);
      // Session-scoped tool panel state is tied to session lifecycle.
      useSettingsStore.getState().clearSessionSettings(id);
      // Notify UI first (so stale tabs disappear immediately), then kill ptys.
      // destroySession is idempotent and safe to fire-and-forget.
      notifySessionTerminalsDestroyed(id);
      void window.claude.terminal.destroySession(id).catch((err) => {
        reportError("TERMINAL_DESTROY_ON_SESSION_DELETE", err);
      });
      // Drop browser tabs/URLs persisted for this session.
      deleteBrowserSession(makeSessionBrowserPersistKey(id));
      // Drop persisted composer draft (text + attachments) and grab buckets.
      clearAllComposerStateForSession(id);
      if (activeSessionIdRef.current === id) {
        clearQueue();
        setActiveSessionId(null);
        setInitialMessages([]);
        setInitialMeta(null);
        setInitialPermission(null);
        setInitialRawAcpPermission(null);
      }
      setSessions((prev) => prev.filter((s) => s.id !== id));
    },
    [clearQueue, evictFromCache],
  );

  // ── Archive / Unarchive a session ──

  /**
   * Archive a session. Stops the running agent, cleans per-session tool state
   * (pty, browser, settings slice) exactly like delete, but keeps the session
   * file on disk with archivedAt set. Sidebar filters archived sessions out of
   * the main list; the Archived view can restore them via unarchiveSession.
   */
  const archiveSession = useCallback(
    async (id: string) => {
      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;
      evictFromCache(id);
      if (liveSessionIdsRef.current.has(id)) {
        suppressNextSessionCompletion(id);
        if (session.engine === "codex") {
          await window.claude.codex.stop(id);
        } else if (session.engine === "acp") {
          await window.claude.acp.stop(id);
        } else if (session.engine === "cli") {
          await window.claude.cli.stop(id);
        } else {
          await window.claude.stop(id, "session_archive");
        }
        liveSessionIdsRef.current.delete(id);
      }
      if (session.engine === "cli") {
        await window.claude.cli.stop(id).catch(() => { /* already gone */ });
      }
      backgroundStoreRef.current.delete(id);
      messageQueueRef.current.delete(id);
      bgAgentStore.clearSession(id);
      toast.dismiss(`permission-${id}`);
      const archivedAt = Date.now();
      await window.claude.sessions.updateMeta(session.projectId, id, { archivedAt });
      useSettingsStore.getState().clearSessionSettings(id);
      notifySessionTerminalsDestroyed(id);
      void window.claude.terminal.destroySession(id).catch((err) => {
        reportError("TERMINAL_DESTROY_ON_SESSION_ARCHIVE", err);
      });
      deleteBrowserSession(makeSessionBrowserPersistKey(id));
      clearAllComposerStateForSession(id);
      if (activeSessionIdRef.current === id) {
        clearQueue();
        setActiveSessionId(null);
        setInitialMessages([]);
        setInitialMeta(null);
        setInitialPermission(null);
        setInitialRawAcpPermission(null);
      }
      // Keep the session in the in-memory list so the Archived view can
      // surface it without reloading from disk — just mark archivedAt.
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, archivedAt, isActive: false } : s)),
      );
    },
    [clearQueue, evictFromCache],
  );

  const unarchiveSession = useCallback(
    async (id: string) => {
      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;
      await window.claude.sessions.updateMeta(session.projectId, id, { archivedAt: null });
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, archivedAt: undefined } : s)),
      );
    },
    [],
  );

  // ── Rename a session ──

  const renameSession = useCallback((id: string, title: string) => {
    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title, titleGenerating: false } : s)),
    );
    window.claude.sessions.load(session.projectId, id).then((data) => {
      if (data) {
        window.claude.sessions.save({ ...data, title });
      }
    }).catch(() => { /* session may have been deleted */ });
  }, []);

  // ── Deselect the active session ──

  const deselectSession = useCallback(async () => {
    abandonEagerSession("deselect");
    abandonDraftAcpSession("deselect");
    seedBackgroundStore();
    void saveCurrentSession();
    setActiveSessionId(null);
    setDraftProjectId(null);
    setInitialMessages([]);
    setInitialMeta(null);
    setInitialPermission(null);
    setInitialRawAcpPermission(null);
    // Filter out any leftover DRAFT_ID placeholder from a pending ACP start
    setSessions((prev) => prev.filter(s => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })));
  }, [saveCurrentSession, seedBackgroundStore, abandonEagerSession, abandonDraftAcpSession]);

  // ── Import a Claude Code session ──

  const importCCSession = useCallback(
    async (projectId: string, ccSessionId: string): Promise<{ ok: true } | { error: string }> => {
      const project = findProject(projectId);
      if (!project) return { error: `Project ${projectId} not found` };

      // If already imported, just switch to it
      const existing = sessionsRef.current.find((s) => s.id === ccSessionId);
      if (existing) {
        await switchSession(ccSessionId);
        return { ok: true };
      }

      seedBackgroundStore();
      void saveCurrentSession();

      const result = await window.claude.ccSessions.import(getProjectCwd(project), ccSessionId);
      if (result.error) return { error: result.error };
      if (!result.messages) return { error: "Imported session contained no messages" };

      const firstUserMsg = result.messages.find((m) => m.role === "user");
      const titleText = firstUserMsg?.content || "Imported Session";

      const newSession: ChatSession = {
        id: ccSessionId,
        projectId: project.id,
        title: titleText.length > 60 ? titleText.slice(0, 57) + "..." : titleText,
        createdAt: result.messages[0]?.timestamp || Date.now(),
        totalCost: 0,
        isActive: true,
      };

      // Persist immediately so switchSession can load it later
      await window.claude.sessions.save({
        id: ccSessionId,
        projectId: project.id,
        title: newSession.title,
        createdAt: newSession.createdAt,
        messages: result.messages,
        totalCost: 0,
      });
      cacheSessionPayload({
        id: ccSessionId,
        projectId: project.id,
        title: newSession.title,
        createdAt: newSession.createdAt,
        messages: result.messages,
        totalCost: 0,
      });

      setSessions((prev) => [
        newSession,
        ...prev.map((s) => ({ ...s, isActive: false })),
      ]);
      setInitialMessages(result.messages);
      setInitialMeta(null);
      setActiveSessionId(ccSessionId);
      setDraftProjectId(null);
      capture("session_imported", { message_count: result.messages.length });
      return { ok: true };
    },
    [cacheSessionPayload, findProject, saveCurrentSession, seedBackgroundStore, switchSession],
  );

  // ── Switch draft engine/agent ──

  const setDraftAgent = useCallback((draftEngine: string, agentId: string, _cachedConfigOptions?: ACPConfigOption[], model?: string) => {
    const prevEngine = startOptionsRef.current.engine ?? "claude";
    const prevAgentId = startOptionsRef.current.agentId;
    if (prevEngine !== draftEngine) {
      capture("engine_switched", { from_engine: prevEngine, to_engine: draftEngine });
    }

    if (draftEngine !== "claude" && preStartedSessionIdRef.current) {
      // Switching away from Claude draft should immediately close the eager Claude session.
      abandonEagerSession("engine_switch");
    }
    if (prevEngine === "acp" && refs.draftAcpSessionIdRef.current && (draftEngine !== "acp" || agentId !== prevAgentId)) {
      abandonDraftAcpSession("engine_switch");
    }

    const normalizedModel = typeof model === "string" ? model.trim() : "";
    setStartOptions((prev) => ({
      ...prev,
      engine: draftEngine as StartOptions["engine"],
      agentId,
      model: normalizedModel || undefined,
    }));
    if (draftEngine === "codex") {
      prefetchCodexModels(normalizedModel || undefined);
    } else if (draftEngine === "acp" && draftProjectIdRef.current) {
      setInitialConfigOptions([]);
      setInitialSlashCommands([]);
      eagerStartAcpSession(draftProjectIdRef.current, {
        ...startOptionsRef.current,
        engine: "acp",
        agentId,
        model: normalizedModel || undefined,
      });
      probeMcpServers(draftProjectIdRef.current);
    }
  }, [prefetchCodexModels, abandonEagerSession, abandonDraftAcpSession, eagerStartAcpSession, probeMcpServers]);

  /**
   * Create a CLI engine session and switch to it immediately. Unlike
   * `createSession`, the CLI engine has no draft phase — the pty is spawned
   * eagerly on user click, so we materialize the real `ChatSession`
   * synchronously instead of going through DRAFT_ID + materialize-on-send.
   *
   * Caller is responsible for the actual `cli.start({...})` IPC after this
   * returns; the Harnss session row exists by then so AppLayout's
   * `isCliEngine` routing flips before the pty fires its first event.
   */
  const createCliSession = useCallback(async (
    projectId: string,
    sessionId: string,
    cwd: string,
  ): Promise<{ ok: true } | { error: string }> => {
    const project = findProject(projectId);
    if (!project) return { error: `Project ${projectId} not found` };

    abandonEagerSession("cli_session_create");
    abandonDraftAcpSession("cli_session_create");
    seedBackgroundStore();
    void saveCurrentSession();

    const now = Date.now();
    const newSession: ChatSession = {
      id: sessionId,
      projectId,
      title: "CLI session",
      createdAt: now,
      lastMessageAt: now,
      totalCost: 0,
      isActive: true,
      engine: "cli",
    };

    // Persist with engine='cli' from the start. Autosave runs only when
    // messages.length > 0, and CLI sessions intentionally never grow a
    // React-side messages list — so this is the only chance to write the
    // engine tag. Without it, the persisted row reloads as a default
    // (Claude SDK) session and the routing in AppLayout breaks on restart.
    const persisted = {
      id: sessionId,
      projectId,
      title: newSession.title,
      createdAt: now,
      messages: [],
      totalCost: 0,
      engine: "cli" as const,
    };
    await window.claude.sessions.save(persisted);
    cacheSessionPayload(persisted);

    setSessions((prev) => [
      newSession,
      ...prev.filter((s) => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })),
    ]);
    setInitialMessages([]);
    setInitialMeta(null);
    setActiveSessionId(sessionId);
    setDraftProjectId(null);
    void cwd; // cwd is consumed by the cli.start call the caller makes next.
    return { ok: true };
  }, [
    cacheSessionPayload,
    findProject,
    abandonEagerSession,
    abandonDraftAcpSession,
    saveCurrentSession,
    seedBackgroundStore,
    setActiveSessionId,
    setDraftProjectId,
    setInitialMessages,
    setInitialMeta,
    setSessions,
  ]);

  return {
    createSession,
    createCliSession,
    switchSession,
    deleteSession,
    archiveSession,
    unarchiveSession,
    renameSession,
    deselectSession,
    importCCSession,
    setDraftAgent,
  };
}
