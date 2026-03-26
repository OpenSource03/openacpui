import { useCallback, useRef, useEffect, useLayoutEffect, useState, useMemo } from "react";
import { PanelLeft, MessageSquare, Maximize2, Minimize2, Pin, PinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { normalizeRatios, type WorkspaceMode } from "@/hooks/useSettings";
import { useAppOrchestrator } from "@/hooks/useAppOrchestrator";
import { useSpaceTheme } from "@/hooks/useSpaceTheme";
import { usePanelResize } from "@/hooks/usePanelResize";
import {
  ISLAND_CONTROL_RADIUS,
  ISLAND_GAP,
  ISLAND_PANEL_GAP,
  ISLAND_RADIUS,
  RESIZE_HANDLE_WIDTH_ISLAND,
  TOOL_PICKER_WIDTH_ISLAND,
  getMinChatWidth,
} from "@/lib/layout-constants";
import type { GrabbedElement, InstalledAgent } from "@/types/ui";
import type { EngineId } from "@/types/engine";
import { AppSidebar } from "./AppSidebar";
import { ChatHeader } from "./ChatHeader";
import { ChatSearchBar } from "./ChatSearchBar";
import { ChatView } from "./ChatView";
import { BottomComposer } from "./BottomComposer";
import { TodoPanel } from "./TodoPanel";
import { BackgroundAgentsPanel } from "./BackgroundAgentsPanel";
import { ToolPicker, PANEL_TOOLS_MAP } from "./ToolPicker";
import { WelcomeScreen } from "./WelcomeScreen";
import { WelcomeWizard } from "./welcome/WelcomeWizard";
import { WELCOME_COMPLETED_KEY } from "./welcome/shared";
import { SpaceCreator } from "./SpaceCreator";
import { ToolsPanel } from "./ToolsPanel";
import { BrowserPanel } from "./BrowserPanel";
import { GitPanel } from "./GitPanel";
import { McpPanel } from "./McpPanel";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { GroupPanel } from "./groups/GroupPanel";
import { ExecutionsPanel } from "./ExecutionsPanel";
import { SearchPanel } from "./SearchPanel";
import { useAgentGroups } from "@/hooks/useAgentGroups";
import { FilePreviewOverlay } from "./FilePreviewOverlay";
import { SettingsView } from "./SettingsView";
import { CodexAuthDialog } from "./CodexAuthDialog";
import { JiraBoardPanel } from "./JiraBoardPanel";
import { QuickOpenDialog } from "./QuickOpenDialog";
import { CodeWorkspace, type CodeOpenRequest } from "./CodeWorkspace";

import type { JiraIssue } from "@shared/types/jira";
import type { CodeSnippet } from "@/types/ui";
import { isMac } from "@/lib/utils";
import { getLanguageFromPath } from "@/lib/languages";

const JIRA_BOARD_BY_SPACE_KEY = "harnss-jira-board-by-space";
const NOOP = () => {};
const EMPTY_GRABBED: GrabbedElement[] = [];
const EMPTY_SLASH: never[] = [];
const EMPTY_ACP_OPTIONS: never[] = [];

function readJiraBoardBySpace(): Record<string, string> {
  try {
    const raw = localStorage.getItem(JIRA_BOARD_BY_SPACE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function AppLayout() {
  const o = useAppOrchestrator();
  const {
    sidebar, projectManager, spaceManager, manager, settings, resolvedTheme,
    agents, selectedAgent, saveAgent, deleteAgent, handleAgentChange,
    lockedEngine, lockedAgentId,
    activeProjectId, activeProjectPath, activeSpaceProject, activeSpaceTerminalCwd, showThinking,
    hasProjects, hasRightPanel, hasToolsColumn, hasBottomTools,
    activeTodos, bgAgents, hasTodos, hasAgents, availableContextual,
    glassSupported, devFillEnabled, jiraBoardEnabled,
    showSettings, setShowSettings,
    spaceCreatorOpen, setSpaceCreatorOpen, editingSpace,
    scrollToMessageId, setScrollToMessageId,
    chatSearchOpen, setChatSearchOpen,
    spaceTerminals, activeSpaceTerminals,
    handleToggleTool, handleToolReorder, handleNewChat, handleSend,
    handleModelChange, handlePermissionModeChange, handlePlanModeChange,
    handleClaudeModelEffortChange, handleAgentWorktreeChange, handleStop,
    handleSendQueuedNow, handleUnqueueMessage,
    handleCreateProject, handleImportCCSession, handleNavigateToMessage,
    handleCreateSpace, handleEditSpace,
    handleDeleteSpace, handleSaveSpace, handleMoveProjectToSpace,
    handleSeedDevExampleSpaceData,
    pane1, activePaneIndex, handleFocusPane, handleToggleSplit,
  } = o;

  const glassOverlayStyle = useSpaceTheme(
    spaceManager.activeSpace,
    resolvedTheme,
    glassSupported && settings.transparency,
  );
  const isGlassActive = glassSupported && settings.transparency;
  const isLightGlass = isGlassActive && resolvedTheme !== "dark";


  const [welcomeCompleted, setWelcomeCompleted] = useState(
    () => localStorage.getItem(WELCOME_COMPLETED_KEY) === "true",
  );

  const handleWelcomeComplete = useCallback(() => {
    localStorage.setItem(WELCOME_COMPLETED_KEY, "true");
    setWelcomeCompleted(true);
  }, []);

  const handleReplayWelcome = useCallback(() => {
    localStorage.removeItem(WELCOME_COMPLETED_KEY);
    setWelcomeCompleted(false);
    setShowSettings(false);
  }, [setShowSettings]);


  const handleFocusPane0 = useCallback(() => handleFocusPane(0), [handleFocusPane]);
  const handleFocusPane1 = useCallback(() => handleFocusPane(1), [handleFocusPane]);

  const agentGroups = useAgentGroups();

  const [openclawAgentId, setOpenclawAgentId] = useState("");
  useEffect(() => {
    window.claude.settings.get().then((s) => {
      if (s?.openclawDefaultAgent) setOpenclawAgentId(s.openclawDefaultAgent);
    });
  }, []);
  const handleOpenclawAgentChange = useCallback((agentId: string) => {
    setOpenclawAgentId(agentId);
    window.claude.settings.set({ openclawDefaultAgent: agentId });
  }, []);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  useEffect(() => {
    const isGroup = selectedAgent?.engine === "group";
    if (isGroup && agentGroups.groups.length > 0) {
      const sessionGroupId = manager.activeSession?.groupId;
      const target = sessionGroupId ?? agentGroups.groups[0].id;
      if (!selectedGroupId || (sessionGroupId && selectedGroupId !== sessionGroupId)) {
        setSelectedGroupId(target);
      }
    }
    if (!isGroup && selectedGroupId) {
      setSelectedGroupId(null);
    }
  }, [selectedAgent?.engine, selectedGroupId, agentGroups.groups, manager.activeSession?.groupId]);
  useEffect(() => {
    const selectedGroup = selectedGroupId
      ? agentGroups.groups.find((g) => g.id === selectedGroupId)
      : null;
    manager.setDraftGroupId(selectedGroupId, selectedGroup?.slots);
  }, [selectedGroupId, manager.setDraftGroupId, agentGroups.groups]);
  const handleGroupSend = useCallback(async (groupId: string, prompt: string, cwd?: string) => {
    const result = await window.claude.groups.startSession({
      groupId,
      prompt,
      cwd: cwd ?? activeProjectPath,
      projectId: activeProjectId ?? undefined,
    });
    if (result.ok && result.sessionId) {
      window.dispatchEvent(new CustomEvent("harnss:session-saved"));
    }
  }, [activeProjectPath, activeProjectId]);

  const agentsWithGroups = useMemo(() => {
    if (agentGroups.groups.length === 0) return agents;
    const groupsAgent: InstalledAgent = {
      id: "__groups__",
      name: "Agent Groups",
      engine: "group" as EngineId,
      builtIn: true,
    };
    return [...agents, groupsAgent];
  }, [agents, agentGroups.groups.length]);


  const [grabbedElements, setGrabbedElements] = useState<GrabbedElement[]>([]);

  const handleElementGrab = useCallback((element: GrabbedElement) => {
    setGrabbedElements((prev) => [...prev, element]);
  }, []);

  const handleRemoveGrabbedElement = useCallback((id: string) => {
    setGrabbedElements((prev) => prev.filter((e) => e.id !== id));
  }, []);


  const [previewFile, setPreviewFile] = useState<{ path: string; sourceRect: DOMRect | null } | null>(null);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [editorOpenRequest, setEditorOpenRequest] = useState<CodeOpenRequest | null>(null);
  const [forceOpenFloatingToken, setForceOpenFloatingToken] = useState(0);
  const [workspaceActiveFilePath, setWorkspaceActiveFilePath] = useState<string | null>(null);
  const [maximizedToolId, setMaximizedToolId] = useState<string | null>(null);
  const [pinnedToolId, setPinnedToolId] = useState<string | null>(null);
  const backdropCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleBackdropClick = useCallback(() => {
    if (backdropCloseTimeoutRef.current) clearTimeout(backdropCloseTimeoutRef.current);
    backdropCloseTimeoutRef.current = setTimeout(() => setMaximizedToolId(null), 120);
  }, []);
  const [codeSnippets0, setCodeSnippets0] = useState<CodeSnippet[]>([]);
  const [codeSnippets1, setCodeSnippets1] = useState<CodeSnippet[]>([]);
  const handleAddToChat = useCallback((code: string, filePath: string, lineStart: number, lineEnd: number, targetPane?: number) => {
    const snippet: CodeSnippet = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      code,
      filePath,
      lineStart,
      lineEnd,
      language: getLanguageFromPath(filePath) ?? "text",
    };
    if (targetPane === 1) {
      setCodeSnippets1((prev) => [...prev, snippet]);
    } else {
      setCodeSnippets0((prev) => [...prev, snippet]);
    }
  }, []);
  const handleRemoveCodeSnippet0 = useCallback((id: string) => {
    setCodeSnippets0((prev) => prev.filter((s) => s.id !== id));
  }, []);
  const handleRemoveCodeSnippet1 = useCallback((id: string) => {
    setCodeSnippets1((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handlePreviewFile = useCallback((filePath: string, sourceRect: DOMRect) => {
    setPreviewFile({ path: filePath, sourceRect });
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null);
  }, []);

  const openInCodeWorkspace = useCallback((filePath: string, line?: number, openInFloating = false) => {
    if (settings.workspaceMode === "chat") {
      settings.setWorkspaceMode("both");
    }
    setEditorOpenRequest({
      id: Date.now(),
      filePath,
      line,
      openInFloating,
    });
  }, [settings.setWorkspaceMode, settings.workspaceMode]);

  const handleQuickOpenFile = useCallback((filePath: string, line?: number) => {
    openInCodeWorkspace(filePath, line);
  }, [openInCodeWorkspace]);

  const handleEditorOpenRequestHandled = useCallback((requestId: number) => {
    setEditorOpenRequest((current) => (current && current.id === requestId ? null : current));
  }, []);

  const handleWorkspaceActiveFilePathChange = useCallback((filePath: string | null) => {
    setWorkspaceActiveFilePath(filePath);
  }, []);

  const [jiraBoardBySpace, setJiraBoardBySpace] = useState<Record<string, string>>(() => readJiraBoardBySpace());
  const jiraBoardProjectId = jiraBoardEnabled
    ? (jiraBoardBySpace[spaceManager.activeSpaceId] ?? null)
    : null;
  const jiraBoardProject = jiraBoardProjectId
    ? projectManager.projects.find((project) => project.id === jiraBoardProjectId) ?? null
    : null;
  const [pendingJiraTask, setPendingJiraTask] = useState<{ projectId: string; message: string } | null>(null);

  const setJiraBoardProjectForSpace = useCallback((spaceId: string, projectId: string | null) => {
    setJiraBoardBySpace((prev) => {
      const next = { ...prev };
      if (projectId) {
        next[spaceId] = projectId;
      } else {
        delete next[spaceId];
      }
      localStorage.setItem(JIRA_BOARD_BY_SPACE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const wrappedHandleSend = useCallback(
    (...args: Parameters<typeof handleSend>) => {
      handleSend(...args);
      setGrabbedElements([]);
      setCodeSnippets0([]);
    },
    [handleSend],
  );

  const pane1SendRef = useRef(pane1.send);
  pane1SendRef.current = pane1.send;
  const wrappedPane1Send = useCallback(
    (text: string, images?: Parameters<typeof pane1.send>[1]) => {
      void pane1SendRef.current(text, images);
      setCodeSnippets1([]);
    },
    [],
  );

  const handleOpenNewChat = useCallback(
    async (projectId: string) => {
      const project = projectManager.projects.find((item) => item.id === projectId);
      if (project) {
        setJiraBoardProjectForSpace(project.spaceId || "default", null);
      }
      await handleNewChat(projectId);
    },
    [handleNewChat, projectManager.projects, setJiraBoardProjectForSpace],
  );

  const handleComposerClear = useCallback(
    async () => {
      const projectId = activeProjectId ?? activeSpaceProject?.id;
      if (!projectId) return;
      setGrabbedElements([]);
      await handleOpenNewChat(projectId);
    },
    [activeProjectId, activeSpaceProject, handleOpenNewChat, setGrabbedElements],
  );

  const handleSidebarSelectSession = useCallback(
    (sessionId: string) => {
      const session = manager.sessions.find((item) => item.id === sessionId);
      const project = session
        ? projectManager.projects.find((item) => item.id === session.projectId)
        : null;
      if (project) {
        setJiraBoardProjectForSpace(project.spaceId || "default", null);
      }
      o.handleSelectSession(sessionId);
    },
    [o.handleSelectSession, manager.sessions, projectManager.projects, setJiraBoardProjectForSpace],
  );

  const handleToggleProjectJiraBoard = useCallback((projectId: string) => {
    const project = projectManager.projects.find((item) => item.id === projectId);
    if (!project) return;
    const spaceId = project.spaceId || "default";
    const currentProjectId = jiraBoardBySpace[spaceId];
    setJiraBoardProjectForSpace(spaceId, currentProjectId === projectId ? null : projectId);
  }, [jiraBoardBySpace, projectManager.projects, setJiraBoardProjectForSpace]);

  const handleCreateTaskFromJiraIssue = useCallback(
    (projectId: string, issue: JiraIssue) => {
      const taskMessage = `Please help me work on this Jira issue:

**${issue.key}: ${issue.summary}**

${issue.description ? `\n${issue.description}\n` : ""}
${issue.assignee ? `Assigned to: ${issue.assignee.displayName}\n` : ""}
Status: ${issue.status}
${issue.priority ? `Priority: ${issue.priority.name}\n` : ""}

Link: ${issue.url}`;

      const project = projectManager.projects.find((item) => item.id === projectId);
      if (project) {
        setJiraBoardProjectForSpace(project.spaceId || "default", null);
      }

      if (activeProjectId === projectId && manager.activeSessionId) {
        handleSend(taskMessage);
        return;
      }

      setPendingJiraTask({ projectId, message: taskMessage });
      void handleNewChat(projectId);
    },
    [activeProjectId, handleNewChat, handleSend, manager.activeSessionId, projectManager.projects, setJiraBoardProjectForSpace],
  );

  useEffect(() => {
    setJiraBoardBySpace((prev) => {
      let changed = false;
      const next: Record<string, string> = {};

      for (const [spaceId, projectId] of Object.entries(prev)) {
        const project = projectManager.projects.find((item) => item.id === projectId);
        if (!project) {
          changed = true;
          continue;
        }
        const projectSpaceId = project.spaceId || "default";
        if (next[projectSpaceId] !== projectId) {
          next[projectSpaceId] = projectId;
        }
        if (projectSpaceId !== spaceId) {
          changed = true;
        }
      }

      if (!changed && Object.keys(next).length === Object.keys(prev).length) {
        return prev;
      }
      localStorage.setItem(JIRA_BOARD_BY_SPACE_KEY, JSON.stringify(next));
      return next;
    });
  }, [projectManager.projects]);

  useEffect(() => {
    if (!pendingJiraTask) return;
    if (activeProjectId !== pendingJiraTask.projectId || !manager.activeSessionId) return;
    setPendingJiraTask(null);
    handleSend(pendingJiraTask.message);
  }, [activeProjectId, handleSend, manager.activeSessionId, pendingJiraTask]);

  useEffect(() => {
    if (jiraBoardEnabled) return;
    setJiraBoardBySpace((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      localStorage.removeItem(JIRA_BOARD_BY_SPACE_KEY);
      return {};
    });
  }, [jiraBoardEnabled]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && key === "p") {
        if (!activeProjectPath) return;
        e.preventDefault();
        setQuickOpenVisible((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeProjectPath]);

  const handleWorkspaceModeChange = useCallback((mode: WorkspaceMode) => {
    settings.setWorkspaceMode(mode);
  }, [settings.setWorkspaceMode]);

  const handleToggleDockedCodeMaximize = useCallback(() => {
    settings.setWorkspaceMode(settings.workspaceMode === "code" ? "both" : "code");
  }, [settings.setWorkspaceMode, settings.workspaceMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (!e.shiftKey && key === "1") {
        e.preventDefault();
        settings.setWorkspaceMode("chat");
        return;
      }
      if (!e.shiftKey && key === "2") {
        e.preventDefault();
        settings.setWorkspaceMode("code");
        return;
      }
      if (!e.shiftKey && key === "3") {
        e.preventDefault();
        settings.setWorkspaceMode("both");
        return;
      }
      if (e.shiftKey && key === "e") {
        e.preventDefault();
        if (settings.workspaceMode === "chat") settings.setWorkspaceMode("both");
        setForceOpenFloatingToken((prev) => prev + 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settings.setWorkspaceMode, settings.workspaceMode]);

  const isIsland = settings.islandLayout;
  const workspaceMode = settings.workspaceMode;
  const minChatWidth = getMinChatWidth(isIsland);
  const splitGap = isIsland ? RESIZE_HANDLE_WIDTH_ISLAND / 2 : 0.5;
  const islandLayoutVars = isIsland
    ? {
        "--island-gap": `${ISLAND_GAP}px`,
        "--island-panel-gap": `${ISLAND_PANEL_GAP}px`,
        "--island-radius": `${ISLAND_RADIUS}px`,
        "--island-control-radius": `${ISLAND_CONTROL_RADIUS}px`,
        "--tool-picker-strip-width": `${TOOL_PICKER_WIDTH_ISLAND - ISLAND_PANEL_GAP}px`,
      } as React.CSSProperties
    : undefined;

  const resize = usePanelResize({
    settings,
    isIsland,
    hasRightPanel,
    hasToolsColumn,
    activeSessionId: manager.activeSessionId,
    activeProjectId,
  });
  const {
    isResizing, contentRef, chatIslandRef: resizeChatIslandRef, rightPanelRef, toolsColumnRef, bottomToolsRowRef,
    normalizedToolRatiosRef, normalizedBottomRatiosRef,
    handleResizeStart, handleToolsResizeStart, handleToolsSplitStart, handleRightSplitStart,
    handleBottomResizeStart, handleBottomSplitStart, handleChatSplitStart,
  } = resize;
  const showChatWorkspace = workspaceMode !== "code";
  const showBothWorkspace = workspaceMode === "both";
  const splitMode = settings.splitMode && workspaceMode !== "code";
  const sidebarActiveSessionId = splitMode
    ? (activePaneIndex === 1 ? pane1.sessionId : manager.activeSessionId)
    : manager.activeSessionId;
  const workspaceSplitRatioRef = useRef(settings.workspaceSplitRatio);
  workspaceSplitRatioRef.current = settings.workspaceSplitRatio;

  const handleWorkspaceSplitStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const wrapper = resizeChatIslandRef.current;
    if (!wrapper) return;
    const startX = e.clientX;
    const startRatio = workspaceSplitRatioRef.current;
    const wrapperWidth = wrapper.getBoundingClientRect().width;
    if (wrapperWidth <= 0) return;

    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      const next = Math.max(0.3, Math.min(0.7, startRatio + delta / wrapperWidth));
      settings.setWorkspaceSplitRatio(next);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [resizeChatIslandRef, settings.setWorkspaceSplitRatio]);


  const chatIslandRef = useRef<HTMLDivElement>(null);
  const lastTopScrollProgressRef = useRef(0);

  useEffect(() => {
    setGrabbedElements([]);
  }, [manager.activeSessionId]);

  useLayoutEffect(() => {
    lastTopScrollProgressRef.current = 0;
    chatIslandRef.current?.style.setProperty("--chat-top-progress", "0");
  }, [manager.activeSessionId]);

  const handleTopScrollProgress = useCallback((progress: number) => {
    const clamped = Math.max(0, Math.min(1, progress));
    if (Math.abs(lastTopScrollProgressRef.current - clamped) < 0.005) return;
    lastTopScrollProgressRef.current = clamped;
    chatIslandRef.current?.style.setProperty("--chat-top-progress", clamped.toFixed(3));
  }, []);

  const handleScrolledToMessage = useCallback(() => {
    setScrollToMessageId(undefined);
  }, []);

  const handleRevert = useCallback((checkpointId: string) => {
    if (manager.isConnected && manager.revertFiles) {
      manager.revertFiles(checkpointId);
    }
  }, [manager.isConnected, manager.revertFiles]);

  const handleFullRevert = useCallback((checkpointId: string) => {
    if (manager.isConnected && manager.fullRevert) {
      manager.fullRevert(checkpointId);
    }
  }, [manager.isConnected, manager.fullRevert]);

  const spaceOpacity = spaceManager.activeSpace?.color.opacity ?? 1;
  const chatFadeStrength = Math.max(0.2, Math.min(1, spaceOpacity));

  const chatSurfaceColor = isLightGlass
    ? "color-mix(in oklab, white 97%, var(--background) 3%)"
    : "var(--background)";
  const titlebarOpacity = isLightGlass
    ? Math.round(69 + 14 * spaceOpacity)
    : Math.round(23 + 35 * spaceOpacity);
  const topFadeShadowOpacity = isLightGlass
    ? Math.round(13 + 15 * spaceOpacity)
    : Math.round(21 + 26 * spaceOpacity);
  const titlebarSurfaceColor =
    `linear-gradient(to bottom, color-mix(in oklab, ${chatSurfaceColor} ${titlebarOpacity}%, transparent) 0%, color-mix(in oklab, ${chatSurfaceColor} ${Math.max(titlebarOpacity - 3, 23)}%, transparent) 34%, color-mix(in oklab, ${chatSurfaceColor} ${Math.max(titlebarOpacity - 14, 11)}%, transparent) 68%, transparent 100%)`;
  const topFadeBackground = isIsland
    ? `linear-gradient(to bottom, color-mix(in oklab, ${chatSurfaceColor} 100%, black 4.5%) 0%, color-mix(in oklab, ${chatSurfaceColor} 97.5%, black 1.75%) 18%, color-mix(in oklab, ${chatSurfaceColor} 93.5%, transparent) 48%, transparent 100%), radial-gradient(138% 88% at 50% 0%, color-mix(in srgb, black ${topFadeShadowOpacity}%, transparent) 0%, transparent 70%)`
    : `linear-gradient(to bottom, ${chatSurfaceColor} 0%, ${chatSurfaceColor} 34%, color-mix(in oklab, ${chatSurfaceColor} 90.5%, transparent) 60%, transparent 100%), radial-gradient(142% 92% at 50% 0%, color-mix(in srgb, black ${topFadeShadowOpacity}%, transparent) 0%, transparent 72%)`;
  const bottomFadeBackground = `linear-gradient(to top, ${chatSurfaceColor}, transparent)`;

  const { activeTools } = settings;
  const showCodexAuthDialog =
    !!manager.activeSessionId &&
    manager.activeSession?.engine === "codex" &&
    manager.codexAuthRequired;

  return (
    <div
      className={`relative flex h-screen overflow-hidden bg-sidebar text-foreground${settings.islandLayout ? "" : " no-islands"}`}
      style={islandLayoutVars}
    >
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
        islandLayout={settings.islandLayout}
        projects={projectManager.projects}
        sessions={manager.sessions}
        activeSessionId={sidebarActiveSessionId}
        jiraBoardProjectId={jiraBoardProjectId}
        jiraBoardEnabled={jiraBoardEnabled}
        onNewChat={handleOpenNewChat}
        onToggleProjectJiraBoard={handleToggleProjectJiraBoard}
        onSelectSession={handleSidebarSelectSession}
        onDeleteSession={manager.deleteSession}
        onRenameSession={manager.renameSession}
        onCreateProject={handleCreateProject}
        onDeleteProject={projectManager.deleteProject}
        onRenameProject={projectManager.renameProject}
        onUpdateProjectIcon={projectManager.updateProjectIcon}
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
        onOpenSettings={() => setShowSettings(true)}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={handleWorkspaceModeChange}
        agents={agents}
        pane0SessionId={splitMode ? manager.activeSessionId : null}
        pane1SessionId={splitMode ? pane1.sessionId : null}
      />
      {!sidebar.isOpen && workspaceMode === "code" && (
        <div className="pointer-events-none absolute start-3 top-3 z-40">
          <Button
            variant="ghost"
            size="icon"
            className="no-drag pointer-events-auto h-8 w-8 rounded-md border border-foreground/10 bg-background/80 text-muted-foreground/70 shadow-sm backdrop-blur hover:bg-background hover:text-foreground"
            onClick={sidebar.toggle}
            title="Open sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div ref={contentRef} className={`flex min-w-0 flex-1 flex-col ${settings.islandLayout ? "m-[var(--island-gap)]" : sidebar.isOpen ? "flat-divider-s" : ""} ${isResizing ? "select-none" : ""}`}>
        {showSettings && (
          <SettingsView
            onClose={() => setShowSettings(false)}
            agents={agents}
            onSaveAgent={saveAgent}
            onDeleteAgent={deleteAgent}
            theme={settings.theme}
            onThemeChange={settings.setTheme}
            islandLayout={settings.islandLayout}
            onIslandLayoutChange={settings.setIslandLayout}
            autoGroupTools={settings.autoGroupTools}
            onAutoGroupToolsChange={settings.setAutoGroupTools}
            avoidGroupingEdits={settings.avoidGroupingEdits}
            onAvoidGroupingEditsChange={settings.setAvoidGroupingEdits}
            autoExpandTools={settings.autoExpandTools}
            onAutoExpandToolsChange={settings.setAutoExpandTools}
            transparentToolPicker={settings.transparentToolPicker}
            onTransparentToolPickerChange={settings.setTransparentToolPicker}
            coloredSidebarIcons={settings.coloredSidebarIcons}
            onColoredSidebarIconsChange={settings.setColoredSidebarIcons}
            transparency={settings.transparency}
            onTransparencyChange={settings.setTransparency}
            glassSupported={glassSupported}
            sidebarOpen={sidebar.isOpen}
            onToggleSidebar={sidebar.toggle}
            onReplayWelcome={handleReplayWelcome}
          />
        )}
        <div className={showSettings ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <div className="flex min-h-0 flex-1">
          <div
            ref={resizeChatIslandRef}
            className={cn("relative flex flex-1 min-w-0", splitMode || showBothWorkspace ? "flex-row" : "flex-col")}
          >
          {showChatWorkspace && (
          <>
          <div
            ref={chatIslandRef}
            className={cn(
              "chat-island island relative flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background",
              splitMode && activePaneIndex === 0 && "ring-1 ring-ring/30",
            )}
            style={{
              flex: splitMode && showBothWorkspace
                ? settings.workspaceSplitRatio * settings.chatSplitRatio
                : splitMode ? settings.chatSplitRatio
                : showBothWorkspace ? settings.workspaceSplitRatio
                : 1,
              minWidth: splitMode || showBothWorkspace ? 0 : minChatWidth,
              "--chat-fade-strength": String(chatFadeStrength),
            } as React.CSSProperties}
            onClick={splitMode ? handleFocusPane0 : undefined}
          >
            {jiraBoardProject ? (
              <JiraBoardPanel
                projectId={jiraBoardProject.id}
                projectName={jiraBoardProject.name}
                variant="main"
                onClose={() => setJiraBoardProjectForSpace(spaceManager.activeSpaceId, null)}
                sidebarOpen={sidebar.isOpen}
                onToggleSidebar={sidebar.toggle}
                onCreateTask={handleCreateTaskFromJiraIssue}
              />
            ) : manager.activeSessionId ? (
              <>
              <div
                className={`pointer-events-none absolute inset-x-0 top-0 z-[5] ${
                  isIsland ? "h-20" : "h-24"
                }`}
                style={{
                  opacity: "calc(var(--chat-fade-strength, 1) * var(--chat-top-progress, 0))",
                  background: topFadeBackground,
                }}
              />
              <div
                className="chat-titlebar-bg pointer-events-none absolute inset-x-0 top-0 z-10"
                style={{ background: titlebarSurfaceColor }}
              >
                <ChatHeader
                  islandLayout={isIsland}
                  sidebarOpen={sidebar.isOpen}
                  isProcessing={manager.isProcessing}
                  model={manager.sessionInfo?.model}
                  sessionId={manager.sessionInfo?.sessionId}
                  totalCost={manager.totalCost}
                  title={manager.activeSession?.title}
                  titleGenerating={manager.activeSession?.titleGenerating}
                  planMode={settings.planMode}
                  permissionMode={manager.sessionInfo?.permissionMode}
                  acpPermissionBehavior={manager.activeSession?.engine === "acp" ? settings.acpPermissionBehavior : undefined}
                  onToggleSidebar={sidebar.toggle}
                  showDevFill={devFillEnabled}
                  onSeedDevExampleConversation={manager.seedDevExampleConversation}
                  onSeedDevExampleSpaceData={handleSeedDevExampleSpaceData}
                  splitMode={splitMode}
                  paneIndex={0}
                  isActivePane={activePaneIndex === 0}
                  onActivatePane={handleFocusPane0}
                  onToggleSplit={handleToggleSplit}
                />
              </div>
              {chatSearchOpen && (
                <ChatSearchBar
                  messages={manager.messages}
                  onNavigate={setScrollToMessageId}
                  onClose={() => setChatSearchOpen(false)}
                />
              )}
              <ChatView
                  messages={manager.messages}
                  isProcessing={manager.isProcessing}
                  showThinking={showThinking}
                  autoGroupTools={settings.autoGroupTools}
                  avoidGroupingEdits={settings.avoidGroupingEdits}
                  autoExpandTools={settings.autoExpandTools}
                  extraBottomPadding={!!manager.pendingPermission}
                  scrollToMessageId={scrollToMessageId}
                  onScrolledToMessage={handleScrolledToMessage}
                  sessionId={manager.activeSessionId}
                  onRevert={manager.isConnected && manager.revertFiles ? handleRevert : undefined}
                  onFullRevert={manager.isConnected && manager.fullRevert ? handleFullRevert : undefined}
                  onTopScrollProgress={handleTopScrollProgress}
                  onSendQueuedNow={handleSendQueuedNow}
                  onUnqueueQueuedMessage={handleUnqueueMessage}
                  sendNextId={manager.sendNextId}
                  agents={agents}
                  selectedAgent={selectedAgent}
                  onAgentChange={handleAgentChange}
                  activeSlots={manager.activeSlots}
                />
              <div
                className={`pointer-events-none absolute inset-x-0 bottom-0 z-[5] transition-opacity duration-200 ${isIsland ? "h-24" : "h-28"}`}
                style={{
                  opacity: chatFadeStrength,
                  background: bottomFadeBackground,
                }}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
                <BottomComposer
                  pendingPermission={manager.pendingPermission}
                  onRespondPermission={manager.respondPermission}
                  onSend={wrappedHandleSend}
                  onClear={handleComposerClear}
                  onStop={handleStop}
                  isProcessing={manager.isProcessing}
                  queuedCount={manager.queuedCount}
                  model={settings.model}
                  claudeEffort={settings.claudeEffort}
                  planMode={settings.planMode}
                  permissionMode={manager.sessionInfo?.permissionMode ?? settings.permissionMode}
                  onModelChange={handleModelChange}
                  onClaudeModelEffortChange={handleClaudeModelEffortChange}
                  onPlanModeChange={handlePlanModeChange}
                  onPermissionModeChange={handlePermissionModeChange}
                  projectPath={activeProjectPath}
                  contextUsage={manager.contextUsage}
                  isCompacting={manager.isCompacting}
                  onCompact={manager.compact}
                  agents={agentsWithGroups}
                  selectedAgent={selectedAgent}
                  onAgentChange={handleAgentChange}
                  slashCommands={manager.slashCommands}
                  acpConfigOptions={manager.acpConfigOptions}
                  acpConfigOptionsLoading={manager.acpConfigOptionsLoading}
                  onACPConfigChange={manager.setACPConfig}
                  acpPermissionBehavior={settings.acpPermissionBehavior}
                  onAcpPermissionBehaviorChange={settings.setAcpPermissionBehavior}
                  supportedModels={manager.supportedModels}
                  codexModelsLoadingMessage={manager.codexModelsLoadingMessage}
                  codexEffort={manager.codexEffort}
                  onCodexEffortChange={manager.setCodexEffort}
                  codexModelData={manager.codexRawModels}
                  grabbedElements={grabbedElements}
                  onRemoveGrabbedElement={handleRemoveGrabbedElement}
                  codeSnippets={codeSnippets0}
                  onRemoveCodeSnippet={handleRemoveCodeSnippet0}
                  lockedEngine={lockedEngine}
                  lockedAgentId={lockedAgentId}
                  isIslandLayout={isIsland}
                  openclawAgentId={openclawAgentId}
                  onOpenclawAgentChange={handleOpenclawAgentChange}
                  groups={agentGroups.groups.map((g) => ({ id: g.id, name: g.name, slots: g.slots.map((s) => ({ label: s.label, engine: s.engine, model: s.model, color: s.color, role: s.role })) }))}
                  selectedGroupId={selectedGroupId}
                  onGroupChange={setSelectedGroupId}
                />
              </div>
              </>
            ) : (
              <>
              <div
                className={`chat-titlebar-bg drag-region flex items-center ${
                  isIsland ? "h-12 px-3" : "h-[3.25rem] px-4"
                } ${
                  !sidebar.isOpen && isMac ? (isIsland ? "ps-[78px]" : "ps-[84px]") : ""
                }`}
                style={{ background: titlebarSurfaceColor }}
              >
                {!sidebar.isOpen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`no-drag h-7 w-7 text-muted-foreground/60 hover:text-foreground ${
                      isIsland ? "relative -top-[5px]" : ""
                    }`}
                    onClick={sidebar.toggle}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <WelcomeScreen
                hasProjects={hasProjects}
                onCreateProject={handleCreateProject}
              />
              </>
            )}
          </div>
          </>
          )}

          {splitMode && (
            <div
              className="resize-col group flex shrink-0 cursor-col-resize items-center justify-center"
              style={isIsland ? { width: "var(--island-panel-gap)" } : { width: "8px" }}
              onMouseDown={handleChatSplitStart}
            >
              <div
                className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${
                  isResizing ? "bg-foreground/40" : "bg-transparent group-hover:bg-foreground/25"
                }`}
              />
            </div>
          )}

          {splitMode && (
            <div
              className={cn(
                "chat-island island relative flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background",
                activePaneIndex === 1 && "ring-1 ring-ring/30",
              )}
              style={{
                flex: showBothWorkspace
                  ? settings.workspaceSplitRatio * (1 - settings.chatSplitRatio)
                  : 1 - settings.chatSplitRatio,
                minWidth: 0,
                "--chat-fade-strength": String(chatFadeStrength),
              } as React.CSSProperties}
              onClick={handleFocusPane1}
            >
              <div
                className="chat-titlebar-bg pointer-events-none absolute inset-x-0 top-0 z-10"
                style={{ background: titlebarSurfaceColor }}
              >
                <ChatHeader
                  islandLayout={isIsland}
                  sidebarOpen={true}
                  isProcessing={pane1.isProcessing}
                  model={settings.model}
                  sessionId={pane1.sessionId ?? undefined}
                  totalCost={0}
                  title={pane1.session?.title}
                  titleGenerating={pane1.session?.titleGenerating}
                  planMode={settings.planMode}
                  permissionMode={settings.permissionMode}
                  acpPermissionBehavior={pane1.session?.engine === "acp" ? settings.acpPermissionBehavior : undefined}
                  onToggleSidebar={sidebar.toggle}
                  showDevFill={devFillEnabled}
                  onSeedDevExampleConversation={manager.seedDevExampleConversation}
                  onSeedDevExampleSpaceData={handleSeedDevExampleSpaceData}
                  splitMode={splitMode}
                  paneIndex={1}
                  isActivePane={activePaneIndex === 1}
                  onActivatePane={handleFocusPane1}
                  onToggleSplit={handleToggleSplit}
                />
              </div>

              {pane1.sessionId ? (
                <>
                <ChatView
                  messages={pane1.messages}
                  isProcessing={pane1.isProcessing}
                  showThinking={showThinking}
                  autoGroupTools={settings.autoGroupTools}
                  avoidGroupingEdits={settings.avoidGroupingEdits}
                  autoExpandTools={settings.autoExpandTools}
                  extraBottomPadding={!!pane1.pendingPermission}
                  scrollToMessageId={undefined}
                  onScrolledToMessage={NOOP}
                  sessionId={pane1.sessionId}
                  onRevert={undefined}
                  onFullRevert={undefined}
                  onTopScrollProgress={NOOP}
                  onSendQueuedNow={NOOP}
                  onUnqueueQueuedMessage={NOOP}
                  sendNextId={undefined}
                  agents={agents}
                  selectedAgent={selectedAgent}
                  onAgentChange={handleAgentChange}
                />
                <div
                  className={`pointer-events-none absolute inset-x-0 bottom-0 z-[5] transition-opacity duration-200 ${isIsland ? "h-24" : "h-28"}`}
                  style={{ opacity: chatFadeStrength, background: bottomFadeBackground }}
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
                  <BottomComposer
                    pendingPermission={pane1.pendingPermission}
                    onRespondPermission={pane1.respondPermission}
                    onSend={wrappedPane1Send}
                    onStop={pane1.stop}
                    isProcessing={pane1.isProcessing}
                    queuedCount={0}
                    model={settings.model}
                    claudeEffort={settings.claudeEffort}
                    planMode={settings.planMode}
                    permissionMode={settings.permissionMode}
                    onModelChange={handleModelChange}
                    onClaudeModelEffortChange={handleClaudeModelEffortChange}
                    onPlanModeChange={handlePlanModeChange}
                    onPermissionModeChange={handlePermissionModeChange}
                    projectPath={settings.pane1GitCwd ?? activeProjectPath}
                    contextUsage={undefined}
                    isCompacting={false}
                    onCompact={undefined}
                    agents={agentsWithGroups}
                    selectedAgent={selectedAgent}
                    onAgentChange={handleAgentChange}
                    slashCommands={EMPTY_SLASH}
                    acpConfigOptions={EMPTY_ACP_OPTIONS}
                    acpConfigOptionsLoading={false}
                    onACPConfigChange={NOOP}
                    acpPermissionBehavior={settings.acpPermissionBehavior}
                    onAcpPermissionBehaviorChange={settings.setAcpPermissionBehavior}
                    supportedModels={manager.supportedModels}
                    codexModelsLoadingMessage={undefined}
                    codexEffort={undefined}
                    onCodexEffortChange={NOOP}
                    codexModelData={undefined}
                    grabbedElements={EMPTY_GRABBED}
                    onRemoveGrabbedElement={NOOP}
                    codeSnippets={codeSnippets1}
                    onRemoveCodeSnippet={handleRemoveCodeSnippet1}
                    lockedEngine={lockedEngine}
                    lockedAgentId={lockedAgentId}
                    isIslandLayout={isIsland}
                    openclawAgentId={openclawAgentId}
                    onOpenclawAgentChange={handleOpenclawAgentChange}
                    groups={agentGroups.groups.map((g) => ({ id: g.id, name: g.name, slots: g.slots.map((s) => ({ label: s.label, engine: s.engine, model: s.model, color: s.color, role: s.role })) }))}
                    selectedGroupId={selectedGroupId}
                    onGroupChange={setSelectedGroupId}
                  />
                </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6" style={{ paddingTop: "3rem" }}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.03]">
                    <MessageSquare className="h-5 w-5 text-foreground/15" />
                  </div>
                  <p className="text-center text-[11px] leading-relaxed text-muted-foreground/45">
                    Selecione uma sessão na barra lateral<br />para abrir neste painel
                  </p>
                </div>
              )}
            </div>
          )}

          {showBothWorkspace && (
            <>
              <div
                className="resize-col group flex shrink-0 cursor-col-resize items-center justify-center"
                style={isIsland ? { width: "var(--island-panel-gap)" } : { width: "8px" }}
                onMouseDown={handleWorkspaceSplitStart}
              >
                <div
                  className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${
                    isResizing ? "bg-foreground/40" : "bg-transparent group-hover:bg-foreground/25"
                  }`}
                />
              </div>
              <div
                className="chat-island island relative flex min-w-0 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                style={{ flex: 1 - settings.workspaceSplitRatio, minWidth: 0 }}
              >
                <CodeWorkspace
                  cwd={activeProjectPath}
                  showDocked
                  openRequest={editorOpenRequest}
                  forceOpenFloatingToken={forceOpenFloatingToken}
                  isDockedMaximized={false}
                  sidebarOpen={sidebar.isOpen}
                  onOpenRequestHandled={handleEditorOpenRequestHandled}
                  onRequestQuickOpen={() => setQuickOpenVisible(true)}
                  onToggleDockedMaximize={handleToggleDockedCodeMaximize}
                  onActiveFilePathChange={handleWorkspaceActiveFilePathChange}
                  onAddToChat={handleAddToChat}
                  splitMode={splitMode}
                />
              </div>
            </>
          )}

          {workspaceMode === "code" && (
            <div className="chat-island island relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background">
              <CodeWorkspace
                cwd={activeProjectPath}
                showDocked
                openRequest={editorOpenRequest}
                forceOpenFloatingToken={forceOpenFloatingToken}
                isDockedMaximized
                sidebarOpen={sidebar.isOpen}
                onOpenRequestHandled={handleEditorOpenRequestHandled}
                onRequestQuickOpen={() => setQuickOpenVisible(true)}
                onToggleDockedMaximize={handleToggleDockedCodeMaximize}
                onActiveFilePathChange={handleWorkspaceActiveFilePathChange}
                onAddToChat={handleAddToChat}
                splitMode={splitMode}
              />
            </div>
          )}
          </div>{}

          {hasRightPanel && (
            <>
            <div
              className="resize-col group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
              style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
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

            <div
              ref={rightPanelRef}
              className="flex shrink-0 flex-col overflow-hidden"
              style={{ width: settings.rightPanelWidth }}
            >
              {(() => {
                const showTodos = hasTodos && activeTools.has("tasks");
                const showAgents = hasAgents && activeTools.has("agents");
                const bothVisible = showTodos && showAgents;

                return (
                  <>
                    {showTodos && (
                      <div
                        className="island flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                        style={
                          bothVisible
                            ? { height: `calc(${settings.rightSplitRatio * 100}% - ${splitGap}px)`, flexShrink: 0 }
                            : { flex: "1 1 0%", minHeight: 0 }
                        }
                      >
                        <TodoPanel todos={activeTodos} />
                      </div>
                    )}
                    {bothVisible && (
                      <div
                        className="resize-row group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                        style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
                        onMouseDown={handleRightSplitStart}
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
                    {showAgents && (
                      <div
                        className="island flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                        style={
                          bothVisible
                            ? { height: `calc(${(1 - settings.rightSplitRatio) * 100}% - ${splitGap}px)`, flexShrink: 0 }
                            : { flex: "1 1 0%", minHeight: 0 }
                        }
                      >
                        <BackgroundAgentsPanel agents={bgAgents.agents} onDismiss={bgAgents.dismissAgent} onStopAgent={bgAgents.stopAgent} />
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            </>
          )}

          {manager.activeSessionId && (() => {
            const toolComponents: Record<string, React.ReactNode> = {
              terminal: (
                <ToolsPanel
                  spaceId={spaceManager.activeSpaceId}
                  tabs={activeSpaceTerminals.tabs}
                  activeTabId={activeSpaceTerminals.activeTabId}
                  terminalsReady={spaceTerminals.isReady}
                  onSetActiveTab={(tabId) => spaceTerminals.setActiveTab(spaceManager.activeSpaceId, tabId)}
                  onCreateTerminal={() => spaceTerminals.createTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
                  onEnsureTerminal={() => spaceTerminals.ensureTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
                  onCloseTerminal={(tabId) => spaceTerminals.closeTerminal(spaceManager.activeSpaceId, tabId)}
                  resolvedTheme={resolvedTheme}
                />
              ),
              git: (
                <GitPanel
                  key={activeSpaceProject?.id ?? "git-panel-empty"}
                  cwd={activeSpaceProject?.path}
                  collapsedRepos={settings.collapsedRepos}
                  onToggleRepoCollapsed={settings.toggleRepoCollapsed}
                  selectedWorktreePath={activeSpaceTerminalCwd}
                  onSelectWorktreePath={handleAgentWorktreeChange}
                  activeEngine={manager.activeSession?.engine}
                  activeSessionId={manager.activeSessionId}
                  onOpenFileInWorkspace={openInCodeWorkspace}
                />
              ),
              browser: <BrowserPanel onElementGrab={handleElementGrab} />,
              "project-files": (
                <ProjectFilesPanel
                  cwd={activeProjectPath}
                  enabled={activeTools.has("project-files")}
                  onPreviewFile={handlePreviewFile}
                  onOpenFileInWorkspace={openInCodeWorkspace}
                  activeFilePath={workspaceActiveFilePath}
                  sessionId={manager.activeSessionId}
                  messages={manager.messages}
                  activeEngine={manager.activeSession?.engine}
                />
              ),
              mcp: (
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
              groups: (
                <GroupPanel
                  groups={agentGroups.groups}
                  messages={[]}
                  activeSessionStatus={manager.isProcessing && manager.activeSession?.engine === "group" ? "running" : "idle"}
                  onCreateGroup={agentGroups.createGroup}
                  onUpdateGroup={agentGroups.updateGroup}
                  onDeleteGroup={agentGroups.deleteGroup}
                  onStartSession={handleGroupSend}
                  onStopSession={() => { if (manager.activeSession?.engine === "group") manager.stop(); }}
                  projectPath={activeProjectPath}
                />
              ),
              executions: (
                <ExecutionsPanel
                  cwd={activeProjectPath}
                  enabled={activeTools.has("executions")}
                />
              ),
              search: (
                <SearchPanel
                  cwd={activeProjectPath}
                  enabled={activeTools.has("search")}
                  onOpenFile={handlePreviewFile}
                />
              ),
            };

            const sideToolIds = settings.toolOrder.filter((id) => id in toolComponents && !settings.bottomTools.has(id));
            const activeSideIds = sideToolIds.filter((id) => activeTools.has(id));
            const sideCount = activeSideIds.length;
            const sideRatios = normalizeRatios(settings.toolsSplitRatios, sideCount);
            normalizedToolRatiosRef.current = sideRatios;

            return (
              <>
              {hasToolsColumn && (
                <div
                  className="resize-col group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
                  style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
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
              )}

              <div
                ref={hasToolsColumn ? toolsColumnRef : null}
                className={`flex shrink-0 flex-col gap-0 overflow-hidden ${!hasToolsColumn ? "hidden" : ""}`}
                style={{ width: maximizedToolId ? "60vw" : settings.toolsPanelWidth }}
              >
                {sideToolIds.map((id) => {
                  const isActive = activeTools.has(id);
                  const activeIdx = isActive ? activeSideIds.indexOf(id) : -1;
                  const isPinned = pinnedToolId === id;
                  const isMaximized = maximizedToolId === id;
                  const isHiddenByMax = maximizedToolId && !isMaximized;
                  if (isPinned || isHiddenByMax) return <div key={id} className="hidden" />;

                  return (
                    <div key={id} className={isActive ? "contents" : "hidden"}>
                      <div
                        className="island group/panel relative flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                        style={isActive ? { flex: `${sideRatios[activeIdx]} 1 0%`, minHeight: 0 } : undefined}
                      >
                        <div className="absolute end-2 top-2.5 z-10 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/panel:opacity-100">
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/30 hover:bg-foreground/[0.06] hover:text-foreground/60 transition-all duration-150 cursor-pointer"
                            onClick={() => setPinnedToolId(isPinned ? null : id)}
                            title="Pin to side"
                          >
                            <Pin className="h-2.5 w-2.5" />
                          </button>
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/30 hover:bg-foreground/[0.06] hover:text-foreground/60 transition-all duration-150 cursor-pointer"
                            onClick={() => setMaximizedToolId((prev) => prev === id ? null : id)}
                            title={maximizedToolId === id ? "Restore" : "Maximize"}
                          >
                            {maximizedToolId === id ? <Minimize2 className="h-2.5 w-2.5" /> : <Maximize2 className="h-2.5 w-2.5" />}
                          </button>
                        </div>
                        {toolComponents[id]}
                      </div>
                      {isActive && activeIdx < sideCount - 1 && (
                        <div
                          className="resize-row group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                          style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
                          onMouseDown={(e) => handleToolsSplitStart(e, activeIdx)}
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
                  );
                })}
              </div>

              {pinnedToolId && pinnedToolId in toolComponents && (
                <>
                  <div
                    className="resize-col group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
                    style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
                  >
                    <div className="h-10 w-0.5 rounded-full transition-colors duration-150 bg-transparent group-hover:bg-foreground/25" />
                  </div>
                  <div className="flex w-[320px] shrink-0 flex-col overflow-hidden border-s border-foreground/[0.06]">
                    <div className="island group/panel relative flex flex-1 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background" style={{ minHeight: 0 }}>
                      <div className="flex h-8 shrink-0 items-center justify-between border-b border-foreground/[0.06] px-3">
                        <span className="text-[11px] font-medium text-foreground/40 uppercase tracking-wider select-none">
                          {(PANEL_TOOLS_MAP as Record<string, { label: string }>)[pinnedToolId]?.label ?? pinnedToolId}
                        </span>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/40 hover:bg-foreground/[0.08] hover:text-foreground/70 transition-all duration-150 cursor-pointer"
                            onClick={() => { setMaximizedToolId(pinnedToolId); setPinnedToolId(null); }}
                            title="Maximize"
                          >
                            <Maximize2 className="h-2.5 w-2.5" />
                          </button>
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/40 hover:bg-foreground/[0.08] hover:text-foreground/70 transition-all duration-150 cursor-pointer"
                            onClick={() => setPinnedToolId(null)}
                            title="Unpin"
                          >
                            <PinOff className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      </div>
                      {toolComponents[pinnedToolId]}
                    </div>
                  </div>
                </>
              )}

              </>
            );
          })()}

          {manager.activeSessionId && (
            <div className={isIsland ? "ms-[var(--island-panel-gap)] shrink-0" : "shrink-0 tool-picker-shell"}>
              <ToolPicker
                islandLayout={isIsland}
                transparentBackground={settings.transparentToolPicker}
                coloredIcons={settings.coloredSidebarIcons}
                activeTools={activeTools}
                onToggle={handleToggleTool}
                availableContextual={availableContextual}
                toolOrder={settings.toolOrder}
                onReorder={handleToolReorder}
                projectPath={activeProjectPath}
                bottomTools={settings.bottomTools}
                onMoveToBottom={settings.moveToolToBottom}
                onMoveToSide={settings.moveToolToSide}
                taskProgress={activeTodos.length > 0 ? {
                  completed: activeTodos.filter((t) => t.status === "completed").length,
                  total: activeTodos.length,
                } : undefined}
              />
            </div>
          )}
        </div>{}

        {manager.activeSessionId && (() => {
          const bottomToolComponents: Record<string, React.ReactNode> = {
            terminal: (
              <ToolsPanel
                spaceId={spaceManager.activeSpaceId}
                tabs={activeSpaceTerminals.tabs}
                activeTabId={activeSpaceTerminals.activeTabId}
                terminalsReady={spaceTerminals.isReady}
                onSetActiveTab={(tabId) => spaceTerminals.setActiveTab(spaceManager.activeSpaceId, tabId)}
                onCreateTerminal={() => spaceTerminals.createTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
                onEnsureTerminal={() => spaceTerminals.ensureTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
                onCloseTerminal={(tabId) => spaceTerminals.closeTerminal(spaceManager.activeSpaceId, tabId)}
                resolvedTheme={resolvedTheme}
              />
            ),
            git: (
              <GitPanel
                key={activeSpaceProject?.id ?? "git-panel-empty"}
                cwd={activeSpaceProject?.path}
                collapsedRepos={settings.collapsedRepos}
                onToggleRepoCollapsed={settings.toggleRepoCollapsed}
                selectedWorktreePath={activeSpaceTerminalCwd}
                onSelectWorktreePath={handleAgentWorktreeChange}
                activeEngine={manager.activeSession?.engine}
                activeSessionId={manager.activeSessionId}
              />
            ),
            browser: <BrowserPanel onElementGrab={handleElementGrab} />,
            "project-files": (
              <ProjectFilesPanel
                cwd={activeProjectPath}
                enabled={activeTools.has("project-files")}
                onPreviewFile={handlePreviewFile}
                onOpenFileInWorkspace={openInCodeWorkspace}
                activeFilePath={workspaceActiveFilePath}
                sessionId={manager.activeSessionId}
                messages={manager.messages}
                activeEngine={manager.activeSession?.engine}
              />
            ),
            mcp: (
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
          };

          const allBottomToolIds = settings.toolOrder.filter((id) => id in bottomToolComponents && settings.bottomTools.has(id));
          const activeBottomIds = allBottomToolIds.filter((id) => activeTools.has(id));
          const bottomCount = activeBottomIds.length;
          const bottomRatios = normalizeRatios(settings.bottomToolsSplitRatios, bottomCount);
          normalizedBottomRatiosRef.current = bottomRatios;

          const anyBottomPlaced = allBottomToolIds.length > 0;
          if (!anyBottomPlaced) return null;

          return (
            <>
            <div
              className={`resize-row group flex h-2 shrink-0 cursor-row-resize items-center justify-center ${!hasBottomTools ? "hidden" : ""}`}
              style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
              onMouseDown={handleBottomResizeStart}
            >
              <div
                className={`w-10 h-0.5 rounded-full transition-colors duration-150 ${
                  isResizing
                    ? "bg-foreground/40"
                    : "bg-transparent group-hover:bg-foreground/25"
                }`}
              />
            </div>

            <div
              ref={hasBottomTools ? bottomToolsRowRef : null}
              className={`flex shrink-0 overflow-hidden ${!hasBottomTools ? "hidden" : ""}`}
              style={{ height: settings.bottomToolsHeight }}
            >
              {allBottomToolIds.map((id) => {
                const isActive = activeTools.has(id);
                const activeIdx = isActive ? activeBottomIds.indexOf(id) : -1;

                return (
                  <div key={id} className={isActive ? "contents" : "hidden"}>
                    <div
                      className="island flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                      style={isActive ? { flex: `${bottomRatios[activeIdx]} 1 0%`, minWidth: 0 } : undefined}
                    >
                      {bottomToolComponents[id]}
                    </div>
                    {isActive && activeIdx < bottomCount - 1 && (
                      <div
                        className="resize-col group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
                        style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
                        onMouseDown={(e) => handleBottomSplitStart(e, activeIdx)}
                      >
                        <div
                          className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${
                            isResizing
                              ? "bg-foreground/40"
                              : "bg-transparent group-hover:bg-foreground/25"
                          }`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          );
        })()}
        </div>{}
      </div>
      {showCodexAuthDialog && (
        <CodexAuthDialog
          sessionId={manager.activeSessionId!}
          onComplete={() => manager.clearCodexAuthRequired()}
          onCancel={() => manager.clearCodexAuthRequired()}
        />
      )}
      <FilePreviewOverlay
        filePath={previewFile?.path ?? null}
        sourceRect={previewFile?.sourceRect ?? null}
        onClose={handleClosePreview}
      />
      <QuickOpenDialog
        open={quickOpenVisible}
        cwd={activeProjectPath}
        onOpenChange={setQuickOpenVisible}
        onOpenFile={handleQuickOpenFile}
      />
      {!welcomeCompleted && (
        <WelcomeWizard
          theme={settings.theme}
          onThemeChange={settings.setTheme}
          islandLayout={settings.islandLayout}
          onIslandLayoutChange={settings.setIslandLayout}
          autoGroupTools={settings.autoGroupTools}
          onAutoGroupToolsChange={settings.setAutoGroupTools}
          autoExpandTools={settings.autoExpandTools}
          onAutoExpandToolsChange={settings.setAutoExpandTools}
          transparency={settings.transparency}
          onTransparencyChange={settings.setTransparency}
          glassSupported={glassSupported}
          permissionMode={settings.permissionMode}
          onPermissionModeChange={handlePermissionModeChange}
          onCreateProject={handleCreateProject}
          hasProjects={hasProjects}
          agents={agents}
          onSaveAgent={saveAgent}
          onDeleteAgent={deleteAgent}
          onComplete={handleWelcomeComplete}
        />
      )}
    </div>
  );
}
