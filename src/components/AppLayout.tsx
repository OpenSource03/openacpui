import { useCallback, useRef, useEffect, useLayoutEffect, useState } from "react";
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeRatios } from "@/hooks/useSettings";
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
import type { GrabbedElement } from "@/types/ui";
import { AppSidebar } from "./AppSidebar";
import { ChatHeader } from "./ChatHeader";
import { ChatSearchBar } from "./ChatSearchBar";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { PermissionPrompt } from "./PermissionPrompt";
import { TodoPanel } from "./TodoPanel";
import { BackgroundAgentsPanel } from "./BackgroundAgentsPanel";
import { ToolPicker } from "./ToolPicker";
import { WelcomeScreen } from "./WelcomeScreen";
import { WelcomeWizard } from "./welcome/WelcomeWizard";
import { WELCOME_COMPLETED_KEY } from "./welcome/shared";
import { SpaceCreator } from "./SpaceCreator";
import { ToolsPanel } from "./ToolsPanel";
import { BrowserPanel } from "./BrowserPanel";
import { GitPanel } from "./GitPanel";
import { FilesPanel } from "./FilesPanel";
import { McpPanel } from "./McpPanel";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { FilePreviewOverlay } from "./FilePreviewOverlay";
import { SettingsView } from "./SettingsView";
import { CodexAuthDialog } from "./CodexAuthDialog";
import { JiraBoardPanel } from "./JiraBoardPanel";
import type { JiraIssue } from "@shared/types/jira";
import { isMac } from "@/lib/utils";

const JIRA_BOARD_BY_SPACE_KEY = "harnss-jira-board-by-space";

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
    handleClaudeModelEffortChange, handleAgentWorktreeChange, handleStop, handleSelectSession,
    handleSendQueuedNow, handleUnqueueMessage,
    handleCreateProject, handleImportCCSession, handleNavigateToMessage,
    handleCreateSpace, handleEditSpace,
    handleDeleteSpace, handleSaveSpace, handleMoveProjectToSpace,
    handleSeedDevExampleSpaceData,
  } = o;

  const glassOverlayStyle = useSpaceTheme(
    spaceManager.activeSpace,
    resolvedTheme,
    glassSupported && settings.transparency,
  );
  const isGlassActive = glassSupported && settings.transparency;
  const isLightGlass = isGlassActive && resolvedTheme !== "dark";

  // ── Welcome wizard (first-run onboarding) ──

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

  // ── Element Grab state (browser inspector → chat context) ──

  const [grabbedElements, setGrabbedElements] = useState<GrabbedElement[]>([]);

  const handleElementGrab = useCallback((element: GrabbedElement) => {
    setGrabbedElements((prev) => [...prev, element]);
  }, []);

  const handleRemoveGrabbedElement = useCallback((id: string) => {
    setGrabbedElements((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ── File preview overlay state ──

  const [previewFile, setPreviewFile] = useState<{ path: string; sourceRect: DOMRect } | null>(null);

  const handlePreviewFile = useCallback((filePath: string, sourceRect: DOMRect) => {
    setPreviewFile({ path: filePath, sourceRect });
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null);
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

  // Wrap handleSend to clear grabbed elements after sending
  const wrappedHandleSend = useCallback(
    (...args: Parameters<typeof handleSend>) => {
      handleSend(...args);
      setGrabbedElements([]);
    },
    [handleSend],
  );

  const handleSidebarNewChat = useCallback(
    async (projectId: string) => {
      const project = projectManager.projects.find((item) => item.id === projectId);
      if (project) {
        setJiraBoardProjectForSpace(project.spaceId || "default", null);
      }
      await handleNewChat(projectId);
    },
    [handleNewChat, projectManager.projects, setJiraBoardProjectForSpace],
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
      handleSelectSession(sessionId);
    },
    [handleSelectSession, manager.sessions, projectManager.projects, setJiraBoardProjectForSpace],
  );

  const handleToggleProjectJiraBoard = useCallback((projectId: string) => {
    const project = projectManager.projects.find((item) => item.id === projectId);
    if (!project) return;
    const spaceId = project.spaceId || "default";
    const currentProjectId = jiraBoardBySpace[spaceId];
    setJiraBoardProjectForSpace(spaceId, currentProjectId === projectId ? null : projectId);
  }, [jiraBoardBySpace, projectManager.projects, setJiraBoardProjectForSpace]);

  // Handler for creating task from Jira issue
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

  const isIsland = settings.islandLayout;
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
    isResizing, contentRef, rightPanelRef, toolsColumnRef, bottomToolsRowRef,
    normalizedToolRatiosRef, normalizedBottomRatiosRef,
    handleResizeStart, handleToolsResizeStart, handleToolsSplitStart, handleRightSplitStart,
    handleBottomResizeStart, handleBottomSplitStart,
  } = resize;

  // ── Chat scroll fade & titlebar tinting ──

  const chatIslandRef = useRef<HTMLDivElement>(null);
  const lastTopScrollProgressRef = useRef(0);

  useEffect(() => {
    // Grabbed elements are session-specific context — discard on switch
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

  // Scroll fades should soften when the space itself is more transparent.
  const spaceOpacity = spaceManager.activeSpace?.color.opacity ?? 1;
  const chatFadeStrength = Math.max(0.2, Math.min(1, spaceOpacity));

  const chatSurfaceColor = isLightGlass
    ? "color-mix(in oklab, white 97%, var(--background) 3%)"
    : "var(--background)";
  // Keep titlebar veil/shadow behavior consistent across island and non-island layouts.
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
        islandLayout={settings.islandLayout}
        projects={projectManager.projects}
        sessions={manager.sessions}
        activeSessionId={manager.activeSessionId}
        jiraBoardProjectId={jiraBoardProjectId}
        jiraBoardEnabled={jiraBoardEnabled}
        onNewChat={handleSidebarNewChat}
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
        agents={agents}
      />

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
        {/* Keep chat area mounted (hidden) when settings is open to avoid
            destroying/recreating the entire ChatView DOM tree on toggle */}
        <div className={showSettings ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        {/* ── Top row: Chat | Right Panel | Tools Column | ToolPicker ── */}
        <div className="flex min-h-0 flex-1">
          <div
            ref={chatIslandRef}
            className="chat-island island relative flex flex-1 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
            style={{ minWidth: minChatWidth, "--chat-fade-strength": String(chatFadeStrength) } as React.CSSProperties}
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
              {/* Top fade: only visible when chat is scrolled down. Island mode uses dark shadow; flat mode fades content into bg */}
              {/* Island: gradient starts at top-0 (behind header, subtle bleed). Flat: starts at top-10 (right below header) so full gradient is visible and strong. */}
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
              />
              <div
                className={`pointer-events-none absolute inset-x-0 bottom-0 z-[5] transition-opacity duration-200 ${isIsland ? "h-24" : "h-28"}`}
                style={{
                  opacity: chatFadeStrength,
                  background: bottomFadeBackground,
                }}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
                {manager.pendingPermission ? (
                  <PermissionPrompt
                    key={manager.pendingPermission.requestId}
                    request={manager.pendingPermission}
                    onRespond={manager.respondPermission}
                  />
                ) : (
                  <InputBar
                    onSend={wrappedHandleSend}
                    onStop={handleStop}
                    isProcessing={manager.isProcessing}
                    queuedCount={manager.queuedCount}
                    model={settings.model}
                    claudeEffort={settings.claudeEffort}
                    planMode={settings.planMode}
                    permissionMode={settings.permissionMode}
                    onModelChange={handleModelChange}
                    onClaudeModelEffortChange={handleClaudeModelEffortChange}
                    onPlanModeChange={handlePlanModeChange}
                    onPermissionModeChange={handlePermissionModeChange}
                    projectPath={activeProjectPath}
                    contextUsage={manager.contextUsage}
                    isCompacting={manager.isCompacting}
                    onCompact={manager.compact}
                    agents={agents}
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
                    lockedEngine={lockedEngine}
                    lockedAgentId={lockedAgentId}
                    isIslandLayout={isIsland}
                  />
                )}
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

          {hasRightPanel && (
            <>
            {/* Resize handle — between chat and right panel */}
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

            {/* Right panel — Tasks / Agents with optional draggable vertical split */}
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
                        <BackgroundAgentsPanel agents={bgAgents.agents} onDismiss={bgAgents.dismissAgent} />
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            </>
          )}

          {/* Tools panels — always mounted when session active to preserve terminal/browser state.
            Each tool is mounted in exactly one location (side column or bottom row) based on bottomTools.
            Hidden (display: none) when inactive, keeping processes alive. */}
          {manager.activeSessionId && (() => {
            // Shared tool component map — each tool rendered once
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
                />
              ),
              browser: <BrowserPanel onElementGrab={handleElementGrab} />,
              files: (
                <FilesPanel
                  sessionId={manager.activeSessionId}
                  messages={manager.messages}
                  cwd={activeProjectPath}
                  activeEngine={manager.activeSession?.engine}
                  onScrollToToolCall={setScrollToMessageId}
                  enabled={activeTools.has("files")}
                />
              ),
              "project-files": (
                <ProjectFilesPanel
                  cwd={activeProjectPath}
                  enabled={activeTools.has("project-files")}
                  onPreviewFile={handlePreviewFile}
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

            // ── Side column: tools NOT in bottomTools ──
            const sideToolIds = settings.toolOrder.filter((id) => id in toolComponents && !settings.bottomTools.has(id));
            const activeSideIds = sideToolIds.filter((id) => activeTools.has(id));
            const sideCount = activeSideIds.length;
            const sideRatios = normalizeRatios(settings.toolsSplitRatios, sideCount);
            normalizedToolRatiosRef.current = sideRatios;

            return (
              <>
              {/* Resize handle — only visible when side tools column is showing */}
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
                style={{ width: settings.toolsPanelWidth }}
              >
                {sideToolIds.map((id) => {
                  const isActive = activeTools.has(id);
                  const activeIdx = isActive ? activeSideIds.indexOf(id) : -1;

                  return (
                    <div key={id} className={isActive ? "contents" : "hidden"}>
                      <div
                        className="island flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                        style={isActive ? { flex: `${sideRatios[activeIdx]} 1 0%`, minHeight: 0 } : undefined}
                      >
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
              </>
            );
          })()}

          {/* Tool picker — always visible */}
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
        </div>{/* end top row */}

        {/* ── Bottom tools row — tools placed in the bottom row via right-click menu ── */}
        {manager.activeSessionId && (() => {
          // Build tool components for bottom-placed tools only.
          // Note: moving a tool between side↔bottom is an explicit user action,
          // so the unmount/remount is acceptable.
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
            files: (
              <FilesPanel
                sessionId={manager.activeSessionId}
                messages={manager.messages}
                cwd={activeProjectPath}
                activeEngine={manager.activeSession?.engine}
                onScrollToToolCall={setScrollToMessageId}
                enabled={activeTools.has("files")}
              />
            ),
            "project-files": (
              <ProjectFilesPanel
                cwd={activeProjectPath}
                enabled={activeTools.has("project-files")}
                onPreviewFile={handlePreviewFile}
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

          // All bottom-placed tool IDs (in display order) — mount ALL, hide inactive
          const allBottomToolIds = settings.toolOrder.filter((id) => id in bottomToolComponents && settings.bottomTools.has(id));
          const activeBottomIds = allBottomToolIds.filter((id) => activeTools.has(id));
          const bottomCount = activeBottomIds.length;
          const bottomRatios = normalizeRatios(settings.bottomToolsSplitRatios, bottomCount);
          normalizedBottomRatiosRef.current = bottomRatios;

          // Always mount the bottom row when there are bottom-placed tools,
          // hidden when none are active — preserves terminal/browser state.
          const anyBottomPlaced = allBottomToolIds.length > 0;
          if (!anyBottomPlaced) return null;

          return (
            <>
            {/* Resize handle — between top area and bottom tools row */}
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
        </div>{/* end showSettings wrapper */}
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
      {/* Welcome wizard — full-screen overlay on first run */}
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
