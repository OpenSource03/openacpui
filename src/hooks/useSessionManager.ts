import { useState, useCallback, useRef } from "react";
import type { ChatSession, UIMessage, PermissionRequest, McpServerStatus, McpServerConfig, ModelInfo, AcpPermissionBehavior, EngineId, Project } from "../types";
import type { ACPConfigOption, ACPPermissionEvent } from "../types/acp";
import { toMcpStatusState } from "../lib/mcp-utils";
import { useClaude } from "./useClaude";
import { useACP } from "./useACP";
import { useCodex } from "./useCodex";
import { useOllama } from "./useOllama";
import { BackgroundSessionStore } from "../lib/background-session-store";
import {
  DRAFT_ID,
  type StartOptions,
  type CodexModelSummary,
  type InitialMeta,
  type QueuedMessage,
  type SharedSessionRefs,
  type SharedSessionSetters,
  type EngineHooks,
} from "./session/types";
import { useMessageQueue } from "./session/useMessageQueue";
import { useSessionPersistence } from "./session/useSessionPersistence";
import { useDraftMaterialization } from "./session/useDraftMaterialization";
import { useSessionRevival } from "./session/useSessionRevival";
import { useSessionLifecycle } from "./session/useSessionLifecycle";

export function useSessionManager(projects: Project[], acpPermissionBehavior: AcpPermissionBehavior = "ask", onSpaceChange?: (spaceId: string) => void) {
  // ── Core state ──
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [startOptions, setStartOptions] = useState<StartOptions>({});
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const [initialMeta, setInitialMeta] = useState<InitialMeta | null>(null);
  const [initialConfigOptions, setInitialConfigOptions] = useState<ACPConfigOption[]>([]);
  const [initialSlashCommands, setInitialSlashCommands] = useState<import("@/types").SlashCommand[]>([]);
  const [initialPermission, setInitialPermission] = useState<PermissionRequest | null>(null);
  const [initialRawAcpPermission, setInitialRawAcpPermission] = useState<ACPPermissionEvent | null>(null);
  const [acpMcpStatuses, setAcpMcpStatuses] = useState<McpServerStatus[]>([]);
  const [acpConfigOptionsLoading, setAcpConfigOptionsLoading] = useState(false);
  const [preStartedSessionId, setPreStartedSessionId] = useState<string | null>(null);
  const [draftAcpSessionId, setDraftAcpSessionId] = useState<string | null>(null);
  const [draftMcpStatuses, setDraftMcpStatuses] = useState<McpServerStatus[]>([]);
  const [cachedModels, setCachedModels] = useState<ModelInfo[]>([]);
  const [codexRawModels, setCodexRawModels] = useState<CodexModelSummary[]>([]);
  const [codexModelsLoadingMessage, setCodexModelsLoadingMessage] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);

  // ── Determine active engine ──
  const activeEngine: EngineId = activeSessionId === DRAFT_ID
    ? (startOptions.engine ?? "claude")
    : (sessions.find(s => s.id === activeSessionId)?.engine ?? "claude");
  const isACP = activeEngine === "acp";
  const isCodex = activeEngine === "codex";
  const isOllama = activeEngine === "ollama";

  const claudeSessionId = (activeEngine === "claude" && activeSessionId !== DRAFT_ID) ? activeSessionId : null;
  const acpSessionId = activeEngine === "acp"
    ? (activeSessionId !== DRAFT_ID ? activeSessionId : draftAcpSessionId)
    : null;
  const codexSessionId = (activeEngine === "codex" && activeSessionId !== DRAFT_ID) ? activeSessionId : null;
  const ollamaSessionId = (activeEngine === "ollama" && activeSessionId !== DRAFT_ID) ? activeSessionId : null;
  const codexSessionModel = (activeEngine === "codex" && activeSessionId !== DRAFT_ID)
    ? (sessions.find((s) => s.id === activeSessionId)?.model ?? startOptions.model)
    : undefined;
  const codexPlanModeEnabled = activeEngine === "codex"
    ? (activeSessionId === DRAFT_ID
      ? !!startOptions.planMode
      : !!sessions.find((s) => s.id === activeSessionId)?.planMode)
    : false;

  // ── Engine hooks ──
  const claude = useClaude({ sessionId: claudeSessionId, initialMessages: activeEngine === "claude" ? initialMessages : [], initialMeta: activeEngine === "claude" ? initialMeta : null, initialPermission: activeEngine === "claude" ? initialPermission : null });
  const acp = useACP({
    sessionId: acpSessionId,
    initialMessages: isACP ? initialMessages : [],
    initialConfigOptions: isACP ? initialConfigOptions : undefined,
    initialSlashCommands: isACP ? initialSlashCommands : undefined,
    initialMeta: isACP ? initialMeta : null,
    initialPermission: isACP ? initialPermission : null,
    initialRawAcpPermission: isACP ? initialRawAcpPermission : null,
    acpPermissionBehavior,
  });
  const codex = useCodex({
    sessionId: codexSessionId,
    sessionModel: codexSessionModel,
    planModeEnabled: codexPlanModeEnabled,
    initialMessages: isCodex ? initialMessages : [],
    initialMeta: isCodex ? initialMeta : null,
    initialPermission: isCodex ? initialPermission : null,
  });
  const ollama = useOllama({
    sessionId: ollamaSessionId,
    initialMessages: isOllama ? initialMessages : [],
    initialMeta: isOllama ? initialMeta : null,
  });

  // Pick the active engine's state
  const engine = isOllama ? ollama : isCodex ? codex : isACP ? acp : claude;
  const { messages, totalCost, contextUsage } = engine;

  // ── All refs (21+) — kept for stale-closure avoidance ──
  const liveSessionIdsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const totalCostRef = useRef(totalCost);
  totalCostRef.current = totalCost;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const draftProjectIdRef = useRef(draftProjectId);
  draftProjectIdRef.current = draftProjectId;
  const startOptionsRef = useRef(startOptions);
  startOptionsRef.current = startOptions;
  const isProcessingRef = useRef(engine.isProcessing);
  isProcessingRef.current = engine.isProcessing;
  const isCompactingRef = useRef("isCompacting" in engine ? !!engine.isCompacting : false);
  isCompactingRef.current = "isCompacting" in engine ? !!engine.isCompacting : false;
  const isConnectedRef = useRef(engine.isConnected);
  isConnectedRef.current = engine.isConnected;
  const sessionInfoRef = useRef(engine.sessionInfo);
  sessionInfoRef.current = engine.sessionInfo;
  const pendingPermissionRef = useRef(engine.pendingPermission);
  pendingPermissionRef.current = engine.pendingPermission;
  // Prevent cross-session bleed: skip the first lastMessageAt sync after switching chats.
  const lastMessageSyncSessionRef = useRef<string | null>(null);
  const preStartedSessionIdRef = useRef<string | null>(null);
  preStartedSessionIdRef.current = preStartedSessionId;  // kept in sync with state for event routing
  const draftAcpSessionIdRef = useRef<string | null>(null);
  draftAcpSessionIdRef.current = draftAcpSessionId;
  const draftMcpStatusesRef = useRef<McpServerStatus[]>([]);
  draftMcpStatusesRef.current = draftMcpStatuses;
  const materializingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageQueueRef = useRef<Map<string, QueuedMessage[]>>(new Map());
  const acpAgentIdRef = useRef<string | null>(null);
  const acpAgentSessionIdRef = useRef<string | null>(null);
  const codexRawModelsRef = useRef(codexRawModels);
  codexRawModelsRef.current = codexRawModels;
  const codexEffortRef = useRef(codex.codexEffort);
  codexEffortRef.current = codex.codexEffort;
  // Tracks whether current Codex effort was explicitly chosen by the user.
  const codexEffortManualOverrideRef = useRef(false);
  const acpPermissionBehaviorRef = useRef<AcpPermissionBehavior>(acpPermissionBehavior);
  acpPermissionBehaviorRef.current = acpPermissionBehavior;
  // Stable ref to switchSession so toast callbacks don't capture stale closures
  const switchSessionRef = useRef<((id: string) => Promise<void>) | undefined>(undefined);
  // Stable ref for space switching — avoids adding onSpaceChange as a useCallback dependency
  const onSpaceChangeRef = useRef(onSpaceChange);
  onSpaceChangeRef.current = onSpaceChange;
  const backgroundStoreRef = useRef(new BackgroundSessionStore());

  // ── Codex effort helpers (kept in orchestrator — too small to extract) ──
  const setCodexEffortFromUser = useCallback((effort: string) => {
    codexEffortManualOverrideRef.current = true;
    codex.setCodexEffort(effort);
  }, [codex.setCodexEffort]);
  const applyCodexModelDefaultEffort = useCallback((effort: string | undefined) => {
    if (!effort || codexEffortManualOverrideRef.current) return;
    codex.setCodexEffort(effort);
  }, [codex.setCodexEffort]);
  const resetCodexEffortToModelDefault = useCallback((effort: string | undefined) => {
    if (!effort) return;
    codexEffortManualOverrideRef.current = false;
    codex.setCodexEffort(effort);
  }, [codex.setCodexEffort]);

  // ── Utility callbacks ──
  const findProject = useCallback((projectId: string) => {
    return projectsRef.current.find((p) => p.id === projectId) ?? null;
  }, []);

  const getProjectCwd = useCallback((project: Project) => {
    const selected = localStorage.getItem(`harnss-${project.id}-git-cwd`)?.trim();
    return selected || project.path;
  }, []);

  // ── Build shared refs/setters/engines objects for sub-hooks ──
  const refs: SharedSessionRefs = {
    activeSessionIdRef,
    sessionsRef,
    projectsRef,
    draftProjectIdRef,
    startOptionsRef,
    messagesRef,
    totalCostRef,
    contextUsageRef,
    isProcessingRef,
    isCompactingRef,
    isConnectedRef,
    sessionInfoRef,
    pendingPermissionRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    preStartedSessionIdRef,
    draftAcpSessionIdRef,
    draftMcpStatusesRef,
    materializingRef,
    saveTimerRef,
    messageQueueRef,
    acpAgentIdRef,
    acpAgentSessionIdRef,
    codexRawModelsRef,
    codexEffortRef,
    codexEffortManualOverrideRef,
    lastMessageSyncSessionRef,
    switchSessionRef,
    onSpaceChangeRef,
    acpPermissionBehaviorRef,
  };

  const setters: SharedSessionSetters = {
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
    setDraftAcpSessionId,
    setAcpConfigOptionsLoading,
    setDraftMcpStatuses,
    setAcpMcpStatuses,
    setQueuedCount,
    setCachedModels,
    setCodexRawModels,
    setCodexModelsLoadingMessage,
  };

  const engines: EngineHooks = {
    claude,
    acp,
    codex,
    ollama,
    engine,
  };

  // ── Compose sub-hooks ──
  const { enqueueMessage, clearQueue, unqueueMessage, sendQueuedMessageNext, sendNextId } = useMessageQueue({ refs, setters, engines, activeSessionId });

  const { saveCurrentSession, seedBackgroundStore, generateSessionTitle } = useSessionPersistence({
    refs,
    setters,
    engines,
    activeSessionId,
  });

  const {
    eagerStartSession,
    eagerStartAcpSession,
    prefetchCodexModels,
    probeMcpServers,
    abandonEagerSession,
    abandonDraftAcpSession,
    materializeDraft,
  } =
    useDraftMaterialization({
      refs,
      setters,
      engines,
      findProject,
      getProjectCwd,
      generateSessionTitle,
      applyCodexModelDefaultEffort,
    });

  const { reviveSession, reviveAcpSession, reviveCodexSession } = useSessionRevival({
    refs,
    setters,
    engines,
    findProject,
    getProjectCwd,
  });

  const {
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
  } = useSessionLifecycle({
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
  });

  const seedDevExampleConversation = useCallback(async () => {
    if (!import.meta.env.DEV) return;
    const { buildDevExampleConversation } = await import("../lib/dev-seeding/chat-seed");
    const base = Date.now();
    const seeded = buildDevExampleConversation(base);
    engine.setMessages((prev) => [...prev, ...seeded.messages]);
    const activeId = activeSessionIdRef.current;
    if (activeId && activeId !== DRAFT_ID) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? { ...s, lastMessageAt: seeded.lastMessageAt }
            : s,
        ),
      );
    }
  }, [engine, setSessions]);

  const refreshSessions = useCallback(async (projectIds?: string[]) => {
    const ids = (projectIds && projectIds.length > 0)
      ? projectIds
      : projectsRef.current.map((p) => p.id);
    if (ids.length === 0) return;
    const uniqueIds = [...new Set(ids)];
    const lists = await Promise.all(uniqueIds.map((projectId) => window.claude.sessions.list(projectId)));
    const refreshed = lists.flat().map((s) => ({
      ...s,
      isActive: s.id === activeSessionIdRef.current,
    }));
    setSessions((prev) => {
      const keep = prev.filter((s) => !uniqueIds.includes(s.projectId));
      const map = new Map<string, ChatSession>();
      [...keep, ...refreshed].forEach((s) => map.set(s.id, s));
      return Array.from(map.values()).sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));
    });
  }, [setSessions]);

  // ── Derived state ──
  const isDraft = activeSessionId === DRAFT_ID;
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  // ── Return (identical interface to original) ──
  return {
    sessions,
    activeSessionId,
    activeSession,
    isDraft,
    draftProjectId,
    createSession,
    switchSession,
    deselectSession,
    deleteSession,
    renameSession,
    importCCSession,
    setActiveModel,
    setActivePermissionMode,
    setActivePlanMode,
    setActiveThinking,
    setActiveClaudeEffort,
    setActiveClaudeModelAndEffort,
    restartActiveSessionInCurrentWorktree,
    setDraftAgent,
    messages: engine.messages,
    isProcessing: engine.isProcessing,
    isConnected: engine.isConnected || isDraft,
    sessionInfo: engine.sessionInfo,
    totalCost: engine.totalCost,
    send,
    unqueueMessage,
    sendQueuedMessageNext,
    sendNextId,
    seedDevExampleConversation,
    refreshSessions,
    queuedCount,
    stop: engine.stop,
    interrupt: async () => {
      // Clear queued messages before interrupting
      clearQueue();
      // During ACP startup (DRAFT + processing), abort the pending start process
      if (activeSessionIdRef.current === DRAFT_ID
          && startOptionsRef.current.engine === "acp"
          && isProcessingRef.current) {
        if (draftAcpSessionIdRef.current && liveSessionIdsRef.current.has(draftAcpSessionIdRef.current)) {
          await window.claude.acp.cancel(draftAcpSessionIdRef.current);
        } else {
          await window.claude.acp.abortPendingStart();
        }
        acp.setIsProcessing(false);
        return;
      }
      await engine.interrupt();
    },
    pendingPermission: engine.pendingPermission,
    respondPermission: engine.respondPermission,
    contextUsage: engine.contextUsage,
    isCompacting: "isCompacting" in engine ? !!engine.isCompacting : false,
    compact: engine.compact,
    slashCommands: isCodex
      ? codex.slashCommands
      : isACP
        ? acp.slashCommands
        : claude.slashCommands,
    acpConfigOptions: acp.configOptions,
    acpConfigOptionsLoading,
    setACPConfig: acp.setConfig,
    mcpServerStatuses: isACP || isCodex
      ? (acpMcpStatuses.length > 0 ? acpMcpStatuses : draftMcpStatuses)
      : (claude.mcpServerStatuses.length > 0 ? claude.mcpServerStatuses : draftMcpStatuses),
    mcpStatusPreliminary: isDraft && draftMcpStatuses.length > 0 && (
      isACP || isCodex ? acpMcpStatuses.length === 0 : claude.mcpServerStatuses.length === 0
    ),
    refreshMcpStatus: isACP || isCodex
      ? (() => Promise.resolve())
      : (preStartedSessionId && isDraft)
        ? (async () => {
            const result = await window.claude.mcpStatus(preStartedSessionId);
            if (result.servers?.length) {
              setDraftMcpStatuses(result.servers.map(s => ({
                name: s.name,
                status: toMcpStatusState(s.status),
              })));
            }
          })
        : claude.refreshMcpStatus,
    reconnectMcpServer: isACP
      ? isDraft
        ? async (_name: string) => {
            // ACP draft: restart the hidden draft session so fresh auth is applied
            if (draftProjectIdRef.current) {
              abandonDraftAcpSession("mcp_reconnect");
              await probeMcpServers(draftProjectIdRef.current);
              await eagerStartAcpSession(draftProjectIdRef.current, startOptionsRef.current);
            }
          }
        : async (_name: string) => {
            // ACP live: restart session so fresh auth tokens are applied
            const currentId = activeSessionIdRef.current;
            const session = sessionsRef.current.find(s => s.id === currentId);
            if (!session) return;
            const servers = await window.claude.mcp.list(session.projectId);
            await restartAcpSession(servers);
          }
      : isCodex
        ? async (_name: string) => { /* Codex MCP reconnect: not yet implemented */ }
      : (preStartedSessionId && isDraft)
        ? (async (name: string) => {
            const result = await window.claude.mcpReconnect(preStartedSessionId, name);
            if (result?.restarted) {
              await new Promise(r => setTimeout(r, 3000));
            }
            const statusResult = await window.claude.mcpStatus(preStartedSessionId);
            if (statusResult.servers?.length) {
              setDraftMcpStatuses(statusResult.servers.map(s => ({
                name: s.name,
                status: toMcpStatusState(s.status),
              })));
            }
          })
        : claude.reconnectMcpServer,
    supportedModels: isCodex
      ? codex.codexModels
      : isACP
        ? []
        : claude.supportedModels.length > 0 ? claude.supportedModels : cachedModels,
    restartWithMcpServers: isACP
      ? isDraft
        ? async (servers: McpServerConfig[]) => {
            // ACP draft: restart the hidden session with the updated MCP server list
            if (draftProjectIdRef.current) {
              await probeMcpServers(draftProjectIdRef.current, servers);
              abandonDraftAcpSession("mcp_restart");
              await eagerStartAcpSession(draftProjectIdRef.current, startOptionsRef.current, servers);
            }
          }
        : async (servers: McpServerConfig[]) => {
            // ACP live: stop + restart session with updated MCP servers
            await restartAcpSession(servers);
          }
      : isCodex
        ? async (_servers: McpServerConfig[]) => { /* Codex MCP restart: not yet implemented */ }
      : (preStartedSessionId && isDraft)
        ? async (_servers: McpServerConfig[]) => {
            // Claude eager draft: stop old eager session and start fresh
            abandonEagerSession("mcp_restart");
            setDraftMcpStatuses(_servers.map(s => ({
              name: s.name,
              status: "pending" as const,
            })));
            if (draftProjectIdRef.current) {
              eagerStartSession(draftProjectIdRef.current, startOptionsRef.current);
            }
          }
        : claude.restartWithMcpServers,
    // File revert: only supported by Claude SDK engine
    revertFiles: activeEngine === "claude" ? claude.revertFiles : undefined,
    fullRevert: activeEngine === "claude" ? fullRevertSession : undefined,
    // Codex reasoning effort
    codexEffort: codex.codexEffort,
    setCodexEffort: setCodexEffortFromUser,
    codexAuthRequired: isCodex ? codex.authRequired : false,
    clearCodexAuthRequired: () => codex.setAuthRequired(false),
    codexRawModels,
    codexModelsLoadingMessage,
    // Codex plan steps (from turn/plan/updated events — separate from Claude's TodoWrite tool)
    codexTodoItems: codex.todoItems,
  };
}
