import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectManager } from "@/hooks/useProjectManager";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useSidebar } from "@/hooks/useSidebar";
import { useSpaceManager } from "@/hooks/useSpaceManager";
import { useSettings } from "@/hooks/useSettings";
import { useTheme } from "@/hooks/useTheme";
import { useSpaceTerminals } from "@/hooks/useSpaceTerminals";
import { useBackgroundAgents } from "@/hooks/useBackgroundAgents";
import { useAgentRegistry } from "@/hooks/useAgentRegistry";
import { useNotifications } from "@/hooks/useNotifications";
import { resolveModelValue } from "@/lib/model-utils";
import type { ToolId } from "@/components/ToolPicker";
import type { TodoItem, ImageAttachment, Space, SpaceColor, InstalledAgent, AcpPermissionBehavior, EngineId } from "@/types";
import type { NotificationSettings } from "@/types/ui";

export function useAppOrchestrator() {
  const sidebar = useSidebar();
  const projectManager = useProjectManager();
  const spaceManager = useSpaceManager();
  // Read ACP permission behavior early — it's a global setting (same localStorage key as useSettings)
  // so we can read it before useSettings which depends on manager.activeSession for per-project scoping
  const acpPermissionBehavior = (localStorage.getItem("harnss-acp-permission-behavior") ?? "ask") as AcpPermissionBehavior;
  const manager = useSessionManager(projectManager.projects, acpPermissionBehavior, spaceManager.setActiveSpaceId);

  // Derive activeProjectId early so useSettings can scope per-project
  const activeProjectId = manager.activeSession?.projectId ?? manager.draftProjectId;
  const activeProject = projectManager.projects.find((p) => p.id === activeProjectId);

  const [selectedAgent, setSelectedAgent] = useState<InstalledAgent | null>(null);
  const settingsEngine: EngineId = (!manager.isDraft && manager.activeSession?.engine)
    ? manager.activeSession.engine
    : (selectedAgent?.engine ?? "claude");
  const settings = useSettings(activeProjectId ?? null, settingsEngine);
  const resolvedTheme = useTheme(settings.theme);
  const showThinking = settingsEngine === "claude" ? settings.thinking : true;
  const activeProjectPath = settings.gitCwd ?? activeProject?.path;
  const { agents, refresh: refreshAgents, saveAgent, deleteAgent } = useAgentRegistry();

  const handleAgentChange = useCallback((agent: InstalledAgent | null) => {
    setSelectedAgent(agent);

    // If this agent would open a new chat, do it immediately on selection
    const currentEngine = manager.activeSession?.engine ?? "claude";
    const currentAgentId = manager.activeSession?.agentId;
    const wantedEngine = agent?.engine ?? "claude";
    const wantedAgentId = agent?.id;
    const wantedModel = settings.getModelForEngine(wantedEngine);
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
  }, [manager.setDraftAgent, manager.isDraft, manager.activeSession, manager.createSession, settings.getModelForEngine, settings.permissionMode, settings.planMode, settings.thinking]);

  // Engine is locked once a session is active (not draft) — null means free to switch
  const lockedEngine = !manager.isDraft && manager.activeSession?.engine
    ? manager.activeSession.engine
    : null;

  // Agent ID is locked for ACP sessions — switching agents must open a new chat
  const lockedAgentId = !manager.isDraft && manager.activeSession?.agentId
    ? manager.activeSession.agentId
    : null;

  // Persist ACP config options cache when live session provides them,
  // then refresh agent registry so next agent selection uses cached values
  useEffect(() => {
    const agentId = manager.activeSession?.agentId;
    if (!agentId || manager.activeSession?.engine !== "acp") return;
    if (!manager.acpConfigOptions?.length) return;

    window.claude.agents.updateCachedConfig(agentId, manager.acpConfigOptions)
      .then(() => refreshAgents());
  }, [manager.acpConfigOptions, manager.activeSession, refreshAgents]);

  const [showSettings, setShowSettings] = useState(false);

  // ── Glass/transparency support detection ──
  const [glassSupported, setGlassSupported] = useState(false);
  useEffect(() => {
    window.claude.getGlassEnabled().then((enabled) => setGlassSupported(enabled));
  }, []);

  // Toggle the glass-enabled CSS class when the transparency setting changes.
  // App.tsx adds the class on startup; this effect keeps it in sync with the toggle.
  useEffect(() => {
    if (!glassSupported) return;
    const root = document.documentElement;
    if (settings.transparency) {
      root.classList.add("glass-enabled");
    } else {
      root.classList.remove("glass-enabled");
    }
  }, [settings.transparency, glassSupported]);

  // ── Notification settings (loaded from main-process AppSettings) ──
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);

  // Load on mount + re-fetch when settings panel closes (so changes take effect immediately)
  useEffect(() => {
    window.claude.settings.get().then((s) => {
      if (s?.notifications) setNotificationSettings(s.notifications as NotificationSettings);
    });
  }, [showSettings]);

  // Fire OS notifications and sounds for permission prompts + session completion
  useNotifications({
    pendingPermission: manager.pendingPermission,
    notificationSettings,
    isProcessing: manager.isProcessing,
  });

  // When settings closes, fire resize so hidden tool panels (xterm) re-fit
  useEffect(() => {
    if (!showSettings) window.dispatchEvent(new Event("resize"));
  }, [showSettings]);

  const [spaceCreatorOpen, setSpaceCreatorOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | undefined>();
  // Focus turn index for the Changes panel (set by inline turn summary "View changes" click)
  const [changesPanelFocusTurn, setChangesPanelFocusTurn] = useState<number | undefined>();
  const spaceTerminals = useSpaceTerminals();

  const hasProjects = projectManager.projects.length > 0;

  // ── Tool toggle with suppression ──

  const handleToggleTool = useCallback(
    (toolId: ToolId) => {
      const isContextual = toolId === "tasks" || toolId === "agents";
      settings.setActiveTools((prev) => {
        const next = new Set(prev);
        if (next.has(toolId)) {
          next.delete(toolId);
          // User manually closed a contextual panel — suppress auto-open
          if (isContextual) settings.suppressPanel(toolId);
        } else {
          next.add(toolId);
          // User manually opened a contextual panel — clear suppression
          if (isContextual) settings.unsuppressPanel(toolId);
        }
        return next;
      });
    },
    [settings],
  );

  // Reorder panel tools in the ToolPicker (moves fromId to toId's position)
  const handleToolReorder = useCallback(
    (fromId: ToolId, toId: ToolId) => {
      const count = settings.toolOrder.filter(
        (id) => settings.activeTools.has(id) && ["terminal", "git", "browser", "files", "mcp", "changes"].includes(id),
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
      // Reset split ratios to equal when reordering (positional, not keyed)
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
      await manager.createSession(projectId, {
        model: settings.getModelForEngine(wantedEngine) || undefined,
        permissionMode: settings.permissionMode,
        planMode: settings.planMode,
        thinkingEnabled: settings.thinking,
        engine: wantedEngine,
        agentId: agent?.id ?? "claude-code",
        cachedConfigOptions: agent?.cachedConfigOptions,
      });
    },
    [manager.createSession, settings.getModelForEngine, settings.permissionMode, settings.planMode, settings.thinking, selectedAgent],
  );

  const handleSend = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      // If the selected agent/engine differs from the current session, start a new session first
      const currentEngine = manager.activeSession?.engine ?? "claude";
      const wantedEngine = selectedAgent?.engine ?? "claude";
      const currentAgentId = manager.activeSession?.agentId;
      const wantedAgentId = selectedAgent?.id;
      const wantedModel = settings.getModelForEngine(wantedEngine);
      const needsNewSession = !manager.isDraft && manager.activeSession && (
        currentEngine !== wantedEngine ||
        // Switching ACP agents within a session must also create a new chat
        (currentEngine === "acp" && wantedEngine === "acp" && currentAgentId !== wantedAgentId)
      );
      if (needsNewSession) {
        await manager.createSession(manager.activeSession!.projectId, {
          model: wantedModel || undefined,
          permissionMode: settings.permissionMode,
          planMode: settings.planMode,
          thinkingEnabled: settings.thinking,
          engine: wantedEngine,
          agentId: selectedAgent?.id ?? "claude-code",
          cachedConfigOptions: selectedAgent?.cachedConfigOptions,
        });
      }
      await manager.send(text, images, displayText);
    },
    [manager.send, manager.isDraft, manager.activeSession, manager.createSession, selectedAgent, settings.getModelForEngine, settings.permissionMode, settings.planMode, settings.thinking],
  );

  const handleModelChange = useCallback(
    (nextModel: string) => {
      settings.setModel(nextModel);
      manager.setActiveModel(nextModel);
    },
    [settings, manager.setActiveModel],
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

  const handleStop = useCallback(async () => {
    await manager.interrupt();
  }, [manager.interrupt]);

  // Wrap session selection to also close settings view
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setShowSettings(false);
      manager.switchSession(sessionId);
    },
    [manager.switchSession],
  );

  // Wrap project creation to also close settings view, assigning to the active space
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

  const handleNavigateToMessage = useCallback(
    (sessionId: string, messageId: string) => {
      manager.switchSession(sessionId);
      setTimeout(() => setScrollToMessageId(messageId), 200);
    },
    [manager.switchSession],
  );

  // Opens the Changes panel and focuses on a specific turn (from inline summary click)
  const handleViewTurnChanges = useCallback(
    (turnIndex: number) => {
      settings.setActiveTools((prev) => {
        if (prev.has("changes")) return prev;
        const next = new Set(prev);
        next.add("changes");
        return next;
      });
      setChangesPanelFocusTurn(turnIndex);
    },
    [settings],
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

  // ── Space <-> session tracking: switch to last used chat when changing spaces ──

  const LAST_SESSION_KEY = "harnss-last-session-per-space";
  const prevSpaceIdRef = useRef(spaceManager.activeSpaceId);

  // Helper: read the map from localStorage
  const readLastSessionMap = useCallback((): Record<string, string> => {
    try {
      const raw = localStorage.getItem(LAST_SESSION_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  // Save current session as last-used for its owning space whenever it changes.
  // Use the session's project space (not the currently selected space), because
  // space switching and session switching can be out of sync for one render.
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

  // When activeSpaceId changes, switch to last used session in that space
  useEffect(() => {
    const prev = prevSpaceIdRef.current;
    const next = spaceManager.activeSpaceId;
    prevSpaceIdRef.current = next;
    if (prev === next) return;

    // Find projects in the new space
    const spaceProjectIds = new Set(
      projectManager.projects
        .filter((p) => (p.spaceId || "default") === next)
        .map((p) => p.id),
    );

    // Check if current session is already in the new space
    if (manager.activeSession && spaceProjectIds.has(manager.activeSession.projectId)) {
      return; // Already in the right space
    }

    // Try to restore the last used session in this space
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

    // No remembered chat for this space: open a fresh draft chat in the space.
    // If the space has no projects, we can't create a draft chat yet.
    const firstProjectInSpace = projectManager.projects.find(
      (p) => (p.spaceId || "default") === next,
    );
    if (firstProjectInSpace) {
      void handleNewChat(firstProjectInSpace.id);
    } else {
      // No projects in this space — deselect
      manager.deselectSession();
    }
  }, [spaceManager.activeSpaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync model from loaded session (canonical runtime names -> picker values)
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

  // Sync selectedAgent when switching to a different session
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

    if (selectedAgent !== null) {
      setSelectedAgent(null);
    }
  }, [manager.activeSessionId, manager.isDraft, manager.sessions, agents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive the latest todo list — Codex uses turn/plan/updated events,
  // Claude uses TodoWrite tool calls in the message stream
  const activeTodos = useMemo(() => {
    // Codex engine: todos come from turn/plan/updated events
    if (manager.codexTodoItems && manager.codexTodoItems.length > 0) {
      return manager.codexTodoItems;
    }
    // Claude engine: todos derived from last TodoWrite tool call in messages
    for (let i = manager.messages.length - 1; i >= 0; i--) {
      const msg = manager.messages[i];
      if (
        msg.role === "tool_call" &&
        msg.toolName === "TodoWrite" &&
        msg.toolInput?.todos
      ) {
        return msg.toolInput.todos as TodoItem[];
      }
    }
    return [];
  }, [manager.messages, manager.codexTodoItems]);

  const bgAgents = useBackgroundAgents({
    sessionId: manager.activeSessionId,
  });

  // ── Contextual tools (tasks / agents) — auto-activate when data appears ──

  const hasTodos = activeTodos.length > 0;
  const hasAgents = bgAgents.agents.length > 0;

  const availableContextual = useMemo(() => {
    const s = new Set<ToolId>();
    if (hasTodos) s.add("tasks");
    if (hasAgents) s.add("agents");
    return s;
  }, [hasTodos, hasAgents]);

  // Auto-add contextual tools when data appears (unless suppressed)
  useEffect(() => {
    if (!hasTodos) {
      // Data gone — clear suppression so next session starts fresh
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

  // Cmd+Shift+P (Mac) / Ctrl+Shift+P — toggle plan mode for Claude and Codex engines
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "p") {
        e.preventDefault();
        const engine = manager.activeSession?.engine ?? selectedAgent?.engine ?? "claude";
        if (engine === "acp") return; // ACP doesn't support plan mode
        const next = !settings.planMode;
        settings.setPlanMode(next);
        manager.setActivePlanMode(next);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settings.planMode, settings.setPlanMode, manager.setActivePlanMode, manager.activeSession?.engine, selectedAgent?.engine]);

  // Sync InputBar controls when sessionInfo.permissionMode changes (e.g. ExitPlanMode)
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

  // Panel visibility flags
  const hasRightPanel = ((hasTodos && settings.activeTools.has("tasks")) || (hasAgents && settings.activeTools.has("agents"))) && !!manager.activeSessionId;
  const hasToolsColumn = (settings.activeTools.has("terminal") || settings.activeTools.has("browser") || settings.activeTools.has("git") || settings.activeTools.has("files") || settings.activeTools.has("mcp") || settings.activeTools.has("changes")) && !!manager.activeSessionId;

  // ── Dynamic Electron minimum window width ──
  const isIsland = settings.islandLayout;
  const margins = isIsland ? 16 : 0;
  const handleW = isIsland ? 8 : 1;
  const pickerW = isIsland ? 64 : 56;

  useEffect(() => {
    const sidebarW = sidebar.isOpen ? 260 : 0;
    let minW = sidebarW + margins + 768;

    if (manager.activeSessionId) {
      minW += pickerW;
      if (hasRightPanel) minW += 200 + handleW;
      if (hasToolsColumn) minW += 280 + handleW;
    }

    window.claude.setMinWidth(Math.max(minW, 600));
  }, [sidebar.isOpen, hasRightPanel, hasToolsColumn, manager.activeSessionId, margins, pickerW, handleW]);

  // When tools column becomes visible, fire resize so xterm terminals re-fit
  useEffect(() => {
    if (hasToolsColumn) window.dispatchEvent(new Event("resize"));
  }, [hasToolsColumn]);

  const activeSpaceTerminals = spaceTerminals.getSpaceState(spaceManager.activeSpaceId);

  return {
    // Core managers
    sidebar,
    projectManager,
    spaceManager,
    manager,
    settings,
    resolvedTheme,

    // Agent state
    agents,
    selectedAgent,
    saveAgent,
    deleteAgent,
    handleAgentChange,
    lockedEngine,
    lockedAgentId,

    // Derived state
    activeProjectId,
    activeProject,
    activeProjectPath,
    showThinking,
    settingsEngine,
    hasProjects,
    hasRightPanel,
    hasToolsColumn,
    activeTodos,
    bgAgents,
    hasTodos,
    hasAgents,
    availableContextual,
    glassSupported,

    // Settings view
    showSettings,
    setShowSettings,

    // Space creator
    spaceCreatorOpen,
    setSpaceCreatorOpen,
    editingSpace,

    // Scroll navigation
    scrollToMessageId,
    setScrollToMessageId,

    // Changes panel
    changesPanelFocusTurn,
    setChangesPanelFocusTurn,

    // Terminals
    spaceTerminals,
    activeSpaceTerminals,

    // Callbacks
    handleToggleTool,
    handleToolReorder,
    handleNewChat,
    handleSend,
    handleModelChange,
    handlePermissionModeChange,
    handlePlanModeChange,
    handleThinkingChange,
    handleStop,
    handleSelectSession,
    handleCreateProject,
    handleImportCCSession,
    handleNavigateToMessage,
    handleViewTurnChanges,
    handleCreateSpace,
    handleEditSpace,
    handleDeleteSpace,
    handleSaveSpace,
    handleMoveProjectToSpace,
  };
}
