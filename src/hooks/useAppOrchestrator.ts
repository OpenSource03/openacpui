import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectManager } from "@/hooks/useProjectManager";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useSecondaryPane } from "@/hooks/useSecondaryPane";
import { useSidebar } from "@/hooks/useSidebar";
import { useSpaceManager } from "@/hooks/useSpaceManager";
import { useSettings } from "@/hooks/useSettings";
import { useTheme } from "@/hooks/useTheme";
import { useSpaceTerminals } from "@/hooks/useSpaceTerminals";
import { useBackgroundAgents } from "@/hooks/useBackgroundAgents";
import { useAgentRegistry } from "@/hooks/useAgentRegistry";
import { useAcpAgentAutoUpdate } from "@/hooks/useAcpAgentAutoUpdate";
import { useNotifications } from "@/hooks/useNotifications";
import {
  APP_SIDEBAR_WIDTH,
  getMinChatWidth,
  getResizeHandleWidth,
  getToolPickerWidth,
  ISLAND_LAYOUT_MARGIN,
  WINDOWS_FRAME_BUFFER_WIDTH,
  MIN_RIGHT_PANEL_WIDTH,
  MIN_TOOLS_PANEL_WIDTH,
} from "@/lib/layout-constants";
import { resolveModelValue } from "@/lib/model-utils";
import { getStoredProjectGitCwd, resolveProjectForSpace } from "@/lib/space-projects";
import { getTodoItems } from "@/lib/todo-utils";
import { isWindows } from "@/lib/utils";
import { COLUMN_TOOL_IDS, type ToolId } from "@/components/ToolPicker";
import type { ImageAttachment, Space, SpaceColor, InstalledAgent, AcpPermissionBehavior, ClaudeEffort, EngineId, CodeSnippet } from "@/types";
import type { NotificationSettings } from "@/types/ui";

export function useAppOrchestrator() {
  const sidebar = useSidebar();
  const projectManager = useProjectManager();
  const spaceManager = useSpaceManager();
  const LAST_SESSION_KEY = "harnss-last-session-per-space";
  const acpPermissionBehavior = (localStorage.getItem("harnss-acp-permission-behavior") ?? "ask") as AcpPermissionBehavior;
  const manager = useSessionManager(projectManager.projects, acpPermissionBehavior, spaceManager.setActiveSpaceId);

  const activeProjectId = manager.activeSession?.projectId ?? manager.draftProjectId;
  const readLastSessionMap = useCallback((): Record<string, string> => {
    try {
      const raw = localStorage.getItem(LAST_SESSION_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [LAST_SESSION_KEY]);
  const activeSpaceProject = useMemo(
    () => resolveProjectForSpace({
      spaceId: spaceManager.activeSpaceId,
      activeProjectId,
      lastSessionBySpace: readLastSessionMap(),
      projects: projectManager.projects,
      sessions: manager.sessions,
    }),
    [spaceManager.activeSpaceId, activeProjectId, readLastSessionMap, projectManager.projects, manager.sessions],
  );
  const settingsProjectId = activeSpaceProject?.id ?? activeProjectId ?? null;
  const activeProject = projectManager.projects.find((p) => p.id === activeProjectId);

  const [selectedAgent, setSelectedAgent] = useState<InstalledAgent | null>(null);
  const settingsEngine: EngineId = (!manager.isDraft && manager.activeSession?.engine)
    ? manager.activeSession.engine
    : (selectedAgent?.engine ?? "claude");
  const settings = useSettings(settingsProjectId, settingsEngine);
  const resolvedTheme = useTheme(settings.theme);
  const showThinking = true;
  const activeProjectPath = settings.gitCwd ?? activeProject?.path;
  const { agents, refresh: refreshAgents, saveAgent, deleteAgent } = useAgentRegistry();

  const pane1 = useSecondaryPane();
  const [activePaneIndex, setActivePaneIndex] = useState<0 | 1>(0);
  const activePaneIndexRef = useRef<0 | 1>(0);
  activePaneIndexRef.current = activePaneIndex;
  useAcpAgentAutoUpdate({ installedAgents: agents, refreshInstalledAgents: refreshAgents });
  const getClaudeEffortForModel = useCallback((model: string | undefined): ClaudeEffort | undefined => {
    if (!model) return undefined;
    const meta = manager.supportedModels.find((entry) => entry.value === model);
    if (!meta?.supportsEffort) return undefined;
    const levels = meta.supportedEffortLevels ?? [];
    if (levels.includes(settings.claudeEffort)) return settings.claudeEffort;
    if (levels.includes("high")) return "high";
    return levels[0];
  }, [manager.supportedModels, settings.claudeEffort]);

  const handleAgentWorktreeChange = useCallback((nextPath: string | null) => {
    if (activePaneIndex === 1 && settings.splitMode) {
      settings.setPane1GitCwd(nextPath);
      return;
    }

    settings.setGitCwd(nextPath);

    if (manager.activeSessionId && !manager.isDraft && manager.activeSession) {
      const engine = manager.activeSession.engine ?? "claude";
      manager.createSession(manager.activeSession.projectId, {
        model: settings.getModelForEngine(engine) || undefined,
        permissionMode: settings.permissionMode,
        planMode: settings.planMode,
        thinkingEnabled: settings.thinking,
        effort: engine === "claude"
          ? getClaudeEffortForModel(settings.getModelForEngine("claude") || undefined)
          : undefined,
        engine,
        agentId: manager.activeSession.agentId,
      });
    }
  }, [activePaneIndex, settings, manager.activeSessionId, manager.isDraft, manager.activeSession, manager.createSession, getClaudeEffortForModel]);

  const handleAgentChange = useCallback((agent: InstalledAgent | null) => {
    setSelectedAgent(agent);

    const currentEngine = manager.activeSession?.engine ?? "claude";
    const currentAgentId = manager.activeSession?.agentId;
    const wantedEngine = agent?.engine ?? "claude";
    const wantedAgentId = agent?.id;
    const wantedModel = settings.getModelForEngine(wantedEngine);
    const wantedClaudeEffort = wantedEngine === "claude"
      ? getClaudeEffortForModel(wantedModel || undefined)
      : undefined;
    const needsNewSession = !manager.isDraft && manager.activeSession && (
      currentEngine !== wantedEngine ||
      (currentEngine === "acp" && wantedEngine === "acp" && currentAgentId !== wantedAgentId)
    );

    if (needsNewSession) {
      manager.createSession(manager.activeSession!.projectId, {
        model: wantedModel || undefined,
        permissionMode: settings.permissionMode,
        planMode: settings.planMode,
        thinkingEnabled: settings.thinking,
        effort: wantedClaudeEffort,
        engine: wantedEngine,
        agentId: agent?.id ?? "claude-code",
        cachedConfigOptions: agent?.cachedConfigOptions,
      });
    } else {
      manager.setDraftAgent(
        wantedEngine,
        agent?.id ?? "claude-code",
        agent?.cachedConfigOptions,
        wantedModel || undefined,
      );
    }
  }, [manager.setDraftAgent, manager.isDraft, manager.activeSession, manager.createSession, settings.getModelForEngine, settings.permissionMode, settings.planMode, settings.thinking, getClaudeEffortForModel]);

  const lockedEngine = !manager.isDraft && manager.activeSession?.engine
    ? manager.activeSession.engine
    : null;

  const lockedAgentId = !manager.isDraft && manager.activeSession?.agentId
    ? manager.activeSession.agentId
    : null;

  useEffect(() => {
    const agentId = manager.activeSession?.agentId;
    if (!agentId || manager.activeSession?.engine !== "acp") return;
    if (!manager.acpConfigOptions?.length) return;

    window.claude.agents.updateCachedConfig(agentId, manager.acpConfigOptions)
      .then(() => refreshAgents());
  }, [manager.acpConfigOptions, manager.activeSession, refreshAgents]);

  const handleFocusPane = useCallback((pane: 0 | 1) => {
    setActivePaneIndex(pane);
  }, []);

  const handleToggleSplit = useCallback(() => {
    const next = !settings.splitMode;
    settings.setSplitMode(next);
    if (!next) {
      setActivePaneIndex(0);
      pane1.clearSecondarySession();
    }
  }, [settings, pane1.clearSecondarySession]);

  const [showSettings, setShowSettings] = useState(false);

  const [glassSupported, setGlassSupported] = useState(false);
  useEffect(() => {
    window.claude.getGlassSupported().then((supported) => setGlassSupported(supported));
  }, []);

  useEffect(() => {
    if (!glassSupported) return;
    const root = document.documentElement;
    if (settings.transparency) {
      root.classList.add("glass-enabled");
    } else {
      root.classList.remove("glass-enabled");
    }
  }, [settings.transparency, glassSupported]);

  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [devFillEnabled, setDevFillEnabled] = useState(false);
  const [jiraBoardEnabled, setJiraBoardEnabled] = useState(false);

  useEffect(() => {
    window.claude.settings.get().then((s) => {
      if (s?.notifications) setNotificationSettings(s.notifications as NotificationSettings);
      setDevFillEnabled(import.meta.env.DEV && !!s?.showDevFillInChatTitleBar);
      setJiraBoardEnabled(!!s?.showJiraBoard);
    });
  }, [showSettings]);

  const handleFocusPane0FromNotification = useCallback(() => handleFocusPane(0), [handleFocusPane]);
  const handleFocusPane1FromNotification = useCallback(() => handleFocusPane(1), [handleFocusPane]);

  useNotifications({
    pendingPermission: manager.pendingPermission,
    notificationSettings,
    activeSessionId: manager.activeSessionId,
    isProcessing: manager.isProcessing,
    paneLabel: settings.splitMode ? "Tab 1" : undefined,
    onNotificationClick: settings.splitMode ? handleFocusPane0FromNotification : undefined,
  });

  useNotifications({
    pendingPermission: pane1.pendingPermission,
    notificationSettings,
    activeSessionId: pane1.sessionId,
    isProcessing: pane1.isProcessing,
    paneLabel: settings.splitMode ? "Tab 2" : undefined,
    onNotificationClick: settings.splitMode ? handleFocusPane1FromNotification : undefined,
  });

  useEffect(() => {
    if (!showSettings) window.dispatchEvent(new Event("resize"));
  }, [showSettings]);

  const [spaceCreatorOpen, setSpaceCreatorOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | undefined>();
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const spaceTerminals = useSpaceTerminals();

  const hasProjects = projectManager.projects.length > 0;


  const handleToggleTool = useCallback(
    (toolId: ToolId) => {
      const isContextual = toolId === "tasks" || toolId === "agents";
      settings.setActiveTools((prev) => {
        const next = new Set(prev);
        if (next.has(toolId)) {
          next.delete(toolId);
          if (isContextual) settings.suppressPanel(toolId);
        } else {
          next.add(toolId);
          if (isContextual) settings.unsuppressPanel(toolId);
        }
        return next;
      });
    },
    [settings],
  );

  const handleToolReorder = useCallback(
    (fromId: ToolId, toId: ToolId) => {
      const count = settings.toolOrder.filter(
        (id) => settings.activeTools.has(id) && COLUMN_TOOL_IDS.has(id),
      ).length;
      settings.setToolOrder((prev) => {
        const next = [...prev];
        const fromIdx = next.indexOf(fromId);
        const toIdx = next.indexOf(toId);
        if (fromIdx < 0 || toIdx < 0) return prev;
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, fromId);
        return next;
      });
      if (count > 1) {
        settings.setToolsSplitRatios(new Array<number>(count).fill(1 / count));
        settings.saveToolsSplitRatios();
      }
    },
    [settings],
  );

  const handleNewChat = useCallback(
    async (projectId: string) => {
      setShowSettings(false);
      const agent = selectedAgent;
      const wantedEngine = agent?.engine ?? "claude";
      const wantedModel = settings.getModelForEngine(wantedEngine) || undefined;
      await manager.createSession(projectId, {
        model: wantedModel,
        permissionMode: settings.permissionMode,
        planMode: settings.planMode,
        thinkingEnabled: settings.thinking,
        effort: wantedEngine === "claude" ? getClaudeEffortForModel(wantedModel) : undefined,
        engine: wantedEngine,
        agentId: agent?.id ?? "claude-code",
        cachedConfigOptions: agent?.cachedConfigOptions,
      });
    },
    [manager.createSession, settings.getModelForEngine, settings.permissionMode, settings.planMode, settings.thinking, getClaudeEffortForModel, selectedAgent],
  );

  const handleSend = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string, codeSnippets?: CodeSnippet[]) => {
      const agent = selectedAgent;
      const currentEngine = manager.activeSession?.engine ?? "claude";
      const wantedEngine = agent?.engine ?? "claude";
      const currentAgentId = manager.activeSession?.agentId;
      const wantedAgentId = agent?.id;
      const wantedModel = settings.getModelForEngine(wantedEngine);
      const needsNewSession = !manager.isDraft && manager.activeSession && currentEngine !== "group" && (
        currentEngine !== wantedEngine ||
        (currentEngine === "acp" && wantedEngine === "acp" && currentAgentId !== wantedAgentId)
      );
      if (needsNewSession) {
        await manager.createSession(manager.activeSession!.projectId, {
          model: wantedModel || undefined,
          permissionMode: settings.permissionMode,
          planMode: settings.planMode,
          thinkingEnabled: settings.thinking,
          effort: wantedEngine === "claude" ? getClaudeEffortForModel(wantedModel || undefined) : undefined,
          engine: wantedEngine,
          agentId: agent?.id ?? "claude-code",
          cachedConfigOptions: agent?.cachedConfigOptions,
        });
      }
      await manager.send(text, images, displayText, codeSnippets);
    },
    [manager.send, manager.isDraft, manager.activeSession, manager.createSession, selectedAgent, settings.getModelForEngine, settings.permissionMode, settings.planMode, settings.thinking, getClaudeEffortForModel],
  );

  const handleModelChange = useCallback(
    (nextModel: string) => {
      settings.setModel(nextModel);
      manager.setActiveModel(nextModel);
      if (settingsEngine !== "claude") return;
      const nextEffort = getClaudeEffortForModel(nextModel);
      if (!nextEffort || nextEffort === settings.claudeEffort) return;
      settings.setClaudeEffort(nextEffort);
    },
    [settings, settingsEngine, manager.setActiveModel, getClaudeEffortForModel],
  );

  const handlePermissionModeChange = useCallback(
    (nextMode: string) => {
      settings.setPermissionMode(nextMode);
      manager.setActivePermissionMode(nextMode);
    },
    [settings, manager.setActivePermissionMode],
  );

  const handlePlanModeChange = useCallback(
    (enabled: boolean) => {
      settings.setPlanMode(enabled);
      manager.setActivePlanMode(enabled);
    },
    [settings, manager.setActivePlanMode],
  );

  const handleThinkingChange = useCallback(
    (enabled: boolean) => {
      settings.setThinking(enabled);
      manager.setActiveThinking(enabled);
    },
    [settings, manager.setActiveThinking],
  );

  const handleClaudeModelEffortChange = useCallback(
    (model: string, effort: ClaudeEffort) => {
      settings.setModel(model);
      settings.setClaudeEffort(effort);
      manager.setActiveClaudeModelAndEffort(model, effort);
    },
    [settings, manager.setActiveClaudeModelAndEffort],
  );

  const handleStop = useCallback(async () => {
    await manager.interrupt();
  }, [manager.interrupt]);

  const handleSendQueuedNow = useCallback(async (messageId: string) => {
    await manager.sendQueuedMessageNext(messageId);
  }, [manager.sendQueuedMessageNext]);

  const handleUnqueueMessage = useCallback((messageId: string) => {
    manager.unqueueMessage(messageId);
  }, [manager.unqueueMessage]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setShowSettings(false);
      if (settings.splitMode) {
        if (activePaneIndex === 1) {
          void pane1.switchSecondarySession(sessionId, manager.sessions, manager.getBackgroundSessionState);
        } else {
          manager.switchSession(sessionId);
        }
      } else {
        manager.switchSession(sessionId);
      }
    },
    [activePaneIndex, settings.splitMode, pane1.switchSecondarySession, manager.switchSession, manager.sessions, manager.getBackgroundSessionState],
  );

  const handleCreateProject = useCallback(async () => {
    setShowSettings(false);
    await projectManager.createProject(spaceManager.activeSpaceId);
  }, [projectManager.createProject, spaceManager.activeSpaceId]);

  const handleImportCCSession = useCallback(
    async (projectId: string, ccSessionId: string) => {
      await manager.importCCSession(projectId, ccSessionId);
    },
    [manager.importCCSession],
  );

  const handleSeedDevExampleSpaceData = useCallback(async () => {
    if (!import.meta.env.DEV) return;
    const { seedDevExampleSpaceData } = await import("@/lib/dev-seeding/space-seeding");
    await seedDevExampleSpaceData({
      activeSpaceId: spaceManager.activeSpaceId,
      existingProjects: projectManager.projects,
      createDevProject: projectManager.createDevProject,
      saveSession: window.claude.sessions.save,
      refreshSessions: manager.refreshSessions,
    });
  }, [spaceManager.activeSpaceId, projectManager.projects, projectManager.createDevProject, manager.refreshSessions]);

  const handleNavigateToMessage = useCallback(
    (sessionId: string, messageId: string) => {
      manager.switchSession(sessionId);
      setTimeout(() => setScrollToMessageId(messageId), 200);
    },
    [manager.switchSession],
  );

  const handleCreateSpace = useCallback(() => {
    setEditingSpace(null);
    setSpaceCreatorOpen(true);
  }, []);

  const handleEditSpace = useCallback((space: Space) => {
    setEditingSpace(space);
    setSpaceCreatorOpen(true);
  }, []);

  const handleDeleteSpace = useCallback(
    async (id: string) => {
      const deletedId = await spaceManager.deleteSpace(id);
      if (deletedId) {
        await spaceTerminals.destroySpaceTerminals(deletedId);
        for (const p of projectManager.projects) {
          if (p.spaceId === deletedId) {
            await projectManager.updateProjectSpace(p.id, "default");
          }
        }
      }
    },
    [spaceManager.deleteSpace, spaceTerminals, projectManager.projects, projectManager.updateProjectSpace],
  );

  const handleSaveSpace = useCallback(
    async (name: string, icon: string, iconType: "emoji" | "lucide", color: SpaceColor) => {
      if (editingSpace) {
        await spaceManager.updateSpace(editingSpace.id, { name, icon, iconType, color });
      } else {
        await spaceManager.createSpace(name, icon, iconType, color);
      }
    },
    [editingSpace, spaceManager.updateSpace, spaceManager.createSpace],
  );

  const handleMoveProjectToSpace = useCallback(
    async (projectId: string, spaceId: string) => {
      await projectManager.updateProjectSpace(projectId, spaceId);
    },
    [projectManager.updateProjectSpace],
  );


  const prevSpaceIdRef = useRef(spaceManager.activeSpaceId);

  const activeSpaceTerminalCwdBase = activeSpaceProject
    ? (getStoredProjectGitCwd(activeSpaceProject.id) ?? activeSpaceProject.path)
    : null;
  const activeSpaceTerminalCwd = (settings.splitMode && activePaneIndex === 1)
    ? (settings.pane1GitCwd ?? activeSpaceTerminalCwdBase)
    : activeSpaceTerminalCwdBase;

  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft) return;
    const active = manager.sessions.find((s) => s.id === manager.activeSessionId);
    if (!active) return;
    const project = projectManager.projects.find((p) => p.id === active.projectId);
    if (!project) return;
    const sessionSpaceId = project.spaceId || "default";
    const map = readLastSessionMap();
    map[sessionSpaceId] = manager.activeSessionId;
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(map));
  }, [manager.activeSessionId, manager.isDraft, manager.sessions, projectManager.projects, readLastSessionMap]);

  useEffect(() => {
    const prev = prevSpaceIdRef.current;
    const next = spaceManager.activeSpaceId;
    prevSpaceIdRef.current = next;
    if (prev === next) return;

    const spaceProjectIds = new Set(
      projectManager.projects
        .filter((p) => (p.spaceId || "default") === next)
        .map((p) => p.id),
    );

    if (manager.activeSession && spaceProjectIds.has(manager.activeSession.projectId)) {
      return;
    }

    const map = readLastSessionMap();
    const lastSessionId = map[next];
    if (lastSessionId) {
      const session = manager.sessions.find(
        (s) => s.id === lastSessionId && spaceProjectIds.has(s.projectId),
      );
      if (session) {
        manager.switchSession(session.id);
        return;
      }
    }

    const firstProjectInSpace = projectManager.projects.find(
      (p) => (p.spaceId || "default") === next,
    );
    if (firstProjectInSpace) {
      void handleNewChat(firstProjectInSpace.id);
    } else {
      manager.deselectSession();
    }
  }, [spaceManager.activeSpaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft || manager.supportedModels.length === 0) return;
    const session = manager.sessions.find((s) => s.id === manager.activeSessionId);
    if (!session?.model) return;

    const sessionEngine = session.engine ?? "claude";
    const syncedModel = resolveModelValue(session.model, manager.supportedModels) ?? session.model;
    if (syncedModel !== settings.getModelForEngine(sessionEngine)) {
      settings.setModelForEngine(sessionEngine, syncedModel);
    }
  }, [manager.activeSessionId, manager.isDraft, manager.sessions, manager.supportedModels, settings.getModelForEngine, settings.setModelForEngine]);

  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft) return;
    const session = manager.sessions.find((s) => s.id === manager.activeSessionId);
    if (!session) return;

    if (session.engine === "acp" && session.agentId) {
      const agent = agents.find((a) => a.id === session.agentId);
      if (agent && selectedAgent?.id !== agent.id) {
        setSelectedAgent(agent);
      }
      return;
    }

    if (session.engine === "codex") {
      const codexAgent = (session.agentId
        ? agents.find((a) => a.id === session.agentId)
        : undefined) ?? agents.find((a) => a.engine === "codex");
      if (codexAgent && selectedAgent?.id !== codexAgent.id) {
        setSelectedAgent(codexAgent);
      }
      return;
    }

    if (session.engine === "openclaw") {
      const openclawAgent = agents.find((a) => a.engine === "openclaw");
      if (openclawAgent && selectedAgent?.id !== openclawAgent.id) {
        setSelectedAgent(openclawAgent);
      }
      return;
    }

    if (session.engine === "group") {
      if (selectedAgent?.id !== "__groups__") {
        setSelectedAgent({ id: "__groups__", name: "Agent Groups", engine: "group" as EngineId, builtIn: true });
      }
      return;
    }

    if (selectedAgent !== null) {
      setSelectedAgent(null);
    }
  }, [manager.activeSessionId, manager.isDraft, manager.sessions, agents]); // eslint-disable-line react-hooks/exhaustive-deps

  const todoMsgCount = manager.messages.length;
  const activeTodos = useMemo(() => {
    if (manager.codexTodoItems && manager.codexTodoItems.length > 0) {
      return manager.codexTodoItems;
    }
    for (let i = manager.messages.length - 1; i >= 0; i--) {
      const msg = manager.messages[i];
      if (
        msg.role === "tool_call" &&
        msg.toolName === "TodoWrite" &&
        msg.toolInput &&
        "todos" in msg.toolInput
      ) {
        return getTodoItems(msg.toolInput.todos);
      }
    }
    return [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoMsgCount, manager.codexTodoItems]);

  const bgAgents = useBackgroundAgents({
    sessionId: manager.activeSessionId,
  });


  const hasTodos = activeTodos.length > 0;
  const hasAgents = bgAgents.agents.length > 0;

  const availableContextual = useMemo(() => {
    const s = new Set<ToolId>();
    if (hasTodos) s.add("tasks");
    if (hasAgents) s.add("agents");
    return s;
  }, [hasTodos, hasAgents]);

  useEffect(() => {
    if (!hasTodos) {
      settings.unsuppressPanel("tasks");
      return;
    }
    if (settings.suppressedPanels.has("tasks")) return;
    settings.setActiveTools((prev) => {
      if (prev.has("tasks")) return prev;
      const next = new Set(prev);
      next.add("tasks");
      return next;
    });
  }, [hasTodos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hasAgents) {
      settings.unsuppressPanel("agents");
      return;
    }
    if (settings.suppressedPanels.has("agents")) return;
    settings.setActiveTools((prev) => {
      if (prev.has("agents")) return prev;
      const next = new Set(prev);
      next.add("agents");
      return next;
    });
  }, [hasAgents]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "p") {
        e.preventDefault();
        const engine = manager.activeSession?.engine ?? selectedAgent?.engine ?? "claude";
        if (engine === "acp" || engine === "openclaw") return;
        const next = !settings.planMode;
        settings.setPlanMode(next);
        manager.setActivePlanMode(next);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settings.planMode, settings.setPlanMode, manager.setActivePlanMode, manager.activeSession?.engine, selectedAgent?.engine]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
        if (!manager.activeSessionId) return;
        e.preventDefault();
        setChatSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [manager.activeSessionId]);

  useEffect(() => {
    setChatSearchOpen(false);
  }, [manager.activeSessionId]);

  useEffect(() => {
    const mode = manager.sessionInfo?.permissionMode;
    if (!mode) return;
    if (mode === "plan") {
      if (!settings.planMode) settings.setPlanMode(true);
      manager.setActivePlanMode(true);
      return;
    }
    if (settings.planMode) settings.setPlanMode(false);
    manager.setActivePlanMode(false);
    if (mode !== settings.permissionMode) settings.setPermissionMode(mode);
  }, [manager.sessionInfo?.permissionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft || !manager.activeSession) return;
    const nextPlanMode = !!manager.activeSession.planMode;
    if (settings.planMode !== nextPlanMode) settings.setPlanMode(nextPlanMode);
  }, [manager.activeSessionId, manager.activeSession?.planMode, manager.isDraft, settings.planMode, settings.setPlanMode]);

  const hasRightPanel = ((hasTodos && settings.activeTools.has("tasks")) || (hasAgents && settings.activeTools.has("agents"))) && !!manager.activeSessionId;
  const hasToolsColumn = [...settings.activeTools].some((id) => COLUMN_TOOL_IDS.has(id) && !settings.bottomTools.has(id)) && !!manager.activeSessionId;
  const hasBottomTools = [...settings.activeTools].some((id) => COLUMN_TOOL_IDS.has(id) && settings.bottomTools.has(id)) && !!manager.activeSessionId;

  const isIsland = settings.islandLayout;
  const minChatWidth = getMinChatWidth(isIsland);
  const margins = isIsland ? ISLAND_LAYOUT_MARGIN : 0;
  const handleW = getResizeHandleWidth(isIsland);
  const pickerW = getToolPickerWidth(isIsland);
  const winFrameBuffer = isWindows ? WINDOWS_FRAME_BUFFER_WIDTH : 0;

  useEffect(() => {
    const sidebarW = sidebar.isOpen ? APP_SIDEBAR_WIDTH : 0;
    let minW = sidebarW + margins + minChatWidth + winFrameBuffer;

    if (manager.activeSessionId) {
      minW += pickerW;
      if (hasRightPanel) minW += MIN_RIGHT_PANEL_WIDTH + handleW;
      if (hasToolsColumn) minW += MIN_TOOLS_PANEL_WIDTH + handleW;
    }

    window.claude.setMinWidth(Math.max(minW, 600));
  }, [sidebar.isOpen, hasRightPanel, hasToolsColumn, manager.activeSessionId, minChatWidth, margins, pickerW, handleW]);

  useEffect(() => {
    if (hasToolsColumn || hasBottomTools) window.dispatchEvent(new Event("resize"));
  }, [hasToolsColumn, hasBottomTools]);

  const activeSpaceTerminals = spaceTerminals.getSpaceState(spaceManager.activeSpaceId);

  return {
    sidebar,
    projectManager,
    spaceManager,
    manager,
    settings,
    resolvedTheme,

    agents,
    selectedAgent,
    saveAgent,
    deleteAgent,
    handleAgentChange,
    lockedEngine,
    lockedAgentId,

    activeProjectId,
    activeProject,
    activeProjectPath,
    activeSpaceProject,
    activeSpaceTerminalCwd,
    showThinking,
    settingsEngine,
    hasProjects,
    hasRightPanel,
    hasToolsColumn,
    hasBottomTools,
    activeTodos,
    bgAgents,
    hasTodos,
    hasAgents,
    availableContextual,
    glassSupported,
    devFillEnabled,
    jiraBoardEnabled,

    showSettings,
    setShowSettings,

    spaceCreatorOpen,
    setSpaceCreatorOpen,
    editingSpace,

    scrollToMessageId,
    setScrollToMessageId,

    chatSearchOpen,
    setChatSearchOpen,

    spaceTerminals,
    activeSpaceTerminals,

    handleToggleTool,
    handleToolReorder,
    handleNewChat,
    handleSend,
    handleModelChange,
    handlePermissionModeChange,
    handlePlanModeChange,
    handleThinkingChange,
    handleClaudeModelEffortChange,
    handleAgentWorktreeChange,
    handleStop,
    handleSendQueuedNow,
    handleUnqueueMessage,
    handleSelectSession,
    handleCreateProject,
    handleImportCCSession,
    handleSeedDevExampleSpaceData,
    handleNavigateToMessage,
    handleCreateSpace,
    handleEditSpace,
    handleDeleteSpace,
    handleSaveSpace,
    handleMoveProjectToSpace,

    pane1,
    activePaneIndex,
    handleFocusPane,
    handleToggleSplit,
  };
}
