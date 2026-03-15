import { startTransition, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { UIMessage, ChatSession, PersistedSession, ImageAttachment, McpServerConfig, Project, ClaudeEffort, CodeSnippet } from "../../types";
import type { ACPConfigOption } from "../../types/acp";
import type { CollaborationMode } from "../../types/codex-protocol/CollaborationMode";
import { imageAttachmentsToCodexInputs } from "../../lib/codex-adapter";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { buildSdkContent } from "../../lib/protocol";
import { toMcpStatusState } from "../../lib/mcp-utils";
import { bgAgentStore } from "../../lib/background-agent-store";
import { capture, captureException } from "../../lib/analytics";
import {
  DRAFT_ID,
  DEFAULT_PERMISSION_MODE,
  getEffectiveClaudePermissionMode,
  getCodexApprovalPolicy,
  getCodexSandboxMode,
  buildCodexCollabMode,
} from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks, StartOptions } from "./types";

interface UseSessionLifecycleParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  projects: Project[];
  activeSessionId: string | null;
  activeEngine: string;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
  saveCurrentSession: () => Promise<void>;
  seedBackgroundStore: () => void;
  eagerStartSession: (projectId: string, options?: StartOptions) => Promise<void>;
  eagerStartAcpSession: (projectId: string, options?: StartOptions, overrideServers?: McpServerConfig[]) => Promise<void>;
  prefetchCodexModels: (preferredModel?: string) => Promise<void>;
  probeMcpServers: (projectId: string, overrideServers?: McpServerConfig[]) => Promise<void>;
  abandonEagerSession: (reason?: string) => void;
  abandonDraftAcpSession: (reason?: string) => void;
  materializeDraft: (text: string, images?: ImageAttachment[], displayText?: string) => Promise<string>;
  reviveSession: (text: string, images?: ImageAttachment[], displayText?: string, codeSnippets?: CodeSnippet[]) => Promise<void>;
  reviveAcpSession: (text: string, images?: ImageAttachment[], displayText?: string, codeSnippets?: CodeSnippet[]) => Promise<void>;
  reviveCodexSession: (text: string, images?: ImageAttachment[], displayText?: string, codeSnippets?: CodeSnippet[]) => Promise<void>;
  enqueueMessage: (text: string, images?: ImageAttachment[], displayText?: string, codeSnippets?: CodeSnippet[]) => void;
  clearQueue: () => void;
  resetCodexEffortToModelDefault: (effort: string | undefined) => void;
}

export function useSessionLifecycle({
  refs,
  setters,
  engines,
  projects,
  activeSessionId,
  activeEngine,
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
  materializeDraft,
  reviveSession,
  reviveAcpSession,
  reviveCodexSession,
  enqueueMessage,
  clearQueue,
  resetCodexEffortToModelDefault,
}: UseSessionLifecycleParams) {
  const { claude, acp, codex, openclaw, engine } = engines;
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
    setPreStartedSessionId,
    setDraftMcpStatuses,
    setAcpConfigOptionsLoading,
    setAcpMcpStatuses,
    setCachedModels,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    messagesRef,
    totalCostRef,
    contextUsageRef,
    isProcessingRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    preStartedSessionIdRef,
    draftAcpSessionIdRef,
    draftProjectIdRef,
    startOptionsRef,
    acpAgentIdRef,
    acpAgentSessionIdRef,
    messageQueueRef,
    codexRawModelsRef,
    codexEffortRef,
    switchSessionRef,
    onSpaceChangeRef,
  } = refs;
  const sessionPayloadCacheRef = useRef<Map<string, PersistedSession>>(new Map());
  const inFlightPrefetchRef = useRef<Set<string>>(new Set());
  const switchRequestIdRef = useRef(0);
  const MAX_SESSION_PAYLOAD_CACHE = 6;

  const cacheSessionPayload = useCallback((data: PersistedSession) => {
    const cache = sessionPayloadCacheRef.current;
    cache.delete(data.id);
    cache.set(data.id, data);
    while (cache.size > MAX_SESSION_PAYLOAD_CACHE) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, []);

  const consumeCachedSessionPayload = useCallback((sessionId: string) => {
    const cache = sessionPayloadCacheRef.current;
    const cached = cache.get(sessionId);
    if (!cached) return null;
    cache.delete(sessionId);
    return cached;
  }, []);

  const applyLoadedSession = useCallback((id: string, data: PersistedSession) => {
    startTransition(() => {
      setStartOptions((prev) => ({
        ...prev,
        planMode: !!data.planMode,
      }));
      setInitialMessages(data.messages);
      setInitialMeta({
        isProcessing: false,
        isConnected: false,
        sessionInfo: null,
        totalCost: data.totalCost,
        contextUsage: data.contextUsage ?? null,
      });
      setInitialPermission(null);
      setInitialRawAcpPermission(null);
      setActiveSessionId(id);
      setDraftProjectId(null);
      setSessions((prev) =>
        prev.filter((s) => s.id !== DRAFT_ID).map((s) => ({
          ...s,
          isActive: s.id === id,
          ...(s.id === id ? {
            ...(data.engine ? { engine: data.engine } : {}),
            ...(data.agentId ? { agentId: data.agentId } : {}),
            ...(data.agentSessionId ? { agentSessionId: data.agentSessionId } : {}),
            ...(data.codexThreadId ? { codexThreadId: data.codexThreadId } : {}),
            planMode: !!data.planMode,
            hasPendingPermission: false,
          } : {}),
        })),
      );
    });
  }, [
    setActiveSessionId,
    setDraftProjectId,
    setInitialMessages,
    setInitialMeta,
    setInitialPermission,
    setInitialRawAcpPermission,
    setSessions,
    setStartOptions,
  ]);

  useEffect(() => {
    if (projects.length === 0) {
      setSessions([]);
      return;
    }
    Promise.all(
      projects.map((p) => window.claude.sessions.list(p.id)),
    ).then((results) => {
      const all = results.flat().map((s) => ({
        id: s.id,
        projectId: s.projectId,
        title: s.title,
        createdAt: s.createdAt,
        lastMessageAt: s.lastMessageAt || s.createdAt,
        model: s.model,
        planMode: s.planMode,
        totalCost: s.totalCost,
        isActive: false,
        engine: s.engine,
        codexThreadId: s.codexThreadId,
      }));
      setSessions(all);
    }).catch(() => { });
  }, [projects]);

  useEffect(() => {
    let cancelled = false;

    const firstProject = refs.projectsRef.current[0];
    const preferredCwd = firstProject ? getProjectCwd(firstProject) : undefined;

    window.claude.modelsCacheGet().then((result) => {
      if (cancelled) return;
      if (result.models?.length) {
        setCachedModels(result.models);
      }
    }).catch(() => { });

    const revalidateTimer = setTimeout(() => {
      window.claude.modelsCacheRevalidate(preferredCwd ? { cwd: preferredCwd } : undefined).then((result) => {
        if (cancelled) return;
        if (result.models?.length) {
          setCachedModels(result.models);
          return;
        }
        if (result.error) {
          toast.error("Failed to load Claude models", { description: result.error });
        }
      }).catch(() => { });
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(revalidateTimer);
    };
  }, [getProjectCwd]);

  useEffect(() => {
    if (activeEngine !== "codex") return;
    if (codex.codexModels.length > 0) return;
    const preferredModel = activeSessionId === DRAFT_ID
      ? startOptionsRef.current.model
      : sessionsRef.current.find((s) => s.id === activeSessionId)?.model;
    prefetchCodexModels(preferredModel);
  }, [
    activeEngine,
    activeSessionId,
    projects,
    startOptionsRef.current.model,
    codex.codexModels.length,
    prefetchCodexModels,
  ]);

  useEffect(() => {
    const candidates = sessionsRef.current
      .filter((session) => session.id !== activeSessionIdRef.current)
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt))
      .slice(0, MAX_SESSION_PAYLOAD_CACHE);

    if (candidates.length === 0) return;

    let cancelled = false;
    let idleId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      for (const session of candidates) {
        if (cancelled) return;
        if (sessionPayloadCacheRef.current.has(session.id)) continue;
        if (inFlightPrefetchRef.current.has(session.id)) continue;
        if (backgroundStoreRef.current.has(session.id)) continue;

        inFlightPrefetchRef.current.add(session.id);
        try {
          const data = await window.claude.sessions.load(session.projectId, session.id);
          if (!cancelled && data) {
            cacheSessionPayload(data);
          }
        } finally {
          inFlightPrefetchRef.current.delete(session.id);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => {
        void run();
      }, { timeout: 5000 });
    } else {
      timerId = setTimeout(() => {
        void run();
      }, 3000);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [activeSessionId, cacheSessionPayload, projects]);

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
      acp.setMessages([]);
      acp.setIsProcessing(false);
      setActiveSessionId(DRAFT_ID);
      setSessions((prev) => prev.filter(s => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })));

      if (draftEngine === "claude") {
        eagerStartSession(projectId, options);
        window.claude.mcp.list(projectId).then(servers => {
          if (activeSessionIdRef.current === DRAFT_ID && draftProjectIdRef.current === projectId) {
            setDraftMcpStatuses(servers.map(s => ({
              name: s.name,
              status: "pending" as const,
            })));
          }
        }).catch(() => { });
      } else if (draftEngine === "acp") {
        eagerStartAcpSession(projectId, options);
        probeMcpServers(projectId);
      } else {
        setDraftMcpStatuses([]);
        prefetchCodexModels(options?.model);
      }
    },
    [saveCurrentSession, seedBackgroundStore, eagerStartSession, eagerStartAcpSession, abandonEagerSession, abandonDraftAcpSession, prefetchCodexModels, probeMcpServers],
  );

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
      setStartOptions((prev) => ({
        ...prev,
        planMode: !!session.planMode,
      }));

      const sessionProject = refs.projectsRef.current.find((p) => p.id === session.projectId);
      if (sessionProject) {
        onSpaceChangeRef.current?.(sessionProject.spaceId || "default");
      }

      const bgState = backgroundStoreRef.current.consume(id);
      if (bgState) {
        startTransition(() => {
          setInitialMessages(bgState.messages);
          setInitialMeta({
            isProcessing: bgState.isProcessing,
            isConnected: bgState.isConnected,
            sessionInfo: bgState.sessionInfo,
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
        applyLoadedSession(id, cachedData);
        return;
      }

      const data = await window.claude.sessions.load(session.projectId, id);
      if (requestId !== switchRequestIdRef.current) return;
      if (data) {
        cacheSessionPayload(data);
        const restored = consumeCachedSessionPayload(id);
        if (restored) {
          applyLoadedSession(id, restored);
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

  switchSessionRef.current = switchSession;

  const deleteSession = useCallback(
    async (id: string) => {
      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;
      sessionPayloadCacheRef.current.delete(id);
      inFlightPrefetchRef.current.delete(id);
      if (liveSessionIdsRef.current.has(id)) {
        if (session.engine === "codex") {
          suppressNextSessionCompletion(id);
          await window.claude.codex.stop(id);
        } else if (session.engine === "acp") {
          suppressNextSessionCompletion(id);
          await window.claude.acp.stop(id);
        } else if (session.engine === "openclaw") {
          suppressNextSessionCompletion(id);
          await window.claude.openclaw.stop(id);
        } else {
          suppressNextSessionCompletion(id);
          await window.claude.stop(id, "session_delete");
        }
        liveSessionIdsRef.current.delete(id);
      }
      backgroundStoreRef.current.delete(id);
      messageQueueRef.current.delete(id);
      bgAgentStore.clearSession(id);
      toast.dismiss(`permission-${id}`);
      await window.claude.sessions.delete(session.projectId, id);
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
    [clearQueue],
  );

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
    }).catch(() => { });
  }, []);

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
    setSessions((prev) => prev.filter(s => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })));
  }, [saveCurrentSession, seedBackgroundStore, abandonEagerSession, abandonDraftAcpSession]);

  const importCCSession = useCallback(
    async (projectId: string, ccSessionId: string) => {
      const project = findProject(projectId);
      if (!project) return;

      const existing = sessionsRef.current.find((s) => s.id === ccSessionId);
      if (existing) {
        await switchSession(ccSessionId);
        return;
      }

      seedBackgroundStore();
      void saveCurrentSession();

      const result = await window.claude.ccSessions.import(getProjectCwd(project), ccSessionId);
      if (result.error || !result.messages) return;

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
    },
    [cacheSessionPayload, findProject, saveCurrentSession, seedBackgroundStore, switchSession],
  );

  const setDraftAgent = useCallback((draftEngine: string, agentId: string, _cachedConfigOptions?: ACPConfigOption[], model?: string) => {
    const prevEngine = startOptionsRef.current.engine ?? "claude";
    const prevAgentId = startOptionsRef.current.agentId;
    if (prevEngine !== draftEngine) {
      capture("engine_switched", { from_engine: prevEngine, to_engine: draftEngine });
    }

    if (draftEngine !== "claude" && preStartedSessionIdRef.current) {
      abandonEagerSession("engine_switch");
    }
    if (prevEngine === "acp" && draftAcpSessionIdRef.current && (draftEngine !== "acp" || agentId !== prevAgentId)) {
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
  }, [prefetchCodexModels, abandonEagerSession, abandonDraftAcpSession, draftProjectIdRef, eagerStartAcpSession, probeMcpServers, setAcpConfigOptionsLoading, setInitialConfigOptions, setInitialSlashCommands]);

  const setActiveModel = useCallback((model: string) => {
    const id = activeSessionIdRef.current;
    if (!id) return;

    const applyCodexDefaultEffort = (modelId: string) => {
      const codexModel = codexRawModelsRef.current.find((entry) => entry.id === modelId);
      resetCodexEffortToModelDefault(codexModel?.defaultReasoningEffort);
    };

    if (id === DRAFT_ID) {
      setStartOptions((prev) => ({ ...prev, model }));
      if ((startOptionsRef.current.engine ?? "claude") === "codex") {
        applyCodexDefaultEffort(model);
      }
      const draftEngine = startOptionsRef.current.engine ?? "claude";
      if (preStartedSessionIdRef.current && draftEngine === "claude") {
        const oldId = preStartedSessionIdRef.current;
        suppressNextSessionCompletion(oldId);
        window.claude.stop(oldId, "draft_model_change");
        liveSessionIdsRef.current.delete(oldId);
        backgroundStoreRef.current.delete(oldId);
        preStartedSessionIdRef.current = null;
        setPreStartedSessionId(null);
        setDraftMcpStatuses([]);
        if (draftProjectIdRef.current) {
          eagerStartSession(draftProjectIdRef.current, { ...startOptionsRef.current, model });
          window.claude.mcp.list(draftProjectIdRef.current).then(servers => {
            if (activeSessionIdRef.current === DRAFT_ID) {
              setDraftMcpStatuses(servers.map(s => ({
                name: s.name,
                status: "pending" as const,
              })));
            }
          }).catch(() => { });
        }
      } else if (preStartedSessionIdRef.current && draftEngine !== "claude") {
        abandonEagerSession("engine_switch");
      }
      return;
    }

    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;

    const persistModel = () => {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, model } : s)),
      );

      window.claude.sessions.load(session.projectId, id).then((data) => {
        if (data) {
          window.claude.sessions.save({ ...data, model });
        }
      }).catch(() => { });
    };

    const isLiveClaudeSession = (session.engine ?? "claude") === "claude"
      && liveSessionIdsRef.current.has(id);
    const isLiveCodexSession = (session.engine ?? "claude") === "codex"
      && liveSessionIdsRef.current.has(id);

    if (isLiveClaudeSession) {
      claude.setModel(model).then((result) => {
        if (result?.error) {
          toast.error("Failed to switch model", { description: result.error });
          return;
        }
        persistModel();
      }).catch((err) => {
        captureException(err instanceof Error ? err : new Error(String(err)), { label: "CLAUDE_MODEL_SWITCH_ERR" });
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to switch model", { description: message });
      });
      return;
    }

    if (isLiveCodexSession) {
      window.claude.codex.setModel(id, model).then((result) => {
        if (result?.error) {
          toast.error("Failed to switch model", { description: result.error });
          return;
        }
        applyCodexDefaultEffort(model);
        persistModel();
      }).catch((err) => {
        captureException(err instanceof Error ? err : new Error(String(err)), { label: "CODEX_MODEL_SWITCH_ERR" });
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to switch model", { description: message });
      });
      return;
    }

    if ((session.engine ?? "claude") === "codex") {
      applyCodexDefaultEffort(model);
    }
    persistModel();
  }, [claude.setModel, resetCodexEffortToModelDefault, eagerStartSession, abandonEagerSession]);

  const setActivePermissionMode = useCallback((permissionMode: string) => {
    const id = activeSessionIdRef.current;
    if (!id) return;

    const normalizedPermission = permissionMode === "plan"
      ? DEFAULT_PERMISSION_MODE
      : permissionMode;
    const nextOptions = {
      ...startOptionsRef.current,
      permissionMode: normalizedPermission,
    };
    const effectiveClaudeMode = getEffectiveClaudePermissionMode(nextOptions);

    setStartOptions((prev) => ({ ...prev, permissionMode: normalizedPermission }));

    if (id === DRAFT_ID) {
      if (preStartedSessionIdRef.current) {
        window.claude.setPermissionMode(preStartedSessionIdRef.current, effectiveClaudeMode);
      }
      return;
    }

    const sessionEngine = sessionsRef.current.find((s) => s.id === id)?.engine ?? "claude";
    if (sessionEngine === "claude") {
      engine.setPermissionMode(effectiveClaudeMode);
      return;
    }
    if (sessionEngine === "codex") {
      engine.setPermissionMode(normalizedPermission);
    }
  }, [engine.setPermissionMode]);

  const setActivePlanMode = useCallback((planMode: boolean) => {
    const id = activeSessionIdRef.current;
    if (!id) return;

    const nextOptions = {
      ...startOptionsRef.current,
      planMode,
    };
    const effectiveClaudeMode = getEffectiveClaudePermissionMode(nextOptions);
    setStartOptions((prev) => ({ ...prev, planMode }));
    if (planMode) capture("plan_mode_entered");
    setSessions((prev) => prev.map((s) => (
      s.id === id ? { ...s, planMode } : s
    )));

    if (id === DRAFT_ID) {
      if (preStartedSessionIdRef.current) {
        window.claude.setPermissionMode(preStartedSessionIdRef.current, effectiveClaudeMode);
      }
      return;
    }

    const sessionEngine = sessionsRef.current.find((s) => s.id === id)?.engine ?? "claude";
    const session = sessionsRef.current.find((s) => s.id === id);
    if (session) {
      window.claude.sessions.load(session.projectId, id).then((data) => {
        if (data) {
          window.claude.sessions.save({ ...data, planMode });
        }
      }).catch(() => { });
    }
    if (sessionEngine === "claude") {
      engine.setPermissionMode(effectiveClaudeMode);
    }
  }, [engine.setPermissionMode]);

  const setActiveThinking = useCallback((thinkingEnabled: boolean) => {
    const id = activeSessionIdRef.current;
    if (!id) return;

    setStartOptions((prev) => ({ ...prev, thinkingEnabled }));
    capture("thinking_toggled", { enabled: thinkingEnabled });

    if (id === DRAFT_ID) {
      if (preStartedSessionIdRef.current) {
        window.claude.setThinking(preStartedSessionIdRef.current, thinkingEnabled);
      }
      return;
    }

    const sessionEngine = sessionsRef.current.find((s) => s.id === id)?.engine ?? "claude";
    if (sessionEngine !== "claude" || !liveSessionIdsRef.current.has(id)) return;

    claude.setThinkingEnabled(thinkingEnabled).then((result) => {
      if (result?.error) {
        toast.error("Failed to update reasoning", { description: result.error });
      }
    }).catch((err) => {
      captureException(err instanceof Error ? err : new Error(String(err)), { label: "THINKING_TOGGLE_ERR" });
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to update reasoning", { description: message });
    });
  }, [claude.setThinkingEnabled]);

  const setActiveClaudeEffort = useCallback(async (effort: ClaudeEffort) => {
    const id = activeSessionIdRef.current;
    if (!id) return;

    setStartOptions((prev) => ({ ...prev, effort }));

    if (id === DRAFT_ID) {
      const preStartedId = preStartedSessionIdRef.current;
      if (!preStartedId) return;

      const restartResult = await window.claude.restartSession(preStartedId, undefined, undefined, effort);
      if (restartResult?.error) {
        toast.error("Failed to update effort", { description: restartResult.error });
        return;
      }

      const [statusResult, modelsResult] = await Promise.all([
        window.claude.mcpStatus(preStartedId),
        window.claude.supportedModels(preStartedId),
      ]);

      if (statusResult.servers?.length) {
        setDraftMcpStatuses(statusResult.servers.map((server) => ({
          name: server.name,
          status: toMcpStatusState(server.status),
        })));
      }
      if (modelsResult.models?.length) {
        setCachedModels(modelsResult.models);
      }
      return;
    }

    const sessionEngine = sessionsRef.current.find((s) => s.id === id)?.engine ?? "claude";
    if (sessionEngine !== "claude" || !liveSessionIdsRef.current.has(id)) return;

    const restartResult = await window.claude.restartSession(id, undefined, undefined, effort);
    if (restartResult?.error) {
      toast.error("Failed to update effort", { description: restartResult.error });
    }
  }, [setCachedModels, setDraftMcpStatuses, setStartOptions]);

  const setActiveClaudeModelAndEffort = useCallback(async (model: string, effort: ClaudeEffort) => {
    const id = activeSessionIdRef.current;
    if (!id) return;

    setStartOptions((prev) => ({ ...prev, model, effort }));

    if (id === DRAFT_ID) {
      const preStartedId = preStartedSessionIdRef.current;
      const draftEngine = startOptionsRef.current.engine ?? "claude";
      if (!preStartedId || draftEngine !== "claude") return;

      const restartResult = await window.claude.restartSession(preStartedId, undefined, undefined, effort, model);
      if (restartResult?.error) {
        toast.error("Failed to update model effort", { description: restartResult.error });
        return;
      }

      const [statusResult, modelsResult] = await Promise.all([
        window.claude.mcpStatus(preStartedId),
        window.claude.supportedModels(preStartedId),
      ]);

      if (statusResult.servers?.length) {
        setDraftMcpStatuses(statusResult.servers.map((server) => ({
          name: server.name,
          status: toMcpStatusState(server.status),
        })));
      }
      if (modelsResult.models?.length) {
        setCachedModels(modelsResult.models);
      }
      return;
    }

    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;

    const sessionEngine = session.engine ?? "claude";
    if (sessionEngine !== "claude") return;

    const persistModel = () => {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, model } : s)),
      );

      window.claude.sessions.load(session.projectId, id).then((data) => {
        if (data) {
          window.claude.sessions.save({ ...data, model });
        }
      }).catch(() => { });
    };

    if (liveSessionIdsRef.current.has(id)) {
      const restartResult = await window.claude.restartSession(id, undefined, undefined, effort, model);
      if (restartResult?.error) {
        toast.error("Failed to update model effort", { description: restartResult.error });
        return;
      }
    }

    persistModel();
  }, [setCachedModels, setDraftMcpStatuses, setSessions, setStartOptions]);

  const restartAcpSession = useCallback(async (servers: McpServerConfig[], cwdOverride?: string): Promise<{ ok?: boolean; error?: string }> => {
    const currentId = activeSessionIdRef.current;
    if (!currentId || currentId === DRAFT_ID) return { ok: true };

    const session = sessionsRef.current.find(s => s.id === currentId);
    const project = session ? findProject(session.projectId) : null;
    const agentId = acpAgentIdRef.current;
    if (!session || !project || !agentId) return { error: "ACP session cannot be restarted right now." };

    const probeResults = await window.claude.mcp.probe(servers);
    if (activeSessionIdRef.current !== currentId) return { ok: true };
    setAcpMcpStatuses(probeResults.map(r => ({
      name: r.name,
      status: toMcpStatusState(r.status),
      ...(r.error ? { error: r.error } : {}),
    })));

    const nextCwd = cwdOverride ?? getProjectCwd(project);
    const reloadResult = await window.claude.acp.reloadSession(currentId, servers, nextCwd);
    if (reloadResult.supportsLoad && reloadResult.ok) {
      return { ok: true };
    }

    const currentMessages = messagesRef.current;
    const currentCost = totalCostRef.current;

    suppressNextSessionCompletion(currentId);
    await window.claude.acp.stop(currentId);
    liveSessionIdsRef.current.delete(currentId);
    backgroundStoreRef.current.delete(currentId);

    const result = await window.claude.acp.start({
      agentId,
      cwd: nextCwd,
      mcpServers: servers,
    });
    if (result.error || !result.sessionId) {
      const errorMsg = result.error || "Failed to restart agent session";
      acp.setMessages(prev => [...prev, {
        id: `system-error-${Date.now()}`,
        role: "system" as const,
        content: errorMsg,
        isError: true,
          timestamp: Date.now(),
      }]);
      return { error: errorMsg };
    }

    const newId = result.sessionId;
    liveSessionIdsRef.current.add(newId);

    setSessions(prev => prev.map(s =>
      s.id === currentId ? { ...s, id: newId } : s
    ));
    setInitialMessages(currentMessages);
    setInitialMeta({
      isProcessing: false,
      isConnected: true,
      sessionInfo: null,
      totalCost: currentCost,
      contextUsage: contextUsageRef.current,
    });
    if (result.configOptions?.length) setInitialConfigOptions(result.configOptions);
    setActiveSessionId(newId);
    return { ok: true };
  }, [findProject, getProjectCwd]);

  const restartActiveSessionInCurrentWorktree = useCallback(async (): Promise<{ ok?: boolean; error?: string }> => {
    const currentId = activeSessionIdRef.current;
    if (!currentId || currentId === DRAFT_ID) return { ok: true };
    if (isProcessingRef.current) {
      return { error: "Wait for the current turn to finish before restarting in another worktree." };
    }

    const session = sessionsRef.current.find((s) => s.id === currentId);
    if (!session) return { error: "Active session not found." };
    const project = findProject(session.projectId);
    if (!project) return { error: "Project not found." };
    const nextCwd = getProjectCwd(project);
    const mcpServers = await window.claude.mcp.list(session.projectId);

    if (session.engine === "acp") {
      return restartAcpSession(mcpServers, nextCwd);
    }

    if (session.engine === "openclaw") {
      return { error: "OpenClaw session restart in another worktree is not yet supported." };
    }

    if (session.engine === "codex") {
      let codexThreadId: string | undefined = session.codexThreadId;
      if (!codexThreadId) {
        try {
          const persisted = await window.claude.sessions.load(session.projectId, currentId);
          codexThreadId = persisted?.codexThreadId;
        } catch {
        }
      }

      if (!codexThreadId) {
        return { error: "Codex session cannot be restarted in another worktree because no thread ID is available." };
      }

      const resumeResult = await window.claude.codex.resume({
        cwd: nextCwd,
        threadId: codexThreadId,
        model: session.model,
        approvalPolicy: getCodexApprovalPolicy(startOptionsRef.current),
        sandbox: getCodexSandboxMode(startOptionsRef.current),
      });

      if (resumeResult.error || !resumeResult.sessionId) {
        return { error: resumeResult.error || "Failed to restart Codex session in the selected worktree." };
      }

      const newId = resumeResult.sessionId;
      liveSessionIdsRef.current.add(newId);
      setSessions((prev) => prev.map((s) =>
        s.id === currentId
          ? { ...s, id: newId, codexThreadId: resumeResult.threadId ?? codexThreadId }
          : s,
      ));
      setInitialMessages(messagesRef.current);
      setInitialMeta({
        isProcessing: false,
        isConnected: true,
        sessionInfo: null,
        totalCost: totalCostRef.current,
        contextUsage: contextUsageRef.current,
      });
      setActiveSessionId(newId);

      suppressNextSessionCompletion(currentId);
      await window.claude.codex.stop(currentId);
      liveSessionIdsRef.current.delete(currentId);
      backgroundStoreRef.current.delete(currentId);
      return { ok: true };
    }

    const restartResult = await window.claude.restartSession(currentId, mcpServers, nextCwd);
    if (restartResult?.error) {
      return { error: restartResult.error };
    }
    if (restartResult?.restarted) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    await claude.refreshMcpStatus();
    return { ok: true };
  }, [claude.refreshMcpStatus, findProject, getProjectCwd, restartAcpSession]);

  const fullRevertSession = useCallback(async (checkpointId: string) => {
    const currentId = activeSessionIdRef.current;
    if (!currentId || currentId === DRAFT_ID) return;

    const session = sessionsRef.current.find(s => s.id === currentId);
    if (!session) return;
    const project = findProject(session.projectId);
    if (!project) return;

    claude.flushNow();
    claude.resetStreaming();

    const currentMessages = messagesRef.current;
    const checkpointIdx = currentMessages.findIndex(
      (m) => m.role === "user" && m.checkpointId === checkpointId,
    );
    const truncatedMessages = checkpointIdx >= 0
      ? currentMessages.slice(0, checkpointIdx)
      : currentMessages;

    const revertResult = await window.claude.revertFiles(currentId, checkpointId);
    if (revertResult.error) {
      claude.setMessages(prev => [...prev, {
        id: `system-revert-err-${Date.now()}`,
        role: "system" as const,
        content: `File revert failed: ${revertResult.error}`,
        isError: true,
        timestamp: Date.now(),
      }]);
      return;
    }

    suppressNextSessionCompletion(currentId);
    await window.claude.stop(currentId, "revert_restart");
    liveSessionIdsRef.current.delete(currentId);
    backgroundStoreRef.current.delete(currentId);

    const mcpServers = await window.claude.mcp.list(session.projectId);
    const startResult = await window.claude.start({
      cwd: getProjectCwd(project),
      model: session.model,
      permissionMode: getEffectiveClaudePermissionMode(startOptionsRef.current),
      thinkingEnabled: startOptionsRef.current.thinkingEnabled,
      effort: startOptionsRef.current.effort,
      resume: currentId,
      forkSession: true,
      resumeSessionAt: checkpointId,
      mcpServers,
    });

    if (startResult.error) {
      claude.setMessages(prev => [...prev, {
        id: `system-revert-err-${Date.now()}`,
        role: "system" as const,
        content: `Full revert failed: ${startResult.error}`,
        isError: true,
        timestamp: Date.now(),
      }]);
      return;
    }

    const newId = startResult.sessionId;
    liveSessionIdsRef.current.add(newId);

    setSessions(prev => prev.map(s =>
      s.id === currentId ? { ...s, id: newId } : s,
    ));

    const systemMsg: UIMessage = {
      id: `system-revert-${Date.now()}`,
      role: "system" as const,
      content: "Session reverted: files restored and chat history truncated.",
      timestamp: Date.now(),
    };
    setInitialMessages([...truncatedMessages, systemMsg]);
    setInitialMeta({
      isProcessing: false,
      isConnected: true,
      sessionInfo: null,
      totalCost: totalCostRef.current,
      contextUsage: contextUsageRef.current,
    });

    setActiveSessionId(newId);

    const oldData = await window.claude.sessions.load(project.id, currentId);
    if (oldData) {
      await window.claude.sessions.save({
        ...oldData,
        id: newId,
        messages: [...truncatedMessages, systemMsg],
      });
      await window.claude.sessions.delete(project.id, currentId);
    }
  }, [findProject, claude.flushNow, claude.resetStreaming, claude.setMessages]);

  const send = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string, codeSnippets?: CodeSnippet[]) => {
      const activeId = activeSessionIdRef.current;
      const sendEngine = activeSessionIdRef.current === DRAFT_ID
        ? (startOptionsRef.current.engine ?? "claude")
        : (sessionsRef.current.find(s => s.id === activeSessionIdRef.current)?.engine ?? "claude");
      const trackMessageSent = (sessionId?: string) => {
        capture("message_sent", {
          engine: sendEngine,
          has_images: !!images?.length,
          message_length: text.length,
          ...(sendEngine === "acp" && sessionId ? { session_id: sessionId } : {}),
        });
      };

      if (activeId === DRAFT_ID) {
        const draftEngine = startOptionsRef.current.engine ?? "claude";

        if (draftEngine === "acp") {
          const userMsg: UIMessage = {
            id: `user-${Date.now()}`,
            role: "user" as const,
            content: text,
            timestamp: Date.now(),
            ...(images?.length ? { images } : {}),
            ...(displayText ? { displayContent: displayText } : {}),
            ...(codeSnippets?.length ? { codeSnippets } : {}),
          };
          acp.setMessages((prev) => [...prev, userMsg]);
          acp.setIsProcessing(true);

          const sessionId = await materializeDraft(text, images, displayText);
          if (!sessionId) {
            acp.setIsProcessing(false);
            return;
          }

          trackMessageSent(sessionId);

          await new Promise((resolve) => setTimeout(resolve, 50));
          const promptResult = await window.claude.acp.prompt(sessionId, text, images);
          if (promptResult?.error) {
            acp.setMessages((prev) => [
              ...prev,
              {
                id: `system-acp-error-${Date.now()}`,
                role: "system" as const,
                content: `ACP prompt error: ${promptResult.error}`,
                timestamp: Date.now(),
              },
            ]);
            acp.setIsProcessing(false);
          }
          return;
        }

        if (draftEngine === "codex") {
          trackMessageSent();
          const sessionId = await materializeDraft(text, images, displayText);
          if (!sessionId) return;
          await new Promise((resolve) => setTimeout(resolve, 50));

          codex.setMessages((prev) => [
            ...prev,
            {
              id: `user-${Date.now()}`,
              role: "user",
              content: text,
              timestamp: Date.now(),
              ...(images?.length ? { images } : {}),
              ...(displayText ? { displayContent: displayText } : {}),
              ...(codeSnippets?.length ? { codeSnippets } : {}),
            },
          ]);
          codex.setIsProcessing(true);

          const codexSession = sessionsRef.current.find((s) => s.id === sessionId);
          let codexCollabMode: CollaborationMode | undefined;
          try {
            codexCollabMode = buildCodexCollabMode(startOptionsRef.current.planMode, codexSession?.model);
          } catch (err) {
            codex.setMessages((prev) => [
              ...prev,
              {
                id: `system-send-error-${Date.now()}`,
                role: "system",
                content: err instanceof Error ? err.message : String(err),
                timestamp: Date.now(),
                isError: true,
              },
            ]);
            codex.setIsProcessing(false);
            return;
          }
          const sendResult = await window.claude.codex.send(
            sessionId,
            text,
            imageAttachmentsToCodexInputs(images),
            codexEffortRef.current,
            codexCollabMode,
          );
          if (sendResult?.error) {
            liveSessionIdsRef.current.delete(sessionId);
            codex.setMessages((prev) => [
              ...prev,
              {
                id: `system-send-error-${Date.now()}`,
                role: "system",
                content: `Unable to send message: ${sendResult.error}`,
                timestamp: Date.now(),
                isError: true,
              },
            ]);
            codex.setIsProcessing(false);
          }
          return;
        }

        if (draftEngine === "openclaw") {
          trackMessageSent();
          const sessionId = await materializeDraft(text, images, displayText);
          if (!sessionId) return;
          await new Promise((resolve) => setTimeout(resolve, 50));

          openclaw.setMessages((prev) => [
            ...prev,
            {
              id: `user-${Date.now()}`,
              role: "user",
              content: text,
              timestamp: Date.now(),
              ...(images?.length ? { images } : {}),
              ...(displayText ? { displayContent: displayText } : {}),
              ...(codeSnippets?.length ? { codeSnippets } : {}),
            },
          ]);
          openclaw.setIsProcessing(true);

          const sendResult = await window.claude.openclaw.send(sessionId, text);
          if (sendResult?.error) {
            liveSessionIdsRef.current.delete(sessionId);
            openclaw.setMessages((prev) => [
              ...prev,
              {
                id: `system-send-error-${Date.now()}`,
                role: "system",
                content: `Unable to send message: ${sendResult.error}`,
                timestamp: Date.now(),
                isError: true,
              },
            ]);
            openclaw.setIsProcessing(false);
          }
          return;
        }

        trackMessageSent();
        const sessionId = await materializeDraft(text);
        if (!sessionId) return;
        await new Promise((resolve) => setTimeout(resolve, 50));

        {
          const content = buildSdkContent(text, images);
          const sendResult = await window.claude.send(sessionId, {
            type: "user",
            message: { role: "user", content },
          });
          if (sendResult?.error) {
            liveSessionIdsRef.current.delete(sessionId);
            claude.setMessages((prev) => [
              ...prev,
              {
                id: `system-send-error-${Date.now()}`,
                role: "system",
                content: `Unable to send message: ${sendResult.error}`,
                timestamp: Date.now(),
              },
            ]);
            return;
          }
          claude.setMessages((prev) => [
            ...prev,
            {
              id: `user-${Date.now()}`,
              role: "user",
              content: text,
              timestamp: Date.now(),
              ...(images?.length ? { images } : {}),
              ...(displayText ? { displayContent: displayText } : {}),
              ...(codeSnippets?.length ? { codeSnippets } : {}),
            },
          ]);
        }
        return;
      }

      if (!activeId) return;

      const activeSessionEngine = sessionsRef.current.find(s => s.id === activeId)?.engine ?? "claude";
      if (isProcessingRef.current && liveSessionIdsRef.current.has(activeId)) {
        trackMessageSent(activeSessionEngine === "acp" ? activeId : undefined);
        enqueueMessage(text, images, displayText, codeSnippets);
        return;
      }

      if (activeSessionEngine === "acp") {
        if (liveSessionIdsRef.current.has(activeId)) {
          trackMessageSent(activeId);
          await acp.send(text, images, displayText, codeSnippets);
          return;
        }
        await reviveAcpSession(text, images, displayText, codeSnippets);
        return;
      }

      trackMessageSent();

      if (activeSessionEngine === "codex") {
        if (liveSessionIdsRef.current.has(activeId)) {
          const activeSession = sessionsRef.current.find((s) => s.id === activeId);
          let codexCollabMode: CollaborationMode | undefined;
          try {
            codexCollabMode = buildCodexCollabMode(startOptionsRef.current.planMode, activeSession?.model);
          } catch (err) {
            codex.setMessages((prev) => [
              ...prev,
              {
                id: `system-send-error-${Date.now()}`,
                role: "system",
                content: err instanceof Error ? err.message : String(err),
                timestamp: Date.now(),
                isError: true,
              },
            ]);
            return;
          }
          await codex.send(text, images, displayText, codexCollabMode, codeSnippets);
          return;
        }
        await reviveCodexSession(text, images, undefined, codeSnippets);
        return;
      }

      if (activeSessionEngine === "openclaw") {
        liveSessionIdsRef.current.add(activeId);
        trackMessageSent();
        await openclaw.send(text, images, displayText, codeSnippets);
        return;
      }

      if (liveSessionIdsRef.current.has(activeId)) {
        const sent = await claude.send(text, images, displayText, codeSnippets);
        if (sent) return;
        liveSessionIdsRef.current.delete(activeId);
      }

      if (activeSessionIdRef.current !== DRAFT_ID) {
        await reviveSession(text, images, displayText, codeSnippets);
        return;
      }
    },
    [
      claude.send,
      claude.setMessages,
      acp.send,
      acp.setMessages,
      acp.setIsProcessing,
      codex.send,
      codex.setMessages,
      codex.setIsProcessing,
      openclaw.send,
      openclaw.setMessages,
      openclaw.setIsProcessing,
      materializeDraft,
      reviveSession,
      reviveAcpSession,
      reviveCodexSession,
      enqueueMessage,
    ],
  );

  return {
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    deselectSession,
    importCCSession,
    setDraftAgent,
    setActiveModel,
    setActivePermissionMode,
    setActivePlanMode,
    setActiveThinking,
    setActiveClaudeEffort,
    setActiveClaudeModelAndEffort,
    restartAcpSession,
    restartActiveSessionInCurrentWorktree,
    fullRevertSession,
    send,
  };
}
