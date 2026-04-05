/**
 * Renders a single item (chat pane or tool column) in the split-view top row.
 *
 * Extracted from the 350-line `renderSplitTopRowItem` useCallback in AppLayout.
 * Contains the tool island rendering, stack entry layout, column wrapper,
 * and chat pane delegation — all as proper module-level functions and components.
 */

import React from "react";
import { motion } from "motion/react";
import { normalizeRatios } from "@/hooks/useSettings";
import { equalWidthFractions, MIN_CHAT_WIDTH_SPLIT } from "@/lib/layout/constants";
import { getStoredProjectGitCwd } from "@/lib/session/space-projects";
import { getHorizontalInsertSide, getToolColumnDropIntent } from "@/lib/workspace/drag";
import { PanelDockControls } from "@/components/PanelDockControls";
import { PanelDockPreview } from "@/components/PanelDockPreview";
import { ToolIslandContent } from "@/components/workspace/ToolIslandContent";
import { SplitChatPane } from "@/components/split/SplitChatPane";
import { SplitPaneHost } from "@/components/split/SplitPaneHost";
import type { ToolId } from "@/types/tools";
import type { ChatSession, InstalledAgent, Project, TodoItem, BackgroundAgent } from "@/types";
import type { SessionPaneState } from "@/hooks/session/useSessionPane";
import type { CodexModelSummary, SessionPaneBootstrap } from "@/hooks/session/types";
import type { PaneControllerContext } from "@/hooks/usePaneController";
import type { SplitViewState } from "@/hooks/useSplitView";
import type {
  GrabbedElement,
  ToolDragState,
  ToolIsland,
  TopRowItem,
  ToolIslandContextProps,
} from "@/types";

// ── Props ──

export interface SplitTopRowItemProps {
  item: TopRowItem;
  displayIndex: number;
  previewIndex: number;
  insertBeforeIndex: number;

  // Session resolution
  activeSessionId: string | null;
  activeSession: ChatSession | null;
  primaryPane: SessionPaneState;
  loadSplitPaneBootstrap: (sessionId: string) => Promise<SessionPaneBootstrap | null>;
  projects: Project[];
  activeProjectPath: string | undefined;

  // Split view state
  splitView: SplitViewState;
  paneControllerCtx: PaneControllerContext;

  // Glass / animation
  isIsland: boolean;
  shouldAnimateTopRowLayout: boolean;
  chatFadeStrength: number;
  topFadeBackground: string;
  titlebarSurfaceColor: string;
  bottomFadeBackground: string;

  // Tool drag state
  splitToolDrag: ToolDragState | null;
  setSplitToolDrag: React.Dispatch<React.SetStateAction<ToolDragState | null>>;
  commitSplitToolDrop: () => void;
  resetSplitToolDrag: () => void;
  splitToolLabel: string | null;

  // Refs
  splitToolColumnRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  paneRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;

  // Resize
  splitToolColumnResize: {
    activeResizeId: string | null;
    handleResizeStart: (columnId: string, handleIndex: number, splitRatios: number[], event: React.MouseEvent) => void;
  };

  // Tool island shared context
  toolIslandCtx: ToolIslandContextProps;
  spaceActiveSpaceId: string;

  // Sidebar
  sidebarOpen: boolean;
  sidebarToggle: () => void;

  // Settings
  showThinking: boolean;
  acpPermissionBehavior: "ask" | "auto_accept" | "allow_all";
  setAcpPermissionBehavior: (behavior: "ask" | "auto_accept" | "allow_all") => void;

  // Agents & dev
  agents: InstalledAgent[];
  devFillEnabled: boolean;
  handleSeedDevExampleSpaceData: (() => void) | undefined;
  seedDevExampleConversation: (() => void) | undefined;

  // Grabbed elements
  grabbedElements: GrabbedElement[];
  handleRemoveGrabbedElement: (id: string) => void;

  // Locked engine
  lockedEngine: import("@/types").EngineId | null;
  lockedAgentId: string | null;

  // Worktree
  handleAgentWorktreeChange: (path: string | null) => void;

  // Revert
  handleRevert: ((checkpointId: string) => void) | undefined;
  handleFullRevert: ((checkpointId: string) => void) | undefined;

  // Scroll
  makePaneScrollCallback: (paneIndex: number) => (progress: number) => void;
  setScrollToMessageId: (messageId: string | undefined) => void;

  // File preview
  handlePreviewFile: (path: string, rect: DOMRect) => void;
  handleElementGrab: (element: GrabbedElement) => void;

  // Close
  handleCloseSplitPane: (sessionId: string | null) => Promise<void>;

  // Codex models
  codexRawModels: CodexModelSummary[];

  // Queue
  queuedCount: number;

  // Contextual
  availableContextual: Set<ToolId> | undefined;
  activeTodos: TodoItem[];
  bgAgents: {
    agents: BackgroundAgent[];
    dismissAgent: (id: string) => void;
    stopAgent: (id: string, taskId: string) => void;
  };

  // Layout metrics
  getPreviewPaneMetrics: (previewIndex: number) => { widthPercent: number; handleSharePx: number };
}

// ── Module-level helpers ──

function buildToolIslandControls(
  island: ToolIsland,
  isBottom: boolean,
  moveLabel: string,
  onMovePlacement: () => void,
  setSplitToolDrag: React.Dispatch<React.SetStateAction<ToolDragState | null>>,
  resetSplitToolDrag: () => void,
): React.ReactNode {
  return (
    <PanelDockControls
      isBottom={isBottom}
      moveLabel={moveLabel}
      onMovePlacement={onMovePlacement}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", island.id);
        event.dataTransfer.effectAllowed = "move";
        setSplitToolDrag({
          toolId: island.toolId,
          sourceSessionId: island.sourceSessionId,
          islandId: island.id,
          targetArea: null,
          targetIndex: null,
          targetColumnId: null,
        });
      }}
      onDragEnd={resetSplitToolDrag}
    />
  );
}

/** Render a single tool island panel within a column stack. */
function renderToolIsland(
  island: ToolIsland,
  fraction: number,
  stackInsertBeforeIndex: number,
  insertBeforeIndex: number,
  session: ChatSession | null,
  paneState: SessionPaneState,
  isActiveSessionPane: boolean,
  props: SplitTopRowItemProps,
  columnId: string,
) {
  const {
    projects, activeProjectPath, splitView,
    setSplitToolDrag, resetSplitToolDrag, splitToolDrag, commitSplitToolDrop,
    toolIslandCtx,
  } = props;

  const paneProject = session
    ? projects.find((project) => project.id === session.projectId) ?? null
    : null;
  const paneProjectPath = paneProject
    ? (getStoredProjectGitCwd(paneProject.id) ?? paneProject.path)
    : activeProjectPath;
  const paneProjectRoot = paneProject?.path;

  const controls = buildToolIslandControls(
    island,
    false,
    "Move to bottom",
    () => splitView.moveToolIsland(island.id, "bottom"),
    setSplitToolDrag,
    resetSplitToolDrag,
  );

  return (
    <div
      className="island flex min-h-0 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
      style={{ flex: `${fraction} 1 0%`, minHeight: 0 }}
      onDragOver={(event) => {
        if (!splitToolDrag || splitToolDrag.islandId === island.id) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const intent = getToolColumnDropIntent(rect, event.clientX, event.clientY);
        setSplitToolDrag((current) => current ? {
          ...current,
          targetArea: intent.area,
          targetIndex: intent.area === "top"
            ? (intent.side === "before" ? insertBeforeIndex : insertBeforeIndex + 1)
            : (intent.side === "before" ? stackInsertBeforeIndex : stackInsertBeforeIndex + 1),
          targetColumnId: intent.area === "top-stack" ? columnId : null,
        } : current);
      }}
      onDrop={(event) => {
        if (!splitToolDrag) return;
        event.preventDefault();
        event.stopPropagation();
        commitSplitToolDrop();
      }}
    >
      <ToolIslandContent
        toolId={island.toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">}
        persistKey={island.persistKey}
        headerControls={controls}
        projectPath={paneProjectPath}
        projectRoot={paneProjectRoot}
        projectId={paneProject?.id ?? null}
        sessionId={island.sourceSessionId}
        messages={paneState.messages}
        activeEngine={session?.engine}
        isActiveSessionPane={isActiveSessionPane}
        hasLiveSession={paneState.isConnected}
        {...toolIslandCtx}
      />
    </div>
  );
}

/** Build the stack entries (islands + optional preview) for a tool column. */
function buildStackEntries(
  item: Extract<TopRowItem, { kind: "tool-column" }>,
  renderedIslands: ToolIsland[],
  splitToolDrag: ToolDragState | null,
): Array<{ kind: "item"; island: ToolIsland } | { kind: "preview" }> {
  if (splitToolDrag?.targetArea === "top-stack" && splitToolDrag.targetColumnId === item.column.id) {
    const next: Array<{ kind: "item"; island: ToolIsland } | { kind: "preview" }> =
      renderedIslands.map((island) => ({ kind: "item" as const, island }));
    const insertIndex = Math.max(0, Math.min(splitToolDrag.targetIndex ?? next.length, next.length));
    next.splice(insertIndex, 0, { kind: "preview" });
    return next;
  }
  return renderedIslands.map((island) => ({ kind: "item" as const, island }));
}

/** Render the tool column wrapper with stack entries. */
function renderToolColumn(
  item: Extract<TopRowItem, { kind: "tool-column" }>,
  session: ChatSession | null,
  paneState: SessionPaneState,
  isActiveSessionPane: boolean,
  props: SplitTopRowItemProps,
) {
  const {
    isIsland, shouldAnimateTopRowLayout,
    splitToolDrag, setSplitToolDrag, commitSplitToolDrop, splitToolLabel,
    splitToolColumnRefs, splitToolColumnResize, splitView,
    previewIndex, insertBeforeIndex,
    getPreviewPaneMetrics,
  } = props;

  const { widthPercent, handleSharePx } = getPreviewPaneMetrics(previewIndex);

  // Filter out dragged island from rendered islands
  const renderedIslands = splitToolDrag && splitToolDrag.islandId && splitToolDrag.targetArea !== null
    ? item.islands.filter((island) => island.id !== splitToolDrag.islandId)
    : item.islands;

  const stackEntries = buildStackEntries(item, renderedIslands, splitToolDrag);
  const stackRatios = stackEntries.some((entry) => entry.kind === "preview")
    ? equalWidthFractions(Math.max(stackEntries.length, 1))
    : normalizeRatios(item.column.splitRatios, Math.max(stackEntries.length, 1));

  return (
    <motion.div
      layout={shouldAnimateTopRowLayout}
      transition={shouldAnimateTopRowLayout
        ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
        : { duration: 0 }}
      ref={(element) => { splitToolColumnRefs.current[item.column.id] = element; }}
      className="flex min-h-0 min-w-0 flex-col"
      style={{
        width: `calc(${widthPercent}% - ${handleSharePx}px)`,
        minWidth: MIN_CHAT_WIDTH_SPLIT,
        flexShrink: 0,
      } as React.CSSProperties}
    >
      {stackEntries.map((entry, stackIndex) => {
        const fraction = stackRatios[stackIndex] ?? (1 / Math.max(stackEntries.length, 1));
        const stackInsertBeforeIndex = stackEntries
          .slice(0, stackIndex)
          .filter((candidate) => candidate.kind === "item")
          .length;
        const previousEntry = stackIndex > 0 ? stackEntries[stackIndex - 1] : null;
        const stackHandleIndex = stackInsertBeforeIndex - 1;
        const canResizeStackPair = previousEntry?.kind === "item" && entry.kind === "item" && stackHandleIndex >= 0;
        const isStackPairResizing = splitToolColumnResize.activeResizeId === `${item.column.id}:${stackHandleIndex}`;

        return (
          <React.Fragment key={entry.kind === "item" ? entry.island.id : `top-stack-preview-${item.column.id}-${stackIndex}`}>
            {stackIndex > 0 && (
              canResizeStackPair ? (
                <div
                  className="resize-row group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                  style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
                  onMouseDown={(event) => splitToolColumnResize.handleResizeStart(
                    item.column.id,
                    stackHandleIndex,
                    item.column.splitRatios,
                    event,
                  )}
                  onDoubleClick={() => splitView.setTopToolColumnSplitRatios(
                    item.column.id,
                    equalWidthFractions(item.islands.length),
                  )}
                >
                  <div
                    className={`h-0.5 w-10 rounded-full transition-colors duration-150 ${
                      isStackPairResizing
                        ? "bg-foreground/40"
                        : "bg-transparent group-hover:bg-foreground/25"
                    }`}
                  />
                </div>
              ) : (
                <div
                  className="h-2 shrink-0"
                  style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
                />
              )
            )}
            {entry.kind === "preview" ? (
              <div
                className="flex min-h-0"
                style={{ flex: `${fraction} 1 0%`, minHeight: 0 }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const intent = getToolColumnDropIntent(rect, event.clientX, event.clientY);
                  setSplitToolDrag((current) => current ? {
                    ...current,
                    targetArea: intent.area,
                    targetIndex: intent.area === "top"
                      ? (intent.side === "before" ? insertBeforeIndex : insertBeforeIndex + 1)
                      : (intent.side === "before" ? stackInsertBeforeIndex : stackInsertBeforeIndex + 1),
                    targetColumnId: intent.area === "top-stack" ? item.column.id : null,
                  } : current);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  commitSplitToolDrop();
                }}
              >
                <PanelDockPreview orientation="vertical" label={splitToolLabel ?? undefined} className="min-h-0 flex-1" />
              </div>
            ) : (
              renderToolIsland(
                entry.island, fraction, stackInsertBeforeIndex, insertBeforeIndex,
                session, paneState, isActiveSessionPane,
                props, item.column.id,
              )
            )}
          </React.Fragment>
        );
      })}
    </motion.div>
  );
}

// ── Main component ──

function SplitTopRowItemInner(props: SplitTopRowItemProps) {
  const {
    item, displayIndex, insertBeforeIndex, previewIndex,
    activeSessionId, activeSession, primaryPane,
    loadSplitPaneBootstrap,
    projects, activeProjectPath,
    splitView, paneControllerCtx,
    isIsland, shouldAnimateTopRowLayout,
    chatFadeStrength, topFadeBackground, titlebarSurfaceColor, bottomFadeBackground,
    splitToolDrag, setSplitToolDrag, commitSplitToolDrop, resetSplitToolDrag,
    sidebarOpen, sidebarToggle,
    showThinking,
    acpPermissionBehavior, setAcpPermissionBehavior,
    agents, devFillEnabled, handleSeedDevExampleSpaceData, seedDevExampleConversation,
    grabbedElements, handleRemoveGrabbedElement,
    lockedEngine, lockedAgentId,
    handleAgentWorktreeChange,
    handleRevert, handleFullRevert,
    makePaneScrollCallback,
    handleCloseSplitPane,
    queuedCount,
    availableContextual, activeTodos, bgAgents,
    paneRefs,
    getPreviewPaneMetrics: getMetrics,
    spaceActiveSpaceId,
  } = props;

  const { widthPercent, handleSharePx } = getMetrics(previewIndex);

  // ── Tool column rendering ──
  if (item.kind === "tool-column") {
    const primaryIsland = item.islands[0] ?? null;
    if (!primaryIsland) return null;

    if (primaryIsland.sourceSessionId === activeSessionId) {
      return renderToolColumn(item, activeSession, primaryPane, true, { ...props, previewIndex, insertBeforeIndex });
    }

    return (
      <SplitPaneHost
        key={item.column.id}
        sessionId={primaryIsland.sourceSessionId}
        acpPermissionBehavior={acpPermissionBehavior}
        loadBootstrap={loadSplitPaneBootstrap}
      >
        {({ session, paneState }) => renderToolColumn(item, session, paneState, false, { ...props, previewIndex, insertBeforeIndex })}
      </SplitPaneHost>
    );
  }

  // ── Chat pane rendering ──
  const sessionId = item.sessionId;
  const session = sessionId === activeSessionId ? activeSession : null;
  const paneState = sessionId === activeSessionId ? primaryPane : null;

  const buildChatPaneProps = (
    resolvedSession: ChatSession | null,
    resolvedPaneState: SessionPaneState,
    isActiveSessionPane: boolean,
  ) => {
    const paneProject = resolvedSession
      ? projects.find((project) => project.id === resolvedSession.projectId) ?? null
      : null;
    const paneProjectPath = paneProject
      ? (getStoredProjectGitCwd(paneProject.id) ?? paneProject.path)
      : activeProjectPath;
    const activeContextualTool = splitView.getPaneContextualTool(sessionId);

    return {
      sessionId,
      displayIndex,
      session: resolvedSession,
      paneState: resolvedPaneState,
      paneControllerCtx,
      isActiveSessionPane,
      widthPercent,
      handleSharePx,
      isIsland,
      shouldAnimate: shouldAnimateTopRowLayout,
      chatFadeStrength,
      topFadeBackground,
      titlebarSurfaceColor,
      bottomFadeBackground,
      isFocused: splitView.focusedSessionId === sessionId,
      sidebarOpen,
      onToggleSidebar: sidebarToggle,
      showThinking,
      acpPermissionBehavior,
      onAcpPermissionBehaviorChange: setAcpPermissionBehavior,
      agents,
      showDevFill: isActiveSessionPane ? devFillEnabled : false,
      onSeedDevExampleConversation: isActiveSessionPane ? seedDevExampleConversation : undefined,
      onSeedDevExampleSpaceData: isActiveSessionPane ? handleSeedDevExampleSpaceData : undefined,
      grabbedElements: isActiveSessionPane ? grabbedElements : [],
      onRemoveGrabbedElement: handleRemoveGrabbedElement,
      lockedEngine: isActiveSessionPane ? lockedEngine : (resolvedSession?.engine ?? null),
      lockedAgentId: isActiveSessionPane ? lockedAgentId : (resolvedSession?.agentId ?? null),
      projectPath: paneProjectPath,
      selectedWorktreePath: paneProjectPath,
      onSelectWorktree: isActiveSessionPane ? handleAgentWorktreeChange : undefined,
      codexModelData: props.codexRawModels,
      spaceId: spaceActiveSpaceId,
      onRevert: isActiveSessionPane ? handleRevert : undefined,
      onFullRevert: isActiveSessionPane ? handleFullRevert : undefined,
      onTopScrollProgress: makePaneScrollCallback(displayIndex),
      onClosePane: () => { void handleCloseSplitPane(sessionId); },
      onFocus: () => splitView.setFocusedSession(sessionId),
      queuedCount: isActiveSessionPane ? queuedCount : 0,
      splitView,
      availableContextual,
      activeContextualTool,
      activeTodos,
      bgAgents,
      onToolDragStart: (event: React.DragEvent<HTMLButtonElement>, toolId: ToolId) => {
        event.dataTransfer.setData("text/plain", toolId);
        event.dataTransfer.effectAllowed = "move";
        setSplitToolDrag({
          toolId,
          sourceSessionId: sessionId,
          islandId: null,
          targetArea: null,
          targetIndex: null,
          targetColumnId: null,
        });
      },
      onToolDragEnd: resetSplitToolDrag,
      onChatPaneDragOver: splitToolDrag ? (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const insertSide = getHorizontalInsertSide(rect, event.clientX);
        if (!insertSide) return;
        setSplitToolDrag((current) => current ? {
          ...current,
          targetArea: "top",
          targetIndex: insertSide === "before" ? insertBeforeIndex : insertBeforeIndex + 1,
        } : current);
      } : undefined,
      onChatPaneDrop: splitToolDrag ? (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        commitSplitToolDrop();
      } : undefined,
      paneRef: (element: HTMLDivElement | null) => { paneRefs.current[displayIndex] = element; },
    } as const;
  };

  if (session && paneState) {
    return <SplitChatPane {...buildChatPaneProps(session, paneState, true)} />;
  }

  return (
    <SplitPaneHost
      key={sessionId}
      sessionId={sessionId}
      acpPermissionBehavior={acpPermissionBehavior}
      loadBootstrap={loadSplitPaneBootstrap}
    >
      {({ session: hostedSession, paneState: hostedPaneState }) => (
        <SplitChatPane {...buildChatPaneProps(hostedSession, hostedPaneState, false)} />
      )}
    </SplitPaneHost>
  );
}

export const SplitTopRowItem = React.memo(SplitTopRowItemInner);
