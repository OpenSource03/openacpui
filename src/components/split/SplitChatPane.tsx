/**
 * A single chat pane in split view.
 *
 * Renders a ChatHeader + ChatView + BottomComposer + optional contextual
 * side panel (Tasks/Agents) + SplitPaneToolStrip. This is the component
 * counterpart of the `renderChatPane` closure that previously lived inside
 * `renderSplitTopRowItem` in AppLayout.
 *
 * Both single-chat and split-chat panes share the same ChatView /
 * BottomComposer; only the outer wrapper and tool strip differ.
 */

import React, { useMemo } from "react";
import { motion } from "motion/react";
import type { ChatSession, EngineId, InstalledAgent, TodoItem, BackgroundAgent } from "@/types";
import type { SessionPaneState } from "@/hooks/session/useSessionPane";
import { usePaneController, type PaneControllerContext } from "@/hooks/usePaneController";
import { useSettingsStore } from "@/stores/settings-store";
import type { ToolId } from "@/types/tools";
import { ChatHeader } from "@/components/ChatHeader";
import { ChatView } from "@/components/ChatView";
import { BottomComposer } from "@/components/BottomComposer";
import { TodoPanel } from "@/components/TodoPanel";
import { BackgroundAgentsPanel } from "@/components/BackgroundAgentsPanel";
import { SplitPaneToolStrip } from "@/components/split/SplitPaneToolStrip";
import type { CodexModelSummary } from "@/hooks/session/types";
import type { GrabbedElement } from "@/types";
import { MIN_CHAT_WIDTH_SPLIT } from "@/lib/layout/constants";
import type { SplitViewState } from "@/hooks/useSplitView";

export interface SplitChatPaneProps {
  // Identity
  sessionId: string;
  displayIndex: number;
  session: ChatSession | null;
  paneState: SessionPaneState;
  paneControllerCtx: PaneControllerContext;
  isActiveSessionPane: boolean;

  // Layout
  widthPercent: number;
  handleSharePx: number;
  isIsland: boolean;
  shouldAnimate: boolean;
  chatFadeStrength: number;
  topFadeBackground: string;
  titlebarSurfaceColor: string;
  bottomFadeBackground: string;
  isFocused: boolean;

  // Sidebar (only index 0 shows)
  sidebarOpen: boolean;
  onToggleSidebar: () => void;

  // Chat settings
  showThinking: boolean;
  acpPermissionBehavior: "ask" | "auto_accept" | "allow_all";
  onAcpPermissionBehaviorChange: (behavior: "ask" | "auto_accept" | "allow_all") => void;

  // Agents
  agents: InstalledAgent[];

  // Dev tools
  showDevFill: boolean;
  onSeedDevExampleConversation?: () => void;
  onSeedDevExampleSpaceData?: () => void;

  // Grabbed elements (active pane only)
  grabbedElements: GrabbedElement[];
  onRemoveGrabbedElement: (id: string) => void;

  // Locked engine
  lockedEngine: EngineId | null;
  lockedAgentId: string | null;

  // Worktree
  projectPath: string | undefined;
  selectedWorktreePath: string | null | undefined;
  onSelectWorktree?: (path: string | null) => void;

  // Codex
  codexModelData: CodexModelSummary[];

  // Callbacks
  spaceId: string;
  onRevert?: (checkpointId: string) => void;
  onFullRevert?: (checkpointId: string) => void;
  onTopScrollProgress: (progress: number) => void;
  onClosePane: () => void;
  onFocus: () => void;

  // Manager queue info (active pane only)
  queuedCount: number;

  // Tool strip
  splitView: SplitViewState;
  availableContextual: Set<ToolId> | undefined;

  // Contextual panels
  activeContextualTool: ToolId | null;
  activeTodos: TodoItem[];
  bgAgents: {
    agents: BackgroundAgent[];
    dismissAgent: (id: string) => void;
    stopAgent: (id: string, taskId: string) => void;
  };

  // Tool drag
  onToolDragStart: (event: React.DragEvent<HTMLButtonElement>, toolId: ToolId) => void;
  onToolDragEnd: () => void;

  // Chat pane drag
  onChatPaneDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onChatPaneDrop?: (event: React.DragEvent<HTMLDivElement>) => void;

  // Ref callback
  paneRef?: (element: HTMLDivElement | null) => void;
}

function SplitChatPaneInner({
  sessionId,
  displayIndex,
  session,
  paneState,
  paneControllerCtx,
  isActiveSessionPane,
  widthPercent,
  handleSharePx,
  isIsland,
  shouldAnimate,
  chatFadeStrength,
  topFadeBackground,
  titlebarSurfaceColor,
  bottomFadeBackground,
  isFocused,
  sidebarOpen,
  onToggleSidebar,
  showThinking,
  acpPermissionBehavior,
  onAcpPermissionBehaviorChange,
  agents,
  showDevFill,
  onSeedDevExampleConversation,
  onSeedDevExampleSpaceData,
  grabbedElements,
  onRemoveGrabbedElement,
  lockedEngine,
  lockedAgentId,
  projectPath,
  selectedWorktreePath,
  onSelectWorktree,
  codexModelData,
  spaceId,
  onRevert,
  onFullRevert,
  onTopScrollProgress,
  onClosePane,
  onFocus,
  queuedCount,
  splitView,
  availableContextual,
  activeContextualTool,
  activeTodos,
  bgAgents,
  onToolDragStart,
  onToolDragEnd,
  onChatPaneDragOver,
  onChatPaneDrop,
  paneRef,
}: SplitChatPaneProps) {
  // ── Display preferences from Zustand store ──
  const expandEditToolCallsByDefault = useSettingsStore((s) => s.expandEditToolCallsByDefault);

  // Build the pane controller inside the component (uses usePaneController hook)
  const paneController = usePaneController(
    sessionId,
    session,
    paneState,
    isActiveSessionPane,
    paneControllerCtx,
  );

  const openPanelTools = useMemo(() => {
    return new Set<ToolId>((
      ["terminal", "browser", "git", "files", "project-files", "mcp"] as const
    ).filter((toolId) => !!splitView.getToolIslandForPane(sessionId, toolId)));
  }, [sessionId, splitView]);

  return (
    <motion.div
      layout={shouldAnimate}
      transition={shouldAnimate
        ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
        : { duration: 0 }}
      ref={paneRef}
      className={`chat-island island flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background ${
        isFocused ? "ring-2 ring-primary/15" : ""
      }`}
      style={{
        width: `calc(${widthPercent}% - ${handleSharePx}px)`,
        minWidth: MIN_CHAT_WIDTH_SPLIT,
        flexShrink: 0,
        "--chat-fade-strength": String(chatFadeStrength),
      } as React.CSSProperties}
      onClick={onFocus}
      onDragOver={onChatPaneDragOver}
      onDrop={onChatPaneDrop}
    >
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-[5] ${isIsland ? "h-20" : "h-24"}`}
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
              sidebarOpen={displayIndex === 0 ? sidebarOpen : false}
              showSidebarToggle={displayIndex === 0}
              isProcessing={paneState.isProcessing}
              model={paneController.paneHeaderModel}
              sessionId={paneState.sessionInfo?.sessionId}
              totalCost={paneState.totalCost}
              title={session?.title}
              titleGenerating={session?.titleGenerating}
              planMode={paneController.panePlanMode}
              permissionMode={paneController.panePermissionMode}
              acpPermissionBehavior={paneController.paneEngine === "acp" ? acpPermissionBehavior : undefined}
              onToggleSidebar={displayIndex === 0 ? onToggleSidebar : () => {}}
              showDevFill={isActiveSessionPane ? showDevFill : false}
              onSeedDevExampleConversation={isActiveSessionPane ? onSeedDevExampleConversation : undefined}
              onSeedDevExampleSpaceData={isActiveSessionPane ? onSeedDevExampleSpaceData : undefined}
              onClosePane={onClosePane}
            />
          </div>
          <ChatView
            spaceId={spaceId}
            messages={paneState.messages}
            isProcessing={paneState.isProcessing}
            showThinking={showThinking}
            extraBottomPadding={!!paneState.pendingPermission}
            sessionId={sessionId}
            onRevert={onRevert}
            onFullRevert={onFullRevert}
            onTopScrollProgress={onTopScrollProgress}
          />
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-[5] transition-opacity duration-200 ${isIsland ? "h-24" : "h-28"}`}
            style={{ opacity: chatFadeStrength, background: bottomFadeBackground }}
          />
          <div data-chat-composer className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
            <BottomComposer
              pendingPermission={paneState.pendingPermission}
              onRespondPermission={paneState.engine.respondPermission}
              onSend={paneController.handlePaneSend}
              onClear={paneController.handlePaneClear}
              onStop={paneController.handlePaneStop}
              isProcessing={paneState.isProcessing}
              queuedCount={isActiveSessionPane ? queuedCount : 0}
              model={paneController.paneModel}
              claudeEffort={paneController.paneClaudeEffort}
              planMode={paneController.panePlanMode}
              permissionMode={paneController.panePermissionMode}
              onModelChange={paneController.handlePaneModelChange}
              onClaudeModelEffortChange={paneController.handlePaneClaudeModelEffortChange}
              onPlanModeChange={paneController.handlePanePlanModeChange}
              onPermissionModeChange={paneController.handlePanePermissionModeChange}
              projectPath={projectPath}
              contextUsage={paneState.contextUsage}
              isCompacting={paneState.isCompacting}
              onCompact={paneState.engine.compact}
              agents={agents}
              selectedAgent={paneController.selectedPaneAgent}
              onAgentChange={paneController.handlePaneAgentChange}
              slashCommands={paneController.paneSlashCommands}
              acpConfigOptions={paneController.paneAcpConfigOptions}
              acpConfigOptionsLoading={paneController.paneAcpConfigOptionsLoading}
              onACPConfigChange={paneController.handlePaneAcpConfigChange}
              acpPermissionBehavior={acpPermissionBehavior}
              onAcpPermissionBehaviorChange={onAcpPermissionBehaviorChange}
              supportedModels={paneController.paneSupportedModels}
              codexModelsLoadingMessage={paneController.paneCodexModelsLoadingMessage}
              codexEffort={paneController.paneCodexEffort}
              onCodexEffortChange={paneController.handlePaneCodexEffortChange}
              codexModelData={codexModelData}
              grabbedElements={isActiveSessionPane ? grabbedElements : []}
              onRemoveGrabbedElement={onRemoveGrabbedElement}
              lockedEngine={isActiveSessionPane ? lockedEngine : (paneController.paneEngine ?? null)}
              lockedAgentId={isActiveSessionPane ? lockedAgentId : (session?.agentId ?? null)}
              selectedWorktreePath={selectedWorktreePath}
              onSelectWorktree={isActiveSessionPane ? onSelectWorktree : undefined}
              isEmptySession={paneState.messages.length === 0}
            />
          </div>
        </div>
        {activeContextualTool === "tasks" && (
          <div className="flex w-[280px] shrink-0 flex-col overflow-hidden border-s border-border/40 bg-background">
            <TodoPanel todos={activeTodos} />
          </div>
        )}
        {activeContextualTool === "agents" && (
          <div className="flex w-[280px] shrink-0 flex-col overflow-hidden border-s border-border/40 bg-background">
            <BackgroundAgentsPanel
              agents={bgAgents.agents}
              expandEditToolCallsByDefault={expandEditToolCallsByDefault}
              onDismiss={bgAgents.dismissAgent}
              onStopAgent={bgAgents.stopAgent}
            />
          </div>
        )}
        <SplitPaneToolStrip
          sourceSessionId={sessionId}
          availableContextual={availableContextual}
          openPanelTools={openPanelTools}
          activeContextualTool={activeContextualTool}
          onTogglePanelTool={(toolId) => {
            const existing = splitView.getToolIslandForPane(sessionId, toolId);
            if (existing) splitView.closeToolIsland(existing.id);
            else splitView.openToolIsland(sessionId, toolId, "top");
          }}
          onToggleContextualTool={(toolId) => splitView.togglePaneContextualTool(sessionId, toolId)}
          onDragStart={onToolDragStart}
          onDragEnd={onToolDragEnd}
        />
      </div>
    </motion.div>
  );
}

export const SplitChatPane = React.memo(SplitChatPaneInner);
