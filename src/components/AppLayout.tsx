import { useCallback, useRef, useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeRatios } from "@/hooks/useSettings";
import { useAppOrchestrator } from "@/hooks/useAppOrchestrator";
import { useSpaceTheme } from "@/hooks/useSpaceTheme";
import { usePanelResize } from "@/hooks/usePanelResize";
import { getMinChatWidth } from "@/lib/layout-constants";
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
import { ChangesPanel } from "./ChangesPanel";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { FilePreviewOverlay } from "./FilePreviewOverlay";
import { SettingsView } from "./SettingsView";
import { CodexAuthDialog } from "./CodexAuthDialog";
import { isMac } from "@/lib/utils";

export function AppLayout() {
  const o = useAppOrchestrator();
  const {
    sidebar, projectManager, spaceManager, manager, settings, resolvedTheme,
    agents, selectedAgent, saveAgent, deleteAgent, handleAgentChange,
    lockedEngine, lockedAgentId,
    activeProjectId, activeProjectPath, showThinking,
    hasProjects, hasRightPanel, hasToolsColumn,
    activeTodos, bgAgents, hasTodos, hasAgents, availableContextual,
    glassSupported, devFillEnabled,
    showSettings, setShowSettings,
    spaceCreatorOpen, setSpaceCreatorOpen, editingSpace,
    scrollToMessageId, setScrollToMessageId,
    chatSearchOpen, setChatSearchOpen,
    changesPanelFocusTurn, setChangesPanelFocusTurn,
    spaceTerminals, activeSpaceTerminals,
    handleToggleTool, handleToolReorder, handleNewChat, handleSend,
    handleModelChange, handlePermissionModeChange, handlePlanModeChange,
    handleThinkingChange, handleAgentWorktreeChange, handleStop, handleSelectSession,
    handleSendQueuedNow,
    handleCreateProject, handleImportCCSession, handleNavigateToMessage,
    handleViewTurnChanges, handleCreateSpace, handleEditSpace,
    handleDeleteSpace, handleSaveSpace, handleMoveProjectToSpace,
    handleSeedDevExampleSpaceData,
  } = o;

  const glassOverlayStyle = useSpaceTheme(spaceManager.activeSpace, resolvedTheme);

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

  // Wrap handleSend to clear grabbed elements after sending
  const wrappedHandleSend = useCallback(
    (...args: Parameters<typeof handleSend>) => {
      handleSend(...args);
      setGrabbedElements([]);
    },
    [handleSend],
  );

  const isIsland = settings.islandLayout;
  const minChatWidth = getMinChatWidth(isIsland);
  const splitGap = isIsland ? 4 : 0.5;

  const resize = usePanelResize({
    settings,
    isIsland,
    hasRightPanel,
    hasToolsColumn,
    activeSessionId: manager.activeSessionId,
    activeProjectId,
  });
  const {
    isResizing, contentRef, rightPanelRef, toolsColumnRef, normalizedToolRatiosRef,
    handleResizeStart, handleToolsResizeStart, handleToolsSplitStart, handleRightSplitStart,
  } = resize;

  // ── Chat scroll fade & titlebar tinting ──

  const chatIslandRef = useRef<HTMLDivElement>(null);
  const lastTopScrollProgressRef = useRef(0);

  // Reset on session change — new/blank chats start at scroll 0.
  useEffect(() => {
    lastTopScrollProgressRef.current = 0;
    chatIslandRef.current?.style.setProperty("--chat-top-progress", "0");
    // Grabbed elements are session-specific context — discard on switch
    setGrabbedElements([]);
  }, [manager.activeSessionId]);

  const handleTopScrollProgress = useCallback((progress: number) => {
    const clamped = Math.max(0, Math.min(1, progress));
    if (Math.abs(lastTopScrollProgressRef.current - clamped) < 0.005) return;
    lastTopScrollProgressRef.current = clamped;
    chatIslandRef.current?.style.setProperty("--chat-top-progress", clamped.toFixed(3));
  }, []);

  // Scroll fades should soften when the space itself is more transparent.
  const spaceOpacity = spaceManager.activeSpace?.color.opacity ?? 1;
  const chatFadeStrength = Math.max(0.2, Math.min(1, spaceOpacity));

  const chatSurfaceColor = "var(--background)";
  // Keep titlebar veil/shadow behavior consistent across island and non-island layouts.
  const titlebarOpacity = Math.round(30 + 50 * spaceOpacity); // 30–80%
  const titlebarSurfaceColor =
    `linear-gradient(to bottom, color-mix(in oklab, var(--background) ${titlebarOpacity}%, transparent) 0%, transparent 100%)`;
  const topFadeBackground = `linear-gradient(to bottom, ${chatSurfaceColor}, transparent)`;
  const bottomFadeBackground = `linear-gradient(to top, ${chatSurfaceColor}, transparent)`;

  const { activeTools } = settings;
  const showCodexAuthDialog =
    !!manager.activeSessionId &&
    manager.activeSession?.engine === "codex" &&
    manager.codexAuthRequired;

  return (
    <div className={`relative flex h-screen overflow-hidden bg-sidebar text-foreground${settings.islandLayout ? "" : " no-islands"}`}>
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
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
        onDeleteSession={manager.deleteSession}
        onRenameSession={manager.renameSession}
        onCreateProject={handleCreateProject}
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
        onOpenSettings={() => setShowSettings(true)}
      />

      <div ref={contentRef} className={`flex min-w-0 flex-1 ${settings.islandLayout ? "ms-2 me-2 my-2" : sidebar.isOpen ? "flat-divider-s" : ""} ${isResizing ? "select-none" : ""}`}>
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
            transparency={settings.transparency}
            onTransparencyChange={settings.setTransparency}
            glassSupported={glassSupported}
            sidebarOpen={sidebar.isOpen}
            onReplayWelcome={handleReplayWelcome}
          />
        )}
        {/* Keep chat area mounted (hidden) when settings is open to avoid
            destroying/recreating the entire ChatView DOM tree on toggle */}
        <div className={showSettings ? "hidden" : "contents"}>
        <div
          ref={chatIslandRef}
          className="chat-island island relative flex flex-1 flex-col overflow-hidden rounded-lg bg-background"
          style={{ minWidth: minChatWidth, "--chat-fade-strength": String(chatFadeStrength) } as React.CSSProperties}
        >
          {manager.activeSessionId ? (
            <>
              {/* Top fade: only visible when chat is scrolled down. Island mode uses dark shadow; flat mode fades content into bg */}
              {/* Island: gradient starts at top-0 (behind header, subtle bleed). Flat: starts at top-10 (right below header) so full gradient is visible and strong. */}
              <div
                className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-16"
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
                extraBottomPadding={!!manager.pendingPermission}
                scrollToMessageId={scrollToMessageId}
                onScrolledToMessage={() => setScrollToMessageId(undefined)}
                sessionId={manager.activeSessionId}
                onRevert={manager.isConnected && manager.revertFiles ? manager.revertFiles : undefined}
                onFullRevert={manager.isConnected && manager.fullRevert ? manager.fullRevert : undefined}
                onViewTurnChanges={handleViewTurnChanges}
                onTopScrollProgress={handleTopScrollProgress}
                onSendQueuedNow={handleSendQueuedNow}
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
                    thinking={settings.thinking}
                    planMode={settings.planMode}
                    permissionMode={settings.permissionMode}
                    onModelChange={handleModelChange}
                    onThinkingChange={handleThinkingChange}
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
                className={`chat-titlebar-bg drag-region flex h-12 items-center px-3 ${
                  !sidebar.isOpen && isMac ? "ps-[78px]" : ""
                }`}
                style={{ background: titlebarSurfaceColor }}
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
                        className="island flex flex-col overflow-hidden rounded-lg bg-background"
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
                        className="island flex flex-col overflow-hidden rounded-lg bg-background"
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
            Column is hidden (display: none) when no panel tools are active, keeping processes alive. */}
        {manager.activeSessionId && (
          <>
            {/* Resize handle — only visible when tools column is showing */}
            {hasToolsColumn && (
              <div
                className="resize-col group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
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
              {(() => {
                const toolComponents: Record<string, React.ReactNode> = {
                  terminal: (
                    <ToolsPanel
                      spaceId={spaceManager.activeSpaceId}
                      tabs={activeSpaceTerminals.tabs}
                      activeTabId={activeSpaceTerminals.activeTabId}
                      terminalsReady={spaceTerminals.isReady}
                      onSetActiveTab={(tabId) => spaceTerminals.setActiveTab(spaceManager.activeSpaceId, tabId)}
                      onCreateTerminal={() => spaceTerminals.createTerminal(spaceManager.activeSpaceId, activeProjectPath)}
                      onEnsureTerminal={() => spaceTerminals.ensureTerminal(spaceManager.activeSpaceId, activeProjectPath)}
                      onCloseTerminal={(tabId) => spaceTerminals.closeTerminal(spaceManager.activeSpaceId, tabId)}
                      resolvedTheme={resolvedTheme}
                    />
                  ),
                  git: (
                    <GitPanel
                      cwd={activeProjectPath}
                      collapsedRepos={settings.collapsedRepos}
                      onToggleRepoCollapsed={settings.toggleRepoCollapsed}
                      selectedWorktreePath={activeProjectPath}
                      onSelectWorktreePath={handleAgentWorktreeChange}
                      confirmWorktreeRestart={!!manager.activeSessionId && !manager.isDraft}
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
                  changes: (
                    <ChangesPanel
                      sessionId={manager.activeSessionId}
                      messages={manager.messages}
                      isProcessing={manager.isProcessing}
                      focusTurnIndex={changesPanelFocusTurn}
                      onFocusTurnHandled={() => setChangesPanelFocusTurn(undefined)}
                      enabled={activeTools.has("changes")}
                    />
                  ),
                };

                // All panel tool IDs in display order
                const allToolIds = settings.toolOrder.filter((id) => id in toolComponents);
                // Active subset for flex layout sizing
                const activeToolIds = allToolIds.filter((id) => activeTools.has(id));
                const count = activeToolIds.length;
                const ratios = normalizeRatios(settings.toolsSplitRatios, count);
                normalizedToolRatiosRef.current = ratios;

                // Render ALL tools: active ones get flex layout, inactive ones stay
                // hidden (display: none) but mounted — preserves terminal processes,
                // browser sessions, and all internal state across toggles.
                return allToolIds.map((id) => {
                  const isActive = activeTools.has(id);
                  const activeIdx = isActive ? activeToolIds.indexOf(id) : -1;

                  return (
                    <div key={id} className={isActive ? "contents" : "hidden"}>
                      <div
                        className="island flex flex-col overflow-hidden rounded-lg bg-background"
                        style={isActive ? { flex: `${ratios[activeIdx]} 1 0%`, minHeight: 0 } : undefined}
                      >
                        {toolComponents[id]}
                      </div>
                      {isActive && activeIdx < count - 1 && (
                        <div
                          className="resize-row group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
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
                });
              })()}
            </div>
          </>
        )}

        {/* Tool picker — always visible */}
        {manager.activeSessionId && (
          <div className={isIsland ? "ms-2 shrink-0" : "shrink-0 tool-picker-shell"}>
            <ToolPicker activeTools={activeTools} onToggle={handleToggleTool} availableContextual={availableContextual} toolOrder={settings.toolOrder} onReorder={handleToolReorder} projectPath={activeProjectPath} />
          </div>
        )}
        </div>
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
