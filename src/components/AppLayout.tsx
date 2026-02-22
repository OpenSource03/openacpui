import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectManager } from "@/hooks/useProjectManager";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useSidebar } from "@/hooks/useSidebar";
import { useSpaceManager } from "@/hooks/useSpaceManager";
import { useSettings } from "@/hooks/useSettings";
import { AppSidebar } from "./AppSidebar";
import { ChatHeader } from "./ChatHeader";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { PermissionPrompt } from "./PermissionPrompt";
import { TodoPanel } from "./TodoPanel";
import { BackgroundAgentsPanel } from "./BackgroundAgentsPanel";
import { ToolPicker } from "./ToolPicker";
import type { ToolId } from "./ToolPicker";
import { WelcomeScreen } from "./WelcomeScreen";
import { SpaceCreator } from "./SpaceCreator";
import { ToolsPanel } from "./ToolsPanel";
import { BrowserPanel } from "./BrowserPanel";
import { GitPanel } from "./GitPanel";
import { FilesPanel } from "./FilesPanel";
import { McpPanel } from "./McpPanel";
import { useBackgroundAgents } from "@/hooks/useBackgroundAgents";
import { useAgentRegistry } from "@/hooks/useAgentRegistry";
import { isMac } from "@/lib/utils";
import type { TodoItem, ImageAttachment, Space, SpaceColor, AgentDefinition } from "@/types";

export function AppLayout() {
  const sidebar = useSidebar();
  const projectManager = useProjectManager();
  const spaceManager = useSpaceManager();
  const manager = useSessionManager(projectManager.projects);

  // Derive activeProjectId early so useSettings can scope per-project
  const activeProjectId = manager.activeSession?.projectId ?? manager.draftProjectId;
  const activeProjectPath = projectManager.projects.find((p) => p.id === activeProjectId)?.path;

  const settings = useSettings(activeProjectId ?? null);
  const { agents } = useAgentRegistry();

  const [selectedAgent, setSelectedAgent] = useState<AgentDefinition | null>(null);
  const handleAgentChange = useCallback((agent: AgentDefinition | null) => {
    setSelectedAgent(agent);
    manager.setDraftAgent(agent?.engine ?? "claude", agent?.id ?? "claude-code");
  }, [manager.setDraftAgent]);

  // Engine is locked once a session is active (not draft) — null means free to switch
  const lockedEngine = !manager.isDraft && manager.activeSession?.engine
    ? manager.activeSession.engine
    : null;

  const [spaceCreatorOpen, setSpaceCreatorOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | undefined>();
  const [glassOverlayStyle, setGlassOverlayStyle] = useState<React.CSSProperties | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const hasProjects = projectManager.projects.length > 0;

  // ── Tool toggle with suppression ──

  const handleToggleTool = useCallback(
    (toolId: ToolId) => {
      const isContextual = toolId === "tasks" || toolId === "agents";
      settings.setActiveTools((prev) => {
        const next = new Set(prev);
        if (next.has(toolId)) {
          next.delete(toolId);
          // User manually closed a contextual panel → suppress auto-open
          if (isContextual) settings.suppressPanel(toolId);
        } else {
          next.add(toolId);
          // User manually opened a contextual panel → clear suppression
          if (isContextual) settings.unsuppressPanel(toolId);
        }
        return next;
      });
    },
    [settings],
  );

  const handleNewChat = useCallback(
    async (projectId: string) => {
      const agent = selectedAgent;
      await manager.createSession(projectId, {
        model: settings.model,
        permissionMode: settings.permissionMode,
        engine: agent?.engine ?? "claude",
        agentId: agent?.id ?? "claude-code",
      });
    },
    [manager.createSession, settings.model, settings.permissionMode, selectedAgent],
  );

  const handleSend = useCallback(
    async (text: string, images?: ImageAttachment[]) => {
      // If the selected agent's engine differs from the current session, start a new session first
      const currentEngine = manager.activeSession?.engine ?? "claude";
      const wantedEngine = selectedAgent?.engine ?? "claude";
      if (!manager.isDraft && currentEngine !== wantedEngine && manager.activeSession) {
        await manager.createSession(manager.activeSession.projectId, {
          model: settings.model,
          permissionMode: settings.permissionMode,
          engine: wantedEngine,
          agentId: selectedAgent?.id ?? "claude-code",
        });
      }
      await manager.send(text, images);
    },
    [manager.send, manager.isDraft, manager.activeSession, manager.createSession, selectedAgent, settings.model, settings.permissionMode],
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

  const handleStop = useCallback(async () => {
    await manager.interrupt();
  }, [manager.interrupt]);

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
        for (const p of projectManager.projects) {
          if (p.spaceId === deletedId) {
            await projectManager.updateProjectSpace(p.id, "default");
          }
        }
      }
    },
    [spaceManager.deleteSpace, projectManager.projects, projectManager.updateProjectSpace],
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

  // ── Space ↔ session tracking: switch to last used chat when changing spaces ──

  const LAST_SESSION_KEY = "openacpui-last-session-per-space";
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

  // Save current session as last-used for current space whenever it changes
  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft) return;
    const map = readLastSessionMap();
    map[spaceManager.activeSpaceId] = manager.activeSessionId;
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(map));
  }, [manager.activeSessionId, manager.isDraft, spaceManager.activeSpaceId, readLastSessionMap]);

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

    // Fall back to the most recent session in any project in this space
    const spaceSessions = manager.sessions
      .filter((s) => spaceProjectIds.has(s.projectId))
      .sort((a, b) => b.createdAt - a.createdAt);

    if (spaceSessions.length > 0) {
      manager.switchSession(spaceSessions[0].id);
    } else {
      // No sessions in this space — deselect
      manager.deselectSession();
    }
  }, [spaceManager.activeSpaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Space color tinting
  useEffect(() => {
    const space = spaceManager.activeSpace;
    const root = document.documentElement;
    const isGlass = root.classList.contains("glass-enabled");

    if (!space || space.color.chroma === 0) {
      root.style.removeProperty("--space-hue");
      root.style.removeProperty("--space-chroma");
      root.style.removeProperty("--island-overlay-bg");
      setGlassOverlayStyle(null);
      return;
    }

    const { hue, chroma } = space.color;
    root.style.setProperty("--space-hue", String(hue));
    root.style.setProperty("--space-chroma", String(chroma));

    const bgChroma = Math.min(chroma, 0.008);
    const accentChroma = Math.min(chroma, 0.015);
    const isDark = root.classList.contains("dark");

    if (isDark) {
      root.style.setProperty("--background", `oklch(0.185 ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(0.3 ${accentChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(0.34 ${bgChroma} ${hue})`);
      if (!isGlass) {
        root.style.setProperty("--sidebar", `oklch(0.175 ${bgChroma} ${hue})`);
        root.style.setProperty("--sidebar-accent", `oklch(0.28 ${accentChroma} ${hue})`);
      }
    } else {
      root.style.setProperty("--background", `oklch(1 ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(0.965 ${accentChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(0.922 ${bgChroma} ${hue})`);
      if (!isGlass) {
        root.style.setProperty("--sidebar", `oklch(0.985 ${bgChroma} ${hue})`);
        root.style.setProperty("--sidebar-accent", `oklch(0.965 ${accentChroma} ${hue})`);
      }
    }

    const gradientHue = space.color.gradientHue;
    const c = Math.min(chroma, 0.15);

    if (isGlass) {
      const a = isDark ? 0.08 : 0.05;
      const bg = gradientHue !== undefined
        ? `linear-gradient(135deg, oklch(0.5 ${c} ${hue} / ${a}), oklch(0.5 ${c} ${gradientHue} / ${a}))`
        : `oklch(0.5 ${c} ${hue} / ${a})`;
      setGlassOverlayStyle({ background: bg });
    } else {
      setGlassOverlayStyle(null);
    }

    if (gradientHue !== undefined) {
      const a = isDark ? 0.07 : 0.05;
      // Set CSS custom prop so .island::before picks up the gradient on ALL islands
      root.style.setProperty(
        "--island-overlay-bg",
        `linear-gradient(135deg, oklch(0.5 ${c} ${hue} / ${a}), oklch(0.5 ${c} ${gradientHue} / ${a}))`,
      );
    } else {
      root.style.removeProperty("--island-overlay-bg");
    }

    return () => {
      const vars = ["--space-hue", "--space-chroma", "--background", "--accent", "--border", "--sidebar", "--sidebar-accent", "--island-overlay-bg"];
      for (const v of vars) root.style.removeProperty(v);
      setGlassOverlayStyle(null);
    };
  }, [spaceManager.activeSpace]);

  // Sync model from loaded session
  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft) return;
    const session = manager.sessions.find((s) => s.id === manager.activeSessionId);
    if (session?.model && session.model !== settings.model) {
      settings.setModel(session.model);
    }
  }, [manager.activeSessionId, manager.isDraft, manager.sessions]); // eslint-disable-line react-hooks/exhaustive-deps

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
    } else if (session.engine !== "acp" && selectedAgent !== null) {
      setSelectedAgent(null);
    }
  }, [manager.activeSessionId, manager.isDraft, manager.sessions, agents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive the latest todo list from the most recent TodoWrite tool call
  const activeTodos = useMemo(() => {
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
  }, [manager.messages]);

  const bgAgents = useBackgroundAgents({
    messages: manager.messages,
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
      // Data gone → clear suppression so next session starts fresh
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

  // ── Layout constraints ──
  // Minimum chat width to keep it usable when panels are open
  const MIN_CHAT_WIDTH = 380;
  // ToolPicker strip (w-14 = 56px) + its left margin (ms-2 = 8px)
  const TOOL_PICKER_WIDTH = 64;
  const RESIZE_HANDLE_WIDTH = 8;

  const contentRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  // ── Right panel resize ──

  const MIN_PANEL_WIDTH = 200;
  const MAX_PANEL_WIDTH = 500;

  const rightPanelWidthRef = useRef(settings.rightPanelWidth);
  rightPanelWidthRef.current = settings.rightPanelWidth;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = rightPanelWidthRef.current;
      // Capture tools panel visibility at drag start
      const toolsVisible = !!toolsColumnRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        // Dynamically cap so the chat always keeps MIN_CHAT_WIDTH
        const containerWidth = contentRef.current?.clientWidth ?? window.innerWidth;
        let reserved = MIN_CHAT_WIDTH + TOOL_PICKER_WIDTH + RESIZE_HANDLE_WIDTH;
        if (toolsVisible) {
          reserved += toolsPanelWidthRef.current + RESIZE_HANDLE_WIDTH;
        }
        const dynamicMax = Math.max(MIN_PANEL_WIDTH, containerWidth - reserved);

        const delta = startX - ev.clientX;
        const next = Math.max(MIN_PANEL_WIDTH, Math.min(Math.min(MAX_PANEL_WIDTH, dynamicMax), startWidth + delta));
        settings.setRightPanelWidth(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveRightPanelWidth();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings],
  );

  // ── Tools panel resize ──

  const MIN_TOOLS_WIDTH = 280;
  const MAX_TOOLS_WIDTH = 800;

  const toolsPanelWidthRef = useRef(settings.toolsPanelWidth);
  toolsPanelWidthRef.current = settings.toolsPanelWidth;

  const handleToolsResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = toolsPanelWidthRef.current;
      // Capture right panel visibility at drag start
      const rightVisible = !!rightPanelRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        // Dynamically cap so the chat always keeps MIN_CHAT_WIDTH
        const containerWidth = contentRef.current?.clientWidth ?? window.innerWidth;
        let reserved = MIN_CHAT_WIDTH + TOOL_PICKER_WIDTH + RESIZE_HANDLE_WIDTH;
        if (rightVisible) {
          reserved += rightPanelWidthRef.current + RESIZE_HANDLE_WIDTH;
        }
        const dynamicMax = Math.max(MIN_TOOLS_WIDTH, containerWidth - reserved);

        const delta = startX - ev.clientX;
        const next = Math.max(MIN_TOOLS_WIDTH, Math.min(Math.min(MAX_TOOLS_WIDTH, dynamicMax), startWidth + delta));
        settings.setToolsPanelWidth(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveToolsPanelWidth();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings],
  );

  // ── Tools vertical split ratio ──

  const toolsSplitRef = useRef(settings.toolsSplitRatio);
  toolsSplitRef.current = settings.toolsSplitRatio;
  const toolsColumnRef = useRef<HTMLDivElement>(null);

  const handleToolsSplitStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startY = e.clientY;
      const startRatio = toolsSplitRef.current;
      const columnEl = toolsColumnRef.current;
      if (!columnEl) return;
      const columnHeight = columnEl.getBoundingClientRect().height;

      const onMouseMove = (ev: MouseEvent) => {
        const deltaY = ev.clientY - startY;
        const deltaRatio = deltaY / columnHeight;
        const next = Math.max(0.2, Math.min(0.8, startRatio + deltaRatio));
        settings.setToolsSplitRatio(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveToolsSplitRatio();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings],
  );

  // Sync InputBar toggle when sessionInfo.permissionMode changes (e.g. ExitPlanMode)
  useEffect(() => {
    const mode = manager.sessionInfo?.permissionMode;
    if (mode && mode !== settings.permissionMode) {
      settings.setPermissionMode(mode);
    }
  }, [manager.sessionInfo?.permissionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const { activeTools } = settings;

  return (
    <div className="relative flex h-screen overflow-hidden bg-sidebar text-foreground">
      {/* Glass tint overlay — sits behind content, tints the native transparency */}
      {glassOverlayStyle && (
        <div
          className="pointer-events-none fixed inset-0 z-0 transition-[background] duration-300"
          style={glassOverlayStyle}
        />
      )}
      <SpaceCreator
        open={spaceCreatorOpen}
        onOpenChange={setSpaceCreatorOpen}
        editingSpace={editingSpace}
        onSave={handleSaveSpace}
      />
      <AppSidebar
        isOpen={sidebar.isOpen}
        projects={projectManager.projects}
        sessions={manager.sessions}
        activeSessionId={manager.activeSessionId}
        onNewChat={handleNewChat}
        onSelectSession={manager.switchSession}
        onDeleteSession={manager.deleteSession}
        onRenameSession={manager.renameSession}
        onCreateProject={projectManager.createProject}
        onDeleteProject={projectManager.deleteProject}
        onRenameProject={projectManager.renameProject}
        onImportCCSession={handleImportCCSession}
        onToggleSidebar={sidebar.toggle}
        onNavigateToMessage={handleNavigateToMessage}
        onMoveProjectToSpace={handleMoveProjectToSpace}
        onReorderProject={projectManager.reorderProject}
        spaces={spaceManager.spaces}
        activeSpaceId={spaceManager.activeSpaceId}
        onSelectSpace={spaceManager.setActiveSpaceId}
        onCreateSpace={handleCreateSpace}
        onEditSpace={handleEditSpace}
        onDeleteSpace={handleDeleteSpace}
      />

      <div ref={contentRef} className={`flex min-w-0 flex-1 ms-2 me-2 my-2 ${isResizing ? "select-none" : ""}`}>
        <div className="island relative flex min-w-[380px] flex-1 flex-col overflow-hidden rounded-lg bg-background">
          {manager.activeSessionId ? (
            <>
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-24 bg-gradient-to-b from-black to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
                <ChatHeader
                  sidebarOpen={sidebar.isOpen}
                  isProcessing={manager.isProcessing}
                  model={manager.sessionInfo?.model}
                  sessionId={manager.sessionInfo?.sessionId}
                  totalCost={manager.totalCost}
                  title={manager.activeSession?.title}
                  permissionMode={manager.sessionInfo?.permissionMode}
                  onToggleSidebar={sidebar.toggle}
                />
              </div>
              <ChatView
                messages={manager.messages}
                extraBottomPadding={!!manager.pendingPermission}
                scrollToMessageId={scrollToMessageId}
                onScrolledToMessage={() => setScrollToMessageId(undefined)}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-24 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
                {manager.pendingPermission ? (
                  <PermissionPrompt
                    request={manager.pendingPermission}
                    onRespond={manager.respondPermission}
                  />
                ) : (
                  <InputBar
                    onSend={handleSend}
                    onStop={handleStop}
                    isProcessing={manager.isProcessing}
                    model={settings.model}
                    thinking={settings.thinking}
                    permissionMode={settings.permissionMode}
                    onModelChange={handleModelChange}
                    onThinkingChange={settings.setThinking}
                    onPermissionModeChange={handlePermissionModeChange}
                    projectPath={activeProjectPath}
                    contextUsage={manager.contextUsage}
                    isCompacting={manager.isCompacting}
                    onCompact={manager.compact}
                    agents={agents}
                    selectedAgent={selectedAgent}
                    onAgentChange={handleAgentChange}
                    acpConfigOptions={manager.acpConfigOptions}
                    onACPConfigChange={manager.setACPConfig}
                    supportedModels={manager.supportedModels}
                    lockedEngine={lockedEngine}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <div
                className={`drag-region flex h-12 items-center px-3 ${
                  !sidebar.isOpen && isMac ? "ps-[78px]" : ""
                }`}
              >
                {!sidebar.isOpen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="no-drag h-7 w-7 text-muted-foreground/60 hover:text-foreground"
                    onClick={sidebar.toggle}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <WelcomeScreen
                hasProjects={hasProjects}
                onCreateProject={projectManager.createProject}
              />
            </>
          )}
        </div>

        {((hasTodos && activeTools.has("tasks")) || (hasAgents && activeTools.has("agents"))) && manager.activeSessionId && (
          <>
            {/* Resize handle */}
            <div
              className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
              onMouseDown={handleResizeStart}
            >
              <div
                className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${
                  isResizing
                    ? "bg-foreground/40"
                    : "bg-transparent group-hover:bg-foreground/25"
                }`}
              />
            </div>

            {/* Right panel — Tasks / Agents */}
            <div
              ref={rightPanelRef}
              className="flex shrink-0 flex-col gap-2 overflow-hidden"
              style={{ width: settings.rightPanelWidth }}
            >
              {hasTodos && activeTools.has("tasks") && (
                <div
                  className={`island flex flex-col overflow-hidden rounded-lg bg-background ${
                    hasAgents && activeTools.has("agents") ? "shrink-0" : "min-h-0 flex-1"
                  }`}
                  style={{ maxHeight: hasAgents && activeTools.has("agents") ? "50%" : undefined }}
                >
                  <TodoPanel todos={activeTodos} />
                </div>
              )}
              {hasAgents && activeTools.has("agents") && (
                <div className="island flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-background">
                  <BackgroundAgentsPanel agents={bgAgents.agents} onDismiss={bgAgents.dismissAgent} />
                </div>
              )}
            </div>
          </>
        )}

        {/* Tools panels — shown when toggled from picker */}
        {(activeTools.has("terminal") || activeTools.has("browser") || activeTools.has("git") || activeTools.has("files") || activeTools.has("mcp")) && manager.activeSessionId && (
          <>
            {/* Resize handle */}
            <div
              className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
              onMouseDown={handleToolsResizeStart}
            >
              <div
                className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${
                  isResizing
                    ? "bg-foreground/40"
                    : "bg-transparent group-hover:bg-foreground/25"
                }`}
              />
            </div>

            <div
              ref={toolsColumnRef}
              className="flex shrink-0 flex-col gap-0 overflow-hidden"
              style={{ width: settings.toolsPanelWidth }}
            >
              {(() => {
                const toolOrder: Array<{ id: string; node: React.ReactNode }> = [];
                if (activeTools.has("terminal"))
                  toolOrder.push({ id: "terminal", node: <ToolsPanel cwd={activeProjectPath} /> });
                if (activeTools.has("git"))
                  toolOrder.push({
                    id: "git",
                    node: (
                      <GitPanel
                        cwd={activeProjectPath}
                        collapsedRepos={settings.collapsedRepos}
                        onToggleRepoCollapsed={settings.toggleRepoCollapsed}
                      />
                    ),
                  });
                if (activeTools.has("browser"))
                  toolOrder.push({ id: "browser", node: <BrowserPanel /> });
                if (activeTools.has("files"))
                  toolOrder.push({
                    id: "files",
                    node: (
                      <FilesPanel
                        messages={manager.messages}
                        cwd={activeProjectPath}
                        onScrollToToolCall={setScrollToMessageId}
                      />
                    ),
                  });
                if (activeTools.has("mcp"))
                  toolOrder.push({
                    id: "mcp",
                    node: (
                      <McpPanel
                        projectId={activeProjectId ?? null}
                        runtimeStatuses={manager.mcpServerStatuses}
                        isPreliminary={manager.mcpStatusPreliminary}
                        hasLiveSession={!manager.isDraft}
                        onRefreshStatus={manager.refreshMcpStatus}
                        onReconnect={manager.reconnectMcpServer}
                        onRestartWithServers={manager.restartWithMcpServers}
                      />
                    ),
                  });

                const count = toolOrder.length;
                const gapPx = (count - 1) * 8;

                return toolOrder.map((tool, i) => (
                  <div key={tool.id} className="contents">
                    <div
                      className="island flex flex-col overflow-hidden rounded-lg bg-background"
                      style={
                        count === 1
                          ? { flex: "1 1 0%", minHeight: 0 }
                          : { height: `calc(${100 / count}% - ${gapPx / count}px)`, flexShrink: 0 }
                      }
                    >
                      {tool.node}
                    </div>
                    {i < count - 1 && (
                      <div
                        className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                        onMouseDown={handleToolsSplitStart}
                      >
                        <div
                          className={`w-10 h-0.5 rounded-full transition-colors duration-150 ${
                            isResizing
                              ? "bg-foreground/40"
                              : "bg-transparent group-hover:bg-foreground/25"
                          }`}
                        />
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
          </>
        )}

        {/* Tool picker — always visible */}
        {manager.activeSessionId && (
          <div className="ms-2 shrink-0">
            <ToolPicker activeTools={activeTools} onToggle={handleToggleTool} availableContextual={availableContextual} />
          </div>
        )}
      </div>
    </div>
  );
}
