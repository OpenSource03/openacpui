import React, { useCallback, useMemo, useRef, useEffect, useLayoutEffect, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { PanelLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAppOrchestrator } from "@/hooks/useAppOrchestrator";
import { useSpaceTheme } from "@/hooks/useSpaceTheme";
import { useGlassTheme } from "@/hooks/useGlassTheme";
import { ThemeProvider } from "@/hooks/useTheme";
import { usePaneController, type PaneControllerContext } from "@/hooks/usePaneController";
import { useToolIslandContext } from "@/hooks/useToolIslandContext";
import { usePanelResize } from "@/hooks/usePanelResize";
import {
  ISLAND_CONTROL_RADIUS,
  ISLAND_GAP,
  ISLAND_PANEL_GAP,
  ISLAND_RADIUS,
  RESIZE_HANDLE_WIDTH_ISLAND,
  TOOL_PICKER_WIDTH_ISLAND,
  equalWidthFractions,
} from "@/lib/layout/constants";
import type { InstalledAgent } from "@/types";
import { makeSessionBrowserPersistKey } from "./browser/browser-utils";
import { AppSidebar } from "./AppSidebar";
import { ChatHeader } from "./ChatHeader";
import { ChatSearchBar } from "./ChatSearchBar";
import { ChatView } from "./ChatView";
import { BottomComposer } from "./BottomComposer";
import { ToolPicker } from "./ToolPicker";
import { PANEL_TOOLS_MAP } from "./ToolPicker";
import type { ToolId } from "@/types/tools";
import { WelcomeScreen } from "./WelcomeScreen";
import { WelcomeWizard } from "./welcome/WelcomeWizard";
import { PanelDockPreview } from "./PanelDockPreview";
import { FilePreviewOverlay } from "./FilePreviewOverlay";
import { SettingsView } from "./SettingsView";
import { CodexAuthDialog } from "./CodexAuthDialog";
import { ACPAuthDialog } from "./ACPAuthDialog";
import { JiraBoardPanel } from "./JiraBoardPanel";
import { isMac, isWindows } from "@/lib/utils";
import { SplitHandle } from "./split/SplitHandle";
import { SplitDropZone } from "./split/SplitDropZone";
import { SplitTopRowItem } from "./split/SplitTopRowItem";
import { SplitBottomToolIsland } from "./split/SplitBottomToolIsland";
import { MainTopToolArea } from "./workspace/MainTopToolArea";
import { MainBottomToolDock } from "./workspace/MainBottomToolDock";
import { ToolIslandContent } from "./workspace/ToolIslandContent";
import { RightPanel } from "./workspace/RightPanel";
import { DRAFT_ID } from "@/hooks/session/types";
import { usePaneResize } from "@/hooks/usePaneResize";
import { useToolColumnResize } from "@/hooks/useToolColumnResize";
import { useBottomHeightResize } from "@/hooks/useBottomHeightResize";
import { useSpaceSwitchCooldown } from "@/hooks/useSpaceSwitchCooldown";
import { useMainToolPaneResize } from "@/hooks/useMainToolPaneResize";
import { useMainToolAreaLayout } from "@/hooks/useMainToolAreaLayout";
import { useMainToolAreaResize } from "@/hooks/useMainToolAreaResize";
import { useJiraBoard } from "@/hooks/useJiraBoard";
import { useSplitDragDrop } from "@/hooks/useSplitDragDrop";
import { useToolDragDrop, findDraggedIsland, type ToolDragState } from "@/hooks/useToolDragDrop";
import { useAppLayoutUIState } from "@/hooks/app-layout/useAppLayoutUIState";
import {
  useMainToolWorkspace,
  togglePanelTool,
  moveToolToSide,
  moveToolToBottom,
  moveBottomToolToTop,
} from "@/hooks/useMainToolWorkspace";
import type { PanelToolId } from "@/types";
import {
  MIN_TOOLS_PANEL_WIDTH,
  SPLIT_HANDLE_WIDTH,
} from "@/lib/layout/constants";
import { getAppMinimumWidth, getMaxVisibleSplitPaneCount } from "@/lib/layout/split-layout";
import {
  buildConstrainedFractionsFromMinimums,
  canFitTopRowLayout,
  getChatPaneMinWidthPx,
  type TopRowLayoutItemKind,
} from "@/lib/layout/workspace-constraints";
import {
  isNearBottomDockZone,
} from "@/lib/workspace/drag";
import { AgentProvider, type AgentContextValue } from "./AgentContext";

export function AppLayout() {
  const o = useAppOrchestrator();
  const { managers, agentState, state, ui, actions } = o;
  const {
    sidebar, projectManager, spaceManager, manager, settings, resolvedTheme, sessionTerminals, activeSessionTerminals, splitView,
  } = managers;
  const {
    agents, selectedAgent, saveAgent, deleteAgent, handleAgentChange, lockedEngine, lockedAgentId,
  } = agentState;
  const {
    activeProjectId, activeProjectPath, activeSpaceProject, activeSessionTerminalCwd, showThinking,
    hasProjects, isSpaceSwitching, showToolPicker, hasRightPanel,
    activeTodos, bgAgents, hasTodos, hasAgents, availableContextual,
    glassSupported, macLiquidGlassSupported, liveMacBackgroundEffect, devFillEnabled, jiraBoardEnabled,
    draftSpaceId,
  } = state;
  const {
    showSettings, setShowSettings, scrollToMessageId, setScrollToMessageId, chatSearchOpen, setChatSearchOpen,
  } = ui;
  const {
    handleToggleTool, handleToolReorder, handleNewChat, handleSend,
    handleModelChange, handlePermissionModeChange, handlePlanModeChange,
    handleClaudeModelEffortChange, handleAgentWorktreeChange, handleStop, handleSelectSession,
    handleSendQueuedNow, handleUnqueueMessage, handleCreateProject, handleImportCCSession,
    handleNavigateToMessage, handleStartCreateSpace, handleConfirmCreateSpace, handleCancelCreateSpace,
    handleUpdateSpace, handleDeleteSpace, handleMoveProjectToSpace, handleSeedDevExampleSpaceData,
  } = actions;

  // Draft is a real space — activeSpace already points to it, no synthetic needed
  const glassOverlayStyle = useSpaceTheme(
    spaceManager.activeSpace,
    resolvedTheme,
    glassSupported && settings.transparency,
    liveMacBackgroundEffect,
  );
  const spaceOpacity = spaceManager.activeSpace?.color.opacity ?? 1;
  const glassTheme = useGlassTheme({
    isGlassSupported: glassSupported,
    transparency: settings.transparency,
    resolvedTheme,
    liveMacBackgroundEffect,
    isIsland: settings.islandLayout,
    spaceOpacity,
  });
  const { isLightGlass, isNativeGlass, chatFadeStrength, titlebarSurfaceColor, topFadeBackground, bottomFadeBackground } = glassTheme;
  const layoutUI = useAppLayoutUIState({
    isNativeGlass,
    onHideSettings: () => setShowSettings(false),
  });
  const {
    windowFocused,
    welcomeCompleted,
    handleWelcomeComplete,
    handleReplayWelcome,
    grabbedElements,
    clearGrabbedElements,
    handleElementGrab,
    handleRemoveGrabbedElement,
    previewFile,
    handlePreviewFile,
    handleClosePreview,
  } = layoutUI;

  const jiraBoard = useJiraBoard({
    jiraBoardEnabled,
    activeSpaceId: spaceManager.activeSpaceId,
    activeProjectId,
    activeSessionId: manager.activeSessionId,
    projects: projectManager.projects,
    handleSend,
    handleNewChat,
  });
  const { jiraBoardProjectId, jiraBoardProject, setJiraBoardProjectForSpace, handleToggleProjectJiraBoard, handleCreateTaskFromJiraIssue } = jiraBoard;
  const [pendingSplitPaneSend, setPendingSplitPaneSend] = useState<{
    sessionId: string;
    text: string;
    images?: Parameters<typeof handleSend>[1];
    displayText?: string;
  } | null>(null);


  // Wrap handleSend to clear grabbed elements after sending
  const wrappedHandleSend = useCallback(
    async (...args: Parameters<typeof handleSend>) => {
      await handleSend(...args);
      clearGrabbedElements();
    },
    [clearGrabbedElements, handleSend],
  );

  const handleOpenNewChat = useCallback(
    async (projectId: string) => {
      const project = projectManager.projects.find((item) => item.id === projectId);
      if (project) {
        setJiraBoardProjectForSpace(project.spaceId || "default", null);
      }
      splitView.dismissSplitView();
      await handleNewChat(projectId);
    },
    [handleNewChat, projectManager.projects, setJiraBoardProjectForSpace, splitView.dismissSplitView],
  );

  const handleComposerClear = useCallback(
    async () => {
      const projectId = activeProjectId ?? activeSpaceProject?.id;
      if (!projectId) return;
      clearGrabbedElements();
      await handleOpenNewChat(projectId);
    },
    [activeProjectId, activeSpaceProject, clearGrabbedElements, handleOpenNewChat],
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
      splitView.dismissSplitView();
      handleSelectSession(sessionId);
    },
    [handleSelectSession, manager.sessions, projectManager.projects, setJiraBoardProjectForSpace, splitView.dismissSplitView],
  );


  useEffect(() => {
    if (!pendingSplitPaneSend) return;
    if (manager.activeSessionId !== pendingSplitPaneSend.sessionId) return;

    const nextSend = pendingSplitPaneSend;
    setPendingSplitPaneSend(null);

    void manager.send(nextSend.text, nextSend.images, nextSend.displayText);
  }, [manager.activeSessionId, manager.send, pendingSplitPaneSend]);

  const isIsland = settings.islandLayout;
  const splitGap = isIsland ? RESIZE_HANDLE_WIDTH_ISLAND / 2 : 0.5;
  const islandRadius = isWindows ? 8 : ISLAND_RADIUS;
  const islandControlRadius = isWindows ? 7 : ISLAND_CONTROL_RADIUS;
  const islandLayoutVars = isIsland
    ? {
        "--island-gap": `${ISLAND_GAP}px`,
        "--island-panel-gap": `${ISLAND_PANEL_GAP}px`,
        "--island-radius": `${islandRadius}px`,
        "--island-control-radius": `${islandControlRadius}px`,
        "--tool-picker-strip-width": `${TOOL_PICKER_WIDTH_ISLAND - ISLAND_PANEL_GAP}px`,
      } as React.CSSProperties
    : undefined;

  const resize = usePanelResize({
    settings,
    isIsland,
    hasRightPanel,
    activeSessionId: manager.activeSessionId,
    activeProjectId,
  });
  const {
    isResizing, contentRef, rightPanelRef, toolsColumnRef,
    handleResizeStart, handleRightSplitStart,
    pickerW, handleW,
  } = resize;

  // ── Split view resize ──
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const topRowRef = useRef<HTMLDivElement>(null);
  const [availableSplitWidth, setAvailableSplitWidth] = useState(0);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const updateAvailableSplitWidth = () => {
      setAvailableSplitWidth(element.getBoundingClientRect().width);
    };

    updateAvailableSplitWidth();
    const resizeObserver = new ResizeObserver(updateAvailableSplitWidth);
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
    };
  }, [contentRef]);

  const maxSplitPaneCount = useMemo(
    () => getMaxVisibleSplitPaneCount(availableSplitWidth),
    [availableSplitWidth],
  );

  const paneResize = usePaneResize({
    widthFractions: splitView.widthFractions,
    setWidthFractions: splitView.setWidthFractions,
    containerRef: splitContainerRef,
    minWidthsPx: splitView.topRowItems.map((item) => item.kind === "chat" ? getChatPaneMinWidthPx("split") : MIN_TOOLS_PANEL_WIDTH),
    handleWidthPx: SPLIT_HANDLE_WIDTH,
  });

  const mainWorkspaceProjectId = activeSpaceProject?.id ?? activeProjectId ?? null;
  const mainCombinedWorkspaceWidthRef = useRef(0);
  const mainToolWorkspace = useMainToolWorkspace(mainWorkspaceProjectId, {
    activeToolIds: settings.activeTools,
    toolOrder: settings.toolOrder,
    bottomTools: settings.bottomTools,
    bottomHeight: settings.bottomToolsHeight,
    bottomWidthFractions: settings.bottomToolsSplitRatios,
  }, mainCombinedWorkspaceWidthRef);
  const mainToolAreaRef = useRef<HTMLDivElement>(null);
  const mainTopToolColumnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const mainBottomRowRef = useRef<HTMLDivElement>(null);
  const mainBottomPaneResize = usePaneResize({
    widthFractions: mainToolWorkspace.bottomWidthFractions,
    setWidthFractions: mainToolWorkspace.setBottomWidthFractions,
    containerRef: mainBottomRowRef,
    minWidthsPx: mainToolWorkspace.bottomToolIslands.map(() => MIN_TOOLS_PANEL_WIDTH),
    handleWidthPx: SPLIT_HANDLE_WIDTH,
  });

  const isSplitActive = splitView.enabled;
  const splitPaneSessionIds = splitView.visibleSessionIds;
  const splitTopRowItems = splitView.topRowItems;
  const splitBottomToolIslands = splitView.bottomToolIslands;
  const previousActiveSplitSessionIdRef = useRef<string | null>(manager.activeSessionId);

  const queueSplitPaneSendAfterSwitch = useCallback(
    async (sessionId: string, text: string, images?: Parameters<typeof handleSend>[1], displayText?: string) => {
      setPendingSplitPaneSend({ sessionId, text, images, displayText });
      await manager.switchSession(sessionId);
    },
    [manager.switchSession],
  );

  const createSplitPaneDraftSession = useCallback(
    async (replacedSessionId: string, projectId: string, agent: InstalledAgent | null) => {
      const wantedEngine = agent?.engine ?? "claude";
      const wantedModel = settings.getModelForEngine(wantedEngine) || undefined;
      await manager.createSession(projectId, {
        model: wantedModel,
        permissionMode: settings.permissionMode,
        planMode: settings.planMode,
        thinkingEnabled: settings.thinking,
        effort: wantedEngine === "claude" ? settings.claudeEffort : undefined,
        engine: wantedEngine,
        agentId: agent?.id ?? "claude-code",
        cachedConfigOptions: agent?.cachedConfigOptions,
      });
      splitView.replaceSessionId(replacedSessionId, DRAFT_ID);
      splitView.setFocusedSession(DRAFT_ID);
    },
    [manager.createSession, settings, splitView],
  );

  // ── Drag-and-drop from sidebar ──
  const visibleSessionIds = useMemo(() => {
    const ids = new Set<string>();
    if (isSplitActive) {
      for (const sessionId of splitView.visibleSessionIds) ids.add(sessionId);
      return ids;
    }

    if (manager.activeSessionId) ids.add(manager.activeSessionId);
    return ids;
  }, [isSplitActive, manager.activeSessionId, splitView.visibleSessionIds]);

  useEffect(() => {
    if (!isSplitActive) {
      if (splitView.focusedSessionId !== null) {
        splitView.setFocusedSession(null);
      }
      return;
    }

    if (splitView.focusedSessionId && visibleSessionIds.has(splitView.focusedSessionId)) {
      return;
    }

    splitView.setFocusedSession(splitPaneSessionIds[0] ?? null);
  }, [
    isSplitActive,
    splitPaneSessionIds,
    splitView.focusedSessionId,
    splitView.setFocusedSession,
    visibleSessionIds,
  ]);

  useEffect(() => {
    const previousActiveSessionId = previousActiveSplitSessionIdRef.current;
    const nextActiveSessionId = manager.activeSessionId;
    previousActiveSplitSessionIdRef.current = nextActiveSessionId;

    if (!previousActiveSessionId || !nextActiveSessionId || previousActiveSessionId === nextActiveSessionId) {
      return;
    }

    if (!splitView.visibleSessionIds.includes(previousActiveSessionId)) {
      return;
    }

    const validSessionIds = new Set(manager.sessions.map((session) => session.id));
    if (validSessionIds.has(previousActiveSessionId)) {
      return;
    }

    splitView.replaceSessionId(previousActiveSessionId, nextActiveSessionId);
  }, [manager.activeSessionId, manager.sessions, splitView.replaceSessionId, splitView.visibleSessionIds]);

  useEffect(() => {
    const validSessionIds = new Set(manager.sessions.map((session) => session.id));
    if (manager.activeSessionId) {
      validSessionIds.add(manager.activeSessionId);
    }
    splitView.pruneSplitSessions(validSessionIds);
  }, [manager.activeSessionId, manager.sessions, splitView.pruneSplitSessions]);

  const requestAddSplitSession = useCallback((sessionId: string, position?: number) => {
    const result = splitView.requestAddSplitSession({
      sessionId,
      activeSessionId: manager.activeSessionId,
      maxPaneCount: maxSplitPaneCount,
      position,
    });

    if (!result.ok && result.reason === "insufficient-width") {
      toast.error("Widen the window to add another split pane.");
    }

    return result.ok;
  }, [manager.activeSessionId, maxSplitPaneCount, splitView]);

  const handleCloseSplitPane = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      splitView.dismissSplitView();
      return;
    }

    if (sessionId !== manager.activeSessionId) {
      splitView.removeSplitSession(sessionId);
      return;
    }

    const paneIndex = splitView.visibleSessionIds.indexOf(sessionId);
    const remainingSessionIds = splitView.visibleSessionIds.filter((visibleSessionId) => visibleSessionId !== sessionId);
    const replacementSessionId = remainingSessionIds[paneIndex] ?? remainingSessionIds[paneIndex - 1] ?? remainingSessionIds[0] ?? null;

    splitView.removeSplitSession(sessionId);
    if (!replacementSessionId) {
      return;
    }

    await manager.switchSession(replacementSessionId);
  }, [
    manager.activeSessionId,
    manager.switchSession,
    splitView.removeSplitSession,
    splitView.visibleSessionIds,
  ]);

  const splitDragDrop = useSplitDragDrop({
    paneCount: splitView.paneCount,
    canAcceptDrop: !!manager.activeSessionId && splitView.topRowItems.length < maxSplitPaneCount,
    containerRef: splitContainerRef,
    widthFractions: splitView.widthFractions,
    onDrop: (sessionId, position) => {
      requestAddSplitSession(sessionId, position);
    },
    visibleSessionIds,
  });
  const previewDropPosition = splitDragDrop.dragState.isDragging ? splitDragDrop.dragState.dropPosition : null;

  // ── Split view tool drag-and-drop ──

  const handleCommitSplitToolDrop = useCallback((drag: ToolDragState) => {
    if (drag.targetArea === "top-stack" && drag.targetColumnId) {
      if (drag.islandId) {
        splitView.moveToolIslandToTopColumn(drag.islandId, drag.targetColumnId, drag.targetIndex ?? undefined);
      } else if (drag.sourceSessionId) {
        splitView.openToolIslandInTopColumn(
          drag.sourceSessionId,
          drag.toolId,
          drag.targetColumnId,
          drag.targetIndex ?? undefined,
        );
      }
    } else {
      const targetDock = drag.targetArea;
      if (targetDock === "top" || targetDock === "bottom") {
        if (drag.islandId) {
          splitView.moveToolIsland(drag.islandId, targetDock, drag.targetIndex ?? undefined);
        } else if (drag.sourceSessionId) {
          splitView.openToolIsland(drag.sourceSessionId, drag.toolId, targetDock, drag.targetIndex ?? undefined);
        }
      }
    }
  }, [splitView]);

  const splitDrag = useToolDragDrop({ commitDrop: handleCommitSplitToolDrop });
  const splitToolDrag = splitDrag.drag;
  const setSplitToolDrag = splitDrag.setDrag;
  const resetSplitToolDrag = splitDrag.resetDrag;
  const commitSplitToolDrop = splitDrag.commitDrop;
  const splitToolLabel = splitDrag.dragLabel;

  const splitDraggedIsland = useMemo(
    () => findDraggedIsland(splitToolDrag, splitTopRowItems, splitBottomToolIslands, splitView.getToolIslandForPane),
    [splitToolDrag, splitTopRowItems, splitBottomToolIslands, splitView.getToolIslandForPane],
  );

  // ── Main workspace tool drag-and-drop ──

  const handleCommitMainToolDrop = useCallback((drag: ToolDragState) => {
    if (drag.targetArea === "top-stack" && drag.targetColumnId) {
      if (drag.islandId) {
        mainToolWorkspace.moveToolIslandToTopColumn(drag.islandId, drag.targetColumnId, drag.targetIndex ?? undefined);
      } else if (drag.toolId in PANEL_TOOLS_MAP) {
        mainToolWorkspace.openToolIslandInTopColumn(drag.toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">, drag.targetColumnId, drag.targetIndex ?? undefined);
      }
    } else {
      const targetDock = drag.targetArea;
      if ((targetDock === "top" || targetDock === "bottom") && drag.toolId in PANEL_TOOLS_MAP) {
        if (drag.islandId) {
          mainToolWorkspace.moveToolIsland(drag.islandId, targetDock, drag.targetIndex ?? undefined);
        } else {
          mainToolWorkspace.openToolIsland(drag.toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">, targetDock, drag.targetIndex ?? undefined);
        }
      }
    }
  }, [mainToolWorkspace]);

  const mainDrag = useToolDragDrop({ commitDrop: handleCommitMainToolDrop });
  const mainToolDrag = mainDrag.drag;
  const setMainToolDrag = mainDrag.setDrag;
  const resetMainToolDrag = mainDrag.resetDrag;
  const commitMainToolDrop = mainDrag.commitDrop;
  const mainToolLabel = mainDrag.dragLabel;

  const mainDraggedIsland = useMemo(() => {
    const found = findDraggedIsland(mainToolDrag, mainToolWorkspace.topRowItems, mainToolWorkspace.bottomToolIslands);
    if (found) return found;
    // Fallback for picker-initiated drags (no islandId, no sourceSessionId)
    if (mainToolDrag && !mainToolDrag.islandId && mainToolDrag.toolId in PANEL_TOOLS_MAP) {
      return mainToolWorkspace.getToolIsland(mainToolDrag.toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">);
    }
    return null;
  }, [mainToolDrag, mainToolWorkspace]);
  const topRowRenderEntries = useMemo<Array<
    | { kind: "item"; item: (typeof splitTopRowItems)[number] }
    | { kind: "preview" }
  >>(() => {
    type TopRowRenderEntry =
      | { kind: "item"; item: (typeof splitTopRowItems)[number] }
      | { kind: "preview" };

    if (!splitToolDrag || splitToolDrag.targetArea === null) {
      return splitTopRowItems.map<TopRowRenderEntry>((item) => ({ kind: "item", item }));
    }

    const draggedIslandId = splitToolDrag?.islandId ?? splitDraggedIsland?.id ?? null;
    const baseItems: TopRowRenderEntry[] = draggedIslandId
      ? splitTopRowItems.reduce<TopRowRenderEntry[]>((entries, item) => {
        if (item.kind !== "tool-column") {
          entries.push({ kind: "item", item });
          return entries;
        }

        const filteredIslands = item.islands.filter((island) => island.id !== draggedIslandId);
        if (filteredIslands.length === item.islands.length) {
          entries.push({ kind: "item", item });
          return entries;
        }
        if (filteredIslands.length === 0) {
          return entries;
        }

        entries.push({
          kind: "item",
          item: {
            ...item,
            column: {
              ...item.column,
              islandIds: filteredIslands.map((island) => island.id),
              splitRatios: equalWidthFractions(filteredIslands.length),
            },
            islands: filteredIslands,
          },
        });
        return entries;
      }, [])
      : splitTopRowItems.map<TopRowRenderEntry>((item) => ({ kind: "item", item }));

    if (splitToolDrag.targetArea !== "top" || splitToolDrag.targetIndex === null) {
      return baseItems;
    }

    const next: TopRowRenderEntry[] = [...baseItems];
    const insertIndex = Math.max(0, Math.min(splitToolDrag.targetIndex, next.length));
    next.splice(insertIndex, 0, { kind: "preview" });
    const previewKinds = next.map((entry) => entry.kind === "preview" ? "tool-column" : entry.item.kind);
    return canFitTopRowLayout(previewKinds, availableSplitWidth, "split")
      ? next
      : baseItems;
  }, [availableSplitWidth, splitDraggedIsland, splitToolDrag, splitTopRowItems]);
  const bottomRowRenderEntries = useMemo<Array<
    | { kind: "item"; island: (typeof splitBottomToolIslands)[number] }
    | { kind: "preview" }
  >>(() => {
    if (!splitToolDrag || splitToolDrag.targetArea === null) {
      return splitBottomToolIslands.map((island) => ({ kind: "item", island }));
    }

    const draggedIslandId = splitToolDrag?.islandId ?? splitDraggedIsland?.id ?? null;
    const baseIslands = draggedIslandId
      ? splitBottomToolIslands.filter((island) => island.id !== draggedIslandId)
      : splitBottomToolIslands;

    if (splitToolDrag.targetArea !== "bottom" || splitToolDrag.targetIndex === null) {
      return baseIslands.map((island) => ({ kind: "item", island }));
    }

    const next: Array<
      | { kind: "item"; island: (typeof splitBottomToolIslands)[number] }
      | { kind: "preview" }
    > = baseIslands.map((island) => ({ kind: "item", island }));
    const insertIndex = Math.max(0, Math.min(splitToolDrag.targetIndex, next.length));
    next.splice(insertIndex, 0, { kind: "preview" });
    return next;
  }, [splitBottomToolIslands, splitDraggedIsland, splitToolDrag]);
  const toolPreviewAffectsTopRowLayout = !!splitToolDrag && splitToolDrag.targetArea !== null;
  const previewTopRowCount = toolPreviewAffectsTopRowLayout
    ? Math.max(topRowRenderEntries.length, 1)
    : (previewDropPosition === null ? splitView.paneCount : splitView.paneCount + 1);
  const previewTopRowKinds = useMemo<TopRowLayoutItemKind[]>(() => {
    if (toolPreviewAffectsTopRowLayout) {
      return topRowRenderEntries.map((entry) => entry.kind === "preview" ? "tool-column" : entry.item.kind);
    }
    if (previewDropPosition === null) {
      return splitTopRowItems.map((item) => item.kind);
    }
    return Array.from({ length: previewTopRowCount }, () => "chat");
  }, [previewDropPosition, previewTopRowCount, splitTopRowItems, toolPreviewAffectsTopRowLayout, topRowRenderEntries]);
  const previewTopRowFractions = useMemo(
    () => buildConstrainedFractionsFromMinimums(
      previewTopRowKinds,
      availableSplitWidth,
      "split",
      previewDropPosition === null && !toolPreviewAffectsTopRowLayout ? splitView.widthFractions : undefined,
      SPLIT_HANDLE_WIDTH,
    ) ?? equalWidthFractions(previewTopRowCount),
    [
      availableSplitWidth,
      previewDropPosition,
      previewTopRowCount,
      previewTopRowKinds,
      splitView.widthFractions,
      toolPreviewAffectsTopRowLayout,
    ],
  );
  const bottomRowPreviewAffectsLayout = !!splitToolDrag && (
    splitToolDrag.targetArea === "bottom"
    || splitDraggedIsland?.dock === "bottom"
  );
  const previewBottomRowFractions = useMemo(() => {
    if (bottomRowPreviewAffectsLayout) {
      return equalWidthFractions(Math.max(bottomRowRenderEntries.length, 1));
    }
    return splitView.bottomWidthFractions.length === splitBottomToolIslands.length
      ? splitView.bottomWidthFractions
      : equalWidthFractions(splitBottomToolIslands.length);
  }, [bottomRowPreviewAffectsLayout, bottomRowRenderEntries.length, splitBottomToolIslands.length, splitView.bottomWidthFractions]);
  const splitBottomRowRef = useRef<HTMLDivElement>(null);
  const splitBottomPaneResize = usePaneResize({
    widthFractions: splitView.bottomWidthFractions,
    setWidthFractions: splitView.setBottomWidthFractions,
    containerRef: splitBottomRowRef,
    minWidthsPx: splitBottomToolIslands.map(() => MIN_TOOLS_PANEL_WIDTH),
    handleWidthPx: SPLIT_HANDLE_WIDTH,
  });
  const splitBottomHeightResize = useBottomHeightResize(splitView.bottomHeight, splitView.setBottomHeight);
  const mainBottomHeightResize = useBottomHeightResize(mainToolWorkspace.bottomHeight, mainToolWorkspace.setBottomHeight);
  const isSplitBottomHeightResizing = splitBottomHeightResize.isResizing;
  const isMainBottomHeightResizing = mainBottomHeightResize.isResizing;
  const splitToolColumnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const splitToolColumnResize = useToolColumnResize({
    columnRefs: splitToolColumnRefs,
    setSplitRatios: splitView.setTopToolColumnSplitRatios,
  });
  const mainToolColumnResize = useToolColumnResize({
    columnRefs: mainTopToolColumnRefs,
    setSplitRatios: mainToolWorkspace.setTopToolColumnSplitRatios,
  });

  // ── Chat scroll fade & titlebar tinting ──

  const chatIslandRef = useRef<HTMLDivElement>(null);
  const lastTopScrollProgressRef = useRef(0);

  // Per-pane scroll progress refs for split view (up to 4 panes)
  const paneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lastPaneScrollProgressRefs = useRef<number[]>([]);


  useEffect(() => {
    // Grabbed elements are session-specific context — discard on switch
    clearGrabbedElements();
  }, [clearGrabbedElements, manager.activeSessionId]);

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

  /** Create a scroll progress callback for a specific pane index. */
  const makePaneScrollCallback = useCallback((paneIndex: number) => {
    return (progress: number) => {
      const clamped = Math.max(0, Math.min(1, progress));
      const prev = lastPaneScrollProgressRefs.current[paneIndex] ?? 0;
      if (Math.abs(prev - clamped) < 0.005) return;
      lastPaneScrollProgressRefs.current[paneIndex] = clamped;
      paneRefs.current[paneIndex]?.style.setProperty("--chat-top-progress", clamped.toFixed(3));
    };
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

  const activeSessionProject = manager.activeSession
    ? projectManager.projects.find((project) => project.id === manager.activeSession?.projectId) ?? null
    : null;
  const activeSessionSpaceId = activeSessionProject?.spaceId || "default";
  const isCrossSpaceSessionVisible = !!manager.activeSession && activeSessionSpaceId !== spaceManager.activeSpaceId;
  const { spaceSwitchLayoutCooldown, hasSpaceChangedThisRender } = useSpaceSwitchCooldown({
    activeSpaceId: spaceManager.activeSpaceId,
    isSpaceSwitching,
    isCrossSpaceSessionVisible,
  });

  const getPreviewPaneMetrics = useCallback((previewIndex: number) => {
    const widthPercent = (previewTopRowFractions[previewIndex] ?? (1 / previewTopRowCount)) * 100;
    const totalHandleWidth = (previewTopRowCount - 1) * SPLIT_HANDLE_WIDTH;
    const handleSharePx = totalHandleWidth / previewTopRowCount;
    return { widthPercent, handleSharePx };
  }, [previewTopRowCount, previewTopRowFractions]);
  // ── Main workspace layout computation (extracted to hook) ──
  const mainLayout = useMainToolAreaLayout({
    mainToolWorkspace,
    mainToolDrag,
    mainDraggedIsland,
    availableSplitWidth,
    hasActiveSession: !!manager.activeSessionId,
    isIsland,
    showToolPicker,
    hasRightPanel,
    pickerW,
    handleW,
    rightPanelWidth: settings.rightPanelWidth,
  });
  const {
    mainTopToolColumnCount,
    mainWorkspaceChatMinWidth,
    mainCombinedWorkspaceWidth,
    mainToolAreaWidth,
    mainToolRelativeFractions,
    maxMainTopToolColumns,
    canAddMainTopColumn,
    effectiveMainToolAreaFraction,
    canFitToolAsNewColumn,
  } = mainLayout;
  mainCombinedWorkspaceWidthRef.current = mainCombinedWorkspaceWidth;
  const mainToolPaneResize = useMainToolPaneResize(
    mainToolWorkspace,
    mainToolAreaRef,
    effectiveMainToolAreaFraction,
  );

  useEffect(() => {
    const minWidth = getAppMinimumWidth({
      sidebarOpen: sidebar.isOpen,
      isIslandLayout: settings.islandLayout,
      hasActiveSession: !!manager.activeSessionId,
      hasRightPanel,
      hasToolsColumn: mainTopToolColumnCount > 0,
      toolsColumnWidth: mainTopToolColumnCount > 0
        ? Math.max(mainToolAreaWidth, mainToolWorkspace.preferredTopAreaWidthPx ?? 0)
        : undefined,
      isSplitViewEnabled: splitView.enabled && splitView.paneCount > 1,
      splitPaneCount: splitView.paneCount,
      splitTopRowItemKinds: splitView.topRowItems.map((item) => item.kind),
      isWindows,
    });
    window.claude.setMinWidth(Math.max(minWidth, 600));
  }, [
    hasRightPanel,
    mainToolAreaWidth,
    mainToolWorkspace.preferredTopAreaWidthPx,
    mainTopToolColumnCount,
    manager.activeSessionId,
    settings.islandLayout,
    sidebar.isOpen,
    splitView.enabled,
    splitView.paneCount,
    splitView.topRowItems,
  ]);

  // ── Main workspace resize (extracted to hook) ──
  const mainToolAreaResize = useMainToolAreaResize({
    mainToolWorkspace,
    mainTopToolColumnCount,
    mainCombinedWorkspaceWidth,
    mainToolRelativeFractions,
    mainWorkspaceChatMinWidth,
    mainToolAreaWidth,
    outerHandleWidth: handleW,
  });
  const isMainToolAreaResizing = mainToolAreaResize.isResizing;

  const shouldAnimateTopRowLayout = !paneResize.isResizing
    && !isResizing
    && !mainToolPaneResize.isResizing
    && !isMainToolAreaResizing
    && !mainBottomPaneResize.isResizing
    && !isMainBottomHeightResizing
    && !isSpaceSwitching
    && !isCrossSpaceSessionVisible
    && !hasSpaceChangedThisRender
    && !spaceSwitchLayoutCooldown;
  const showSinglePaneSplitPreview = !isSplitActive && splitDragDrop.dragState.isDragging && !!manager.activeSessionId;
  const singlePanePreviewPosition = splitDragDrop.dragState.dropPosition === 0 ? 0 : 1;
  const singlePanePreviewPaneStyle = useMemo(() => {
    const { widthPercent, handleSharePx } = getPreviewPaneMetrics(singlePanePreviewPosition);
    return {
      width: `calc(${widthPercent}% - ${handleSharePx}px)`,
      minWidth: getChatPaneMinWidthPx("split"),
    } as React.CSSProperties;
  }, [getPreviewPaneMetrics, singlePanePreviewPosition]);

  // ── Pane controller context (shared between active pane and split panes) ──
  const paneControllerCtx = useMemo<PaneControllerContext>(() => ({
    agents,
    selectedAgent,
    settings: {
      getModelForEngine: settings.getModelForEngine,
      permissionMode: settings.permissionMode,
      planMode: settings.planMode,
      claudeEffort: settings.claudeEffort,
      acpPermissionBehavior: settings.acpPermissionBehavior,
    },
    handleModelChange,
    handleClaudeModelEffortChange,
    handlePlanModeChange,
    handlePermissionModeChange,
    handleAgentChange,
    handleStop,
    handleComposerClear,
    wrappedHandleSend,
    manager: {
      setSessionModel: manager.setSessionModel,
      setSessionClaudeModelAndEffort: manager.setSessionClaudeModelAndEffort,
      setSessionPlanMode: manager.setSessionPlanMode,
      setSessionPermissionMode: manager.setSessionPermissionMode,
      setCodexEffort: manager.setCodexEffort,
      codexEffort: manager.codexEffort,
      codexRawModels: manager.codexRawModels,
      codexModelsLoadingMessage: manager.codexModelsLoadingMessage,
      cachedClaudeModels: manager.cachedClaudeModels,
      acpConfigOptions: manager.acpConfigOptions,
      acpConfigOptionsLoading: manager.acpConfigOptionsLoading,
      setACPConfig: manager.setACPConfig,
    },
    splitView: {
      setFocusedSession: splitView.setFocusedSession,
    },
    createSplitPaneDraftSession,
    queueSplitPaneSendAfterSwitch,
  }), [
    agents, selectedAgent, settings, manager, splitView.setFocusedSession,
    handleModelChange, handleClaudeModelEffortChange, handlePlanModeChange,
    handlePermissionModeChange, handleAgentChange, handleStop,
    handleComposerClear, wrappedHandleSend,
    createSplitPaneDraftSession, queueSplitPaneSendAfterSwitch,
  ]);

  // ── Agent context (eliminates agent prop drilling to 4+ children) ──
  const agentContextValue = useMemo<AgentContextValue>(() => ({
    agents,
    selectedAgent,
    saveAgent,
    deleteAgent,
    handleAgentChange,
    lockedEngine,
    lockedAgentId,
  }), [agents, selectedAgent, saveAgent, deleteAgent, handleAgentChange, lockedEngine, lockedAgentId]);

  // Split top-row and bottom-dock props are now passed to <SplitTopRowItem> and
  // <SplitBottomToolIsland> components — see their usage in the JSX below.
  // The shared tool island context (toolIslandCtx) is passed to both.

  const activePaneController = usePaneController(
    manager.activeSessionId ?? "",
    manager.activeSession,
    manager.primaryPane,
    true,
    paneControllerCtx,
  );
  // Only expose the controller when there's an active session
  const activePaneCtrl = manager.activeSessionId ? activePaneController : null;

  const { activeTools } = settings;
  useEffect(() => {
    if (!manager.activeSessionId) return;
    const hasLegacyPanelTools = [...settings.activeTools].some((toolId) => toolId in PANEL_TOOLS_MAP);
    if (!hasLegacyPanelTools) return;
    settings.setActiveTools((prev) => {
      const next = new Set([...prev].filter((toolId) => !(toolId in PANEL_TOOLS_MAP)));
      return next.size === prev.size ? prev : next;
    });
  }, [manager.activeSessionId, settings]);
  const mainOpenPanelToolIds = useMemo(
    () => new Set<ToolId>([
      ...mainToolWorkspace.topRowItems.flatMap((item) => item.islands.map((island) => island.toolId)),
      ...mainToolWorkspace.bottomToolIslands.map((island) => island.toolId),
    ]),
    [mainToolWorkspace.bottomToolIslands, mainToolWorkspace.topRowItems],
  );
  const mainPickerActiveTools = useMemo(
    () => new Set<ToolId>([
      ...activeTools,
      ...mainOpenPanelToolIds,
    ]),
    [activeTools, mainOpenPanelToolIds],
  );
  useEffect(() => {
    if (isSplitActive) return;
    if (mainTopToolColumnCount <= maxMainTopToolColumns) return;
    const targetColumnId = mainToolWorkspace.topRowItems[Math.max(0, maxMainTopToolColumns - 1)]?.column.id ?? null;
    if (!targetColumnId) return;
    const overflowColumns = mainToolWorkspace.topRowItems.slice(maxMainTopToolColumns);
    for (const column of overflowColumns) {
      for (const island of column.islands) {
        mainToolWorkspace.moveToolIslandToTopColumn(island.id, targetColumnId);
      }
    }
  }, [isSplitActive, mainToolWorkspace, mainTopToolColumnCount, maxMainTopToolColumns]);

  // ── Shared tool island context (terminal/MCP/git props common to all islands) ──
  // Terminal tabs now bind to the active session. When no session is active we
  // short-circuit the mutation callbacks — there's nothing meaningful to do.
  const terminalSessionId = manager.activeSessionId;
  const toolIslandCtx = useToolIslandContext({
    spaceId: spaceManager.activeSpaceId,
    terminalTabs: activeSessionTerminals.tabs,
    activeTerminalTabId: activeSessionTerminals.activeTabId,
    terminalsReady: sessionTerminals.isReady,
    onSetActiveTab: (tabId) => {
      if (!terminalSessionId) return;
      sessionTerminals.setActiveTab(terminalSessionId, tabId);
    },
    onCreateTerminal: async () => {
      if (!terminalSessionId) return;
      await sessionTerminals.createTerminal(terminalSessionId, activeSessionTerminalCwd ?? undefined);
    },
    onEnsureTerminal: async () => {
      if (!terminalSessionId) return;
      await sessionTerminals.ensureTerminal(terminalSessionId, activeSessionTerminalCwd ?? undefined);
    },
    onCloseTerminal: async (tabId) => {
      if (!terminalSessionId) return;
      await sessionTerminals.closeTerminal(terminalSessionId, tabId);
    },
    resolvedTheme,
    onElementGrab: handleElementGrab,
    onScrollToToolCall: setScrollToMessageId,
    onPreviewFile: handlePreviewFile,
    collapsedRepos: settings.collapsedRepos,
    onToggleRepoCollapsed: settings.toggleRepoCollapsed,
    mcpServerStatuses: manager.mcpServerStatuses,
    mcpStatusPreliminary: manager.mcpStatusPreliminary,
    onRefreshMcpStatus: manager.refreshMcpStatus,
    onReconnectMcpServer: manager.reconnectMcpServer,
    onRestartWithMcpServers: manager.restartWithMcpServers,
  });

  const renderMainWorkspaceToolContent = useCallback((
    toolId: Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">,
    controls: React.ReactNode,
  ) => (
    <ToolIslandContent
      toolId={toolId}
      persistKey={makeSessionBrowserPersistKey(manager.activeSessionId)}
      headerControls={controls}
      projectPath={activeProjectPath}
      projectRoot={activeSpaceProject?.path}
      projectId={activeProjectId ?? null}
      sessionId={manager.activeSessionId}
      messages={manager.messages}
      activeEngine={manager.activeSession?.engine}
      isActiveSessionPane={true}
      hasLiveSession={!manager.isDraft}
      {...toolIslandCtx}
    />
  ), [activeProjectId, activeProjectPath, activeSpaceProject?.path, manager.activeSession?.engine, manager.activeSessionId, manager.isDraft, manager.messages, toolIslandCtx]);
  const handleMoveMainBottomToolToTop = useCallback(
    (islandId: string) => moveBottomToolToTop(mainToolWorkspace, islandId, canFitToolAsNewColumn),
    [mainToolWorkspace, canFitToolAsNewColumn],
  );
  const showCodexAuthDialog =
    !!manager.activeSessionId &&
    manager.activeSession?.engine === "codex" &&
    manager.codexAuthRequired;
  const acpAuthAgentName = manager.acpAuthAgentId
    ? agents.find((agent) => agent.id === manager.acpAuthAgentId)?.name ?? manager.acpAuthAgentId
    : "ACP Agent";
  const showAcpAuthDialog =
    !!manager.acpAuthSessionId &&
    manager.acpAuthRequired;

  return (
    <ThemeProvider value={resolvedTheme}>
    <AgentProvider value={agentContextValue}>
    <div
      className={`relative flex h-screen overflow-hidden bg-sidebar text-foreground${settings.islandLayout ? "" : " no-islands"}${settings.islandShine ? "" : " no-island-shine"}`}
      style={islandLayoutVars}
    >
      {/* Glass tint overlay — sits behind content, tints the native transparency */}
      {glassOverlayStyle && (
        <div
          className="pointer-events-none fixed inset-0 z-0 transition-[background] duration-300"
          style={glassOverlayStyle}
        />
      )}
      {/* Unfocused veil — subtle dim/brighten on macOS liquid glass when window loses focus */}
      {isNativeGlass && (
        <div
          className={`pointer-events-none fixed inset-0 z-0 transition-opacity duration-300 ${windowFocused ? "opacity-0" : "opacity-100"}`}
          style={{ background: isLightGlass ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.34)" }}
        />
      )}
      <AppSidebar
        state={{
          isOpen: sidebar.isOpen,
          islandLayout: settings.islandLayout,
          projects: projectManager.projects,
          sessions: manager.sessions,
          activeSessionId: manager.activeSessionId,
          jiraBoardProjectId,
          jiraBoardEnabled,
          foldersByProject: o.foldersByProject,
          organizeByChatBranch: settings.organizeByChatBranch,
          draftSpaceId,
        }}
        projectActions={{
          onNewChat: handleOpenNewChat,
          onToggleProjectJiraBoard: handleToggleProjectJiraBoard,
          onCreateProject: handleCreateProject,
          onDeleteProject: projectManager.deleteProject,
          onRenameProject: projectManager.renameProject,
          onUpdateProjectIcon: projectManager.updateProjectIcon,
          onImportCCSession: handleImportCCSession,
          onToggleSidebar: sidebar.toggle,
          onNavigateToMessage: handleNavigateToMessage,
          onMoveProjectToSpace: handleMoveProjectToSpace,
          onReorderProject: projectManager.reorderProject,
          onCreateFolder: o.handleCreateFolder,
          onSetOrganizeByChatBranch: settings.setOrganizeByChatBranch,
        }}
        spaceState={{
          spaces: spaceManager.spaces,
          activeSpaceId: spaceManager.activeSpaceId,
        }}
        spaceActions={{
          onSelectSpace: spaceManager.setActiveSpaceId,
          onStartCreateSpace: handleStartCreateSpace,
          onUpdateSpace: handleUpdateSpace,
          onDeleteSpace: handleDeleteSpace,
          onOpenSettings: () => setShowSettings("general"),
          onConfirmCreateSpace: handleConfirmCreateSpace,
          onCancelCreateSpace: handleCancelCreateSpace,
        }}
        sessionActions={{
          onSelectSession: handleSidebarSelectSession,
          onDeleteSession: manager.deleteSession,
          onRenameSession: manager.renameSession,
          onPinSession: o.handlePinSession,
          onMoveSessionToFolder: o.handleMoveSessionToFolder,
          onRenameFolder: o.handleRenameFolder,
          onDeleteFolder: o.handleDeleteFolder,
          onPinFolder: o.handlePinFolder,
          onOpenInSplitView: (sessionId) => {
            void requestAddSplitSession(sessionId);
          },
          canOpenSessionInSplitView: (sessionId) => splitView.canShowSessionSplitAction(sessionId, manager.activeSessionId),
        }}
      />

      <div ref={contentRef} className={`flex min-w-0 flex-1 flex-col ${settings.islandLayout ? "m-[var(--island-gap)]" : sidebar.isOpen ? "flat-divider-s" : ""} ${isResizing ? "select-none" : ""}`}>
        {showSettings && (
          <SettingsView
            onClose={() => setShowSettings(false)}
            glassSupported={glassSupported}
            macLiquidGlassSupported={macLiquidGlassSupported}
            sidebarOpen={sidebar.isOpen}
            onToggleSidebar={sidebar.toggle}
            onReplayWelcome={handleReplayWelcome}
            initialSection={showSettings}
          />
        )}
        {/* Keep chat area mounted (hidden) when settings is open to avoid
            destroying/recreating the entire ChatView DOM tree on toggle */}
        <div className={showSettings ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        {/* ── Top row: Split View OR (Chat | Right Panel | Tools Column | ToolPicker) ── */}
        <div
          ref={(element) => {
            topRowRef.current = element;
            if (!isSplitActive) {
              splitContainerRef.current = element;
            }
          }}
          className="relative flex min-h-0 flex-1"
          onDragEnter={!isSplitActive ? splitDragDrop.handleDragEnter : undefined}
          onDragOver={!isSplitActive
            ? (mainToolDrag
              ? ((event: React.DragEvent<HTMLDivElement>) => {
                const rect = event.currentTarget.getBoundingClientRect();
                if (!isNearBottomDockZone(rect, event.clientY)) return;
                event.preventDefault();
                setMainToolDrag((current) => current ? {
                  ...current,
                  targetArea: "bottom",
                  targetIndex: mainToolWorkspace.bottomToolIslands.length,
                  targetColumnId: null,
                } : current);
              })
              : splitDragDrop.handleDragOver)
            : undefined}
          onDragLeave={!isSplitActive ? splitDragDrop.handleDragLeave : undefined}
          onDrop={!isSplitActive ? splitDragDrop.handleDrop : undefined}
        >

          {/* ══════ SPLIT VIEW RENDERING ══════ */}
          {isSplitActive ? (
            <LayoutGroup id="split-view-layout">
              <div
                className="flex min-h-0 min-w-0 flex-1 flex-col"
                onDragOver={(event) => {
                  if (!splitToolDrag || splitBottomToolIslands.length > 0) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const bottomZoneHeight = Math.min(180, rect.height * 0.28);
                  if (event.clientY < rect.bottom - bottomZoneHeight) return;
                  event.preventDefault();
                  setSplitToolDrag((current) => current ? {
                    ...current,
                    targetArea: "bottom",
                    targetIndex: 0,
                  } : current);
                }}
              >
                <div
                  ref={splitContainerRef}
                  className="flex min-h-0 min-w-0 flex-1"
                  onDragEnter={!splitToolDrag ? splitDragDrop.handleDragEnter : undefined}
                  onDragOver={!splitToolDrag ? splitDragDrop.handleDragOver : undefined}
                  onDragLeave={!splitToolDrag ? splitDragDrop.handleDragLeave : undefined}
                  onDrop={!splitToolDrag ? splitDragDrop.handleDrop : undefined}
                >
                  {topRowRenderEntries.map((entry, displayIndex) => {
                    const isToolPreviewMode = !!splitToolDrag && splitToolDrag.targetArea !== null;
                    const ghostBeforeThisPane = !isToolPreviewMode && previewDropPosition !== null && previewDropPosition <= displayIndex;
                    const panePreviewIndex = isToolPreviewMode ? displayIndex : (ghostBeforeThisPane ? displayIndex + 1 : displayIndex);
                    const dropZonePreviewIndex = previewDropPosition ?? splitTopRowItems.length;
                    const dropZoneMetrics = getPreviewPaneMetrics(dropZonePreviewIndex);
                    const dropZoneStyle = {
                      width: `calc(${dropZoneMetrics.widthPercent}% - ${dropZoneMetrics.handleSharePx}px + ${SPLIT_HANDLE_WIDTH}px)`,
                      minWidth: getChatPaneMinWidthPx("split"),
                    } as React.CSSProperties;
                    const previewPaneMetrics = getPreviewPaneMetrics(displayIndex);
                    const previewPaneStyle = {
                      width: `calc(${previewPaneMetrics.widthPercent}% - ${previewPaneMetrics.handleSharePx}px)`,
                      minWidth: MIN_TOOLS_PANEL_WIDTH,
                    } as React.CSSProperties;
                    const insertBeforeIndex = topRowRenderEntries
                      .slice(0, displayIndex)
                      .filter((candidate) => candidate.kind === "item")
                      .length;

                    return (
                      <React.Fragment key={entry.kind === "item" ? entry.item.itemId : `split-tool-preview-${displayIndex}`}>
                        {displayIndex === 0 && !splitToolDrag && splitDragDrop.dragState.isDragging && splitDragDrop.dragState.dropPosition === 0 && (
                          <SplitDropZone
                            active={true}
                            session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                            style={dropZoneStyle}
                          />
                        )}

                        {displayIndex > 0 && (
                          <>
                            {!splitToolDrag && splitDragDrop.dragState.isDragging && splitDragDrop.dragState.dropPosition === displayIndex && (
                              <SplitDropZone
                                active={true}
                                session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                                style={dropZoneStyle}
                              />
                            )}
                            <SplitHandle
                              isIsland={isIsland}
                              isResizing={paneResize.isResizing || isSplitBottomHeightResizing}
                              onResizeStart={(event) => paneResize.handleSplitResizeStart(displayIndex - 1, event)}
                              onDoubleClick={paneResize.handleSplitDoubleClick}
                            />
                          </>
                        )}

                        {entry.kind === "preview" ? (
                          <SplitDropZone
                            active={true}
                            label={splitToolLabel ?? undefined}
                            style={previewPaneStyle}
                            onDragOver={(event) => {
                              event.preventDefault();
                              setSplitToolDrag((current) => current ? {
                                ...current,
                                targetArea: "top",
                                targetIndex: displayIndex,
                              } : current);
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              commitSplitToolDrop();
                            }}
                          />
                        ) : (
                          <SplitTopRowItem
                            item={entry.item}
                            displayIndex={displayIndex}
                            previewIndex={panePreviewIndex}
                            insertBeforeIndex={insertBeforeIndex}
                            activeSessionId={manager.activeSessionId}
                            activeSession={manager.activeSession}
                            primaryPane={manager.primaryPane}
                            loadSplitPaneBootstrap={manager.loadSplitPaneBootstrap}
                            projects={projectManager.projects}
                            activeProjectPath={activeProjectPath}
                            splitView={splitView}
                            paneControllerCtx={paneControllerCtx}
                            isIsland={isIsland}
                            shouldAnimateTopRowLayout={shouldAnimateTopRowLayout}
                            chatFadeStrength={chatFadeStrength}
                            topFadeBackground={topFadeBackground}
                            titlebarSurfaceColor={titlebarSurfaceColor}
                            bottomFadeBackground={bottomFadeBackground}
                            splitToolDrag={splitToolDrag}
                            setSplitToolDrag={setSplitToolDrag}
                            commitSplitToolDrop={commitSplitToolDrop}
                            resetSplitToolDrag={resetSplitToolDrag}
                            splitToolLabel={splitToolLabel}
                            splitToolColumnRefs={splitToolColumnRefs}
                            paneRefs={paneRefs}
                            splitToolColumnResize={splitToolColumnResize}
                            toolIslandCtx={toolIslandCtx}
                            spaceActiveSpaceId={spaceManager.activeSpaceId}
                            sidebarOpen={sidebar.isOpen}
                            sidebarToggle={sidebar.toggle}
                            showThinking={showThinking}
                            acpPermissionBehavior={settings.acpPermissionBehavior}
                            setAcpPermissionBehavior={settings.setAcpPermissionBehavior}
                            agents={agents}
                            devFillEnabled={devFillEnabled}
                            handleSeedDevExampleSpaceData={handleSeedDevExampleSpaceData}
                            seedDevExampleConversation={manager.seedDevExampleConversation}
                            grabbedElements={grabbedElements}
                            handleRemoveGrabbedElement={handleRemoveGrabbedElement}
                            lockedEngine={lockedEngine}
                            lockedAgentId={lockedAgentId}
                            handleAgentWorktreeChange={handleAgentWorktreeChange}
                            handleRevert={manager.isConnected && manager.revertFiles ? handleRevert : undefined}
                            handleFullRevert={manager.isConnected && manager.fullRevert ? handleFullRevert : undefined}
                            makePaneScrollCallback={makePaneScrollCallback}
                            setScrollToMessageId={setScrollToMessageId}
                            handlePreviewFile={handlePreviewFile}
                            handleElementGrab={handleElementGrab}
                            handleCloseSplitPane={handleCloseSplitPane}
                            codexRawModels={manager.codexRawModels}
                            queuedCount={manager.queuedCount}
                            availableContextual={availableContextual}
                            activeTodos={activeTodos}
                            bgAgents={bgAgents}
                            getPreviewPaneMetrics={getPreviewPaneMetrics}
                            onManageACPs={() => setShowSettings("agents")}
                          />
                        )}

                        {displayIndex === topRowRenderEntries.length - 1 && !splitToolDrag
                          && splitDragDrop.dragState.isDragging
                          && splitDragDrop.dragState.dropPosition === splitTopRowItems.length
                          && (
                            <SplitDropZone
                              active={true}
                              session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                              style={dropZoneStyle}
                            />
                          )}
                      </React.Fragment>
                    );
                  })}
                </div>

                {(splitBottomToolIslands.length > 0 || splitToolDrag?.targetArea === "bottom") && (
                  <>
                    <div
                      className="resize-row flat-divider-soft group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                      style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
                      onMouseDown={splitBottomToolIslands.length > 0 ? splitBottomHeightResize.handleResizeStart : undefined}
                    >
                      <div
                        className={`h-0.5 w-10 rounded-full transition-colors duration-150 ${
                          isResizing || isSplitBottomHeightResizing
                            ? "bg-foreground/40"
                            : "bg-transparent group-hover:bg-foreground/25"
                        }`}
                      />
                    </div>
                    <div
                      ref={splitBottomRowRef}
                      className="flex shrink-0 overflow-hidden"
                      style={{ height: splitBottomToolIslands.length > 0 ? splitView.bottomHeight : 120 }}
                    >
                      {bottomRowRenderEntries.length === 0 && splitToolDrag?.targetArea === "bottom" && (
                        <div
                          className="flex min-h-0 flex-1 px-6 pb-1"
                          onDragOver={(event) => {
                            event.preventDefault();
                            setSplitToolDrag((current) => current ? {
                              ...current,
                              targetArea: "bottom",
                              targetIndex: 0,
                            } : current);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            commitSplitToolDrop();
                          }}
                        >
                          <PanelDockPreview orientation="horizontal" label={splitToolLabel ?? undefined} className="mx-auto h-16 w-full max-w-[420px]" />
                        </div>
                      )}
                      {bottomRowRenderEntries.map((entry, displayIndex) => {
                        const fraction = previewBottomRowFractions[displayIndex] ?? (1 / Math.max(bottomRowRenderEntries.length, 1));
                        const insertBeforeIndex = bottomRowRenderEntries
                          .slice(0, displayIndex)
                          .filter((candidate) => candidate.kind === "item")
                          .length;

                        return (
                          <React.Fragment key={entry.kind === "item" ? entry.island.id : `split-bottom-preview-${displayIndex}`}>
                            {entry.kind === "preview" ? (
                              <div
                                className="mx-1 flex min-h-0"
                                style={{ flex: `${fraction} 1 0%`, minWidth: 0 }}
                                onDragOver={(event) => {
                                  event.preventDefault();
                                  setSplitToolDrag((current) => current ? {
                                    ...current,
                                    targetArea: "bottom",
                                    targetIndex: insertBeforeIndex,
                                  } : current);
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  commitSplitToolDrop();
                                }}
                              >
                                <PanelDockPreview orientation="horizontal" label={splitToolLabel ?? undefined} className="min-h-0 flex-1" />
                              </div>
                            ) : (
                              <SplitBottomToolIsland
                                island={entry.island}
                                fraction={fraction}
                                insertBeforeIndex={insertBeforeIndex}
                                activeSessionId={manager.activeSessionId}
                                activeSession={manager.activeSession}
                                primaryPane={manager.primaryPane}
                                loadSplitPaneBootstrap={manager.loadSplitPaneBootstrap}
                                projects={projectManager.projects}
                                activeProjectPath={activeProjectPath}
                                splitView={splitView}
                                shouldAnimateTopRowLayout={shouldAnimateTopRowLayout}
                                splitToolDrag={splitToolDrag}
                                setSplitToolDrag={setSplitToolDrag}
                                commitSplitToolDrop={commitSplitToolDrop}
                                resetSplitToolDrag={resetSplitToolDrag}
                                toolIslandCtx={toolIslandCtx}
                                acpPermissionBehavior={settings.acpPermissionBehavior}
                                handleAgentWorktreeChange={handleAgentWorktreeChange}
                              />
                            )}
                            {displayIndex < bottomRowRenderEntries.length - 1 && (
                              <SplitHandle
                                isIsland={isIsland}
                                isResizing={splitBottomPaneResize.isResizing}
                                onResizeStart={(event) => splitBottomPaneResize.handleSplitResizeStart(displayIndex, event)}
                                onDoubleClick={splitBottomPaneResize.handleSplitDoubleClick}
                              />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </LayoutGroup>
          ) : (
          /* ══════ NORMAL (SINGLE PANE) RENDERING ══════ */
          <>
          {showSinglePaneSplitPreview && singlePanePreviewPosition === 0 && (
            <>
              <SplitDropZone
                active={true}
                session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                style={singlePanePreviewPaneStyle}
              />
              <motion.div
                layout
                transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.65 }}
                className="flex w-2 shrink-0 items-center justify-center"
                style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
              >
                <div className="h-10 w-0.5 rounded-full bg-foreground/18" />
              </motion.div>
            </>
          )}

          <motion.div
            layout={shouldAnimateTopRowLayout}
            transition={shouldAnimateTopRowLayout
              ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
              : { duration: 0 }}
            ref={(el) => {
              (chatIslandRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }}
            className={`chat-island island relative flex min-w-0 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background ${
              showSinglePaneSplitPreview ? "shrink-0" : "flex-1"
            }`}
            style={(showSinglePaneSplitPreview
              ? {
                  ...singlePanePreviewPaneStyle,
                  "--chat-fade-strength": String(chatFadeStrength),
                }
              : {
                  minWidth: mainWorkspaceChatMinWidth,
                  "--chat-fade-strength": String(chatFadeStrength),
                }) as React.CSSProperties}
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
                  showSidebarToggle={true}
                  isProcessing={manager.isProcessing}
                  model={activePaneCtrl?.paneHeaderModel}
                  sessionId={manager.sessionInfo?.sessionId}
                  totalCost={manager.totalCost}
                  title={manager.activeSession?.title}
                  titleGenerating={manager.activeSession?.titleGenerating}
                  planMode={activePaneCtrl?.panePlanMode ?? settings.planMode}
                  permissionMode={activePaneCtrl?.panePermissionMode}
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
                spaceId={spaceManager.activeSpaceId}
                messages={manager.messages}
                isProcessing={manager.isProcessing}
                showThinking={showThinking}
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
              />
              <div
                className={`pointer-events-none absolute inset-x-0 bottom-0 z-[5] transition-opacity duration-200 ${isIsland ? "h-24" : "h-28"}`}
                style={{
                  opacity: chatFadeStrength,
                  background: bottomFadeBackground,
                }}
              />
              <div data-chat-composer className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
                <BottomComposer
                  pendingPermission={manager.pendingPermission}
                  onRespondPermission={manager.respondPermission}
                  onSend={wrappedHandleSend}
                  onClear={handleComposerClear}
                  onStop={handleStop}
                  isProcessing={manager.isProcessing}
                  queuedCount={manager.queuedCount}
                  model={activePaneCtrl?.paneModel ?? settings.model}
                  claudeEffort={activePaneCtrl?.paneClaudeEffort ?? settings.claudeEffort}
                  planMode={activePaneCtrl?.panePlanMode ?? settings.planMode}
                  permissionMode={activePaneCtrl?.panePermissionMode ?? (manager.sessionInfo?.permissionMode ?? settings.permissionMode)}
                  onModelChange={activePaneCtrl?.handlePaneModelChange ?? handleModelChange}
                  onClaudeModelEffortChange={activePaneCtrl?.handlePaneClaudeModelEffortChange ?? handleClaudeModelEffortChange}
                  onPlanModeChange={activePaneCtrl?.handlePanePlanModeChange ?? handlePlanModeChange}
                  onPermissionModeChange={activePaneCtrl?.handlePanePermissionModeChange ?? handlePermissionModeChange}
                  projectPath={activeProjectPath}
                  contextUsage={manager.contextUsage}
                  isCompacting={manager.isCompacting}
                  onCompact={manager.compact}
                  agents={agents}
                  selectedAgent={activePaneCtrl?.selectedPaneAgent ?? selectedAgent}
                  onAgentChange={activePaneCtrl?.handlePaneAgentChange ?? handleAgentChange}
                  slashCommands={activePaneCtrl?.paneSlashCommands ?? manager.slashCommands}
                  acpConfigOptions={activePaneCtrl?.paneAcpConfigOptions ?? manager.acpConfigOptions}
                  acpConfigOptionsLoading={activePaneCtrl?.paneAcpConfigOptionsLoading ?? manager.acpConfigOptionsLoading}
                  onACPConfigChange={activePaneCtrl?.handlePaneAcpConfigChange ?? manager.setACPConfig}
                  acpPermissionBehavior={settings.acpPermissionBehavior}
                  onAcpPermissionBehaviorChange={settings.setAcpPermissionBehavior}
                  supportedModels={activePaneCtrl?.paneSupportedModels ?? manager.supportedModels}
                  codexModelsLoadingMessage={activePaneCtrl?.paneCodexModelsLoadingMessage ?? manager.codexModelsLoadingMessage}
                  codexEffort={activePaneCtrl?.paneCodexEffort ?? manager.codexEffort}
                  onCodexEffortChange={activePaneCtrl?.handlePaneCodexEffortChange ?? manager.setCodexEffort}
                  codexModelData={manager.codexRawModels}
                  grabbedElements={grabbedElements}
                  onRemoveGrabbedElement={handleRemoveGrabbedElement}
                  lockedEngine={lockedEngine}
                  lockedAgentId={lockedAgentId}
                  selectedWorktreePath={activeSessionTerminalCwd}
                  onSelectWorktree={handleAgentWorktreeChange}
                  isEmptySession={manager.messages.length === 0}
                  onManageACPs={() => setShowSettings("agents")}
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
          </motion.div>

          {showSinglePaneSplitPreview && singlePanePreviewPosition === 1 && (
            <>
              <motion.div
                layout
                transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.65 }}
                className="flex w-2 shrink-0 items-center justify-center"
                style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
              >
                <div className="h-10 w-0.5 rounded-full bg-foreground/18" />
              </motion.div>
              <SplitDropZone
                active={true}
                session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                style={singlePanePreviewPaneStyle}
              />
            </>
          )}

          {hasRightPanel && (
            <motion.div
              layout={shouldAnimateTopRowLayout}
              transition={shouldAnimateTopRowLayout
                ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
                : { duration: 0 }}
              className={`flex shrink-0 overflow-hidden ${showSinglePaneSplitPreview ? "pointer-events-none opacity-0" : ""}`}
              style={showSinglePaneSplitPreview ? { width: 0, minWidth: 0 } : undefined}
            >
              <RightPanel
                layout={{
                  isIsland,
                  isResizing,
                  rightPanelRef,
                  rightPanelWidth: settings.rightPanelWidth,
                  rightSplitRatio: settings.rightSplitRatio,
                  splitGap,
                  handleResizeStart,
                  handleRightSplitStart,
                }}
                content={{
                  hasTodos,
                  hasAgents,
                  activeTools,
                  activeTodos,
                  bgAgents,
                  expandEditToolCallsByDefault: settings.expandEditToolCallsByDefault,
                }}
              />
            </motion.div>
          )}

          {manager.activeSessionId && (
            <MainTopToolArea
              layout={{
                isIsland,
                shouldAnimateTopRowLayout,
                showSinglePaneSplitPreview,
                toolAreaWidth: mainToolAreaWidth,
                toolRelativeFractions: mainToolRelativeFractions,
                isOuterResizeActive: isMainToolAreaResizing,
                canAddMainTopColumn,
                onOuterResizeStart: mainToolAreaResize.handleResizeStart,
                topAreaRef: mainToolAreaRef,
                toolsColumnRef,
                topToolColumnRefs: mainTopToolColumnRefs,
                topPaneResize: mainToolPaneResize,
                activeToolColumnResizeId: mainToolColumnResize.activeResizeId,
                onToolColumnResizeStart: mainToolColumnResize.handleResizeStart,
              }}
              workspace={mainToolWorkspace}
              drag={{
                mainToolDrag,
                setMainToolDrag,
                mainDraggedIsland,
                mainToolLabel,
                onCommitDrop: commitMainToolDrop,
                onResetDrag: resetMainToolDrag,
              }}
              renderToolContent={renderMainWorkspaceToolContent}
            />
          )}

          {/* Tool picker — always visible */}
          {showToolPicker && (
            <motion.div
              layout={shouldAnimateTopRowLayout}
              transition={shouldAnimateTopRowLayout
                ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
                : { duration: 0 }}
              className={`${isIsland ? "ms-[var(--island-panel-gap)]" : "tool-picker-shell flat-divider-soft"} shrink-0 overflow-hidden ${
                showSinglePaneSplitPreview || isSpaceSwitching && !manager.activeSessionId
                  ? "pointer-events-none"
                  : ""
              }`}
              style={showSinglePaneSplitPreview ? { width: 0, minWidth: 0, marginInlineStart: 0 } : undefined}
            >
              <ToolPicker
                activeTools={mainPickerActiveTools}
                onToggle={(toolId) => {
                  if (toolId === "tasks" || toolId === "agents") {
                    handleToggleTool(toolId);
                    return;
                  }
                  togglePanelTool(mainToolWorkspace, toolId as PanelToolId, canFitToolAsNewColumn);
                }}
                availableContextual={availableContextual}
                toolOrder={settings.toolOrder}
                displayBottomTools={new Set<ToolId>(mainToolWorkspace.bottomToolIslands.map((island) => island.toolId))}
                onReorder={handleToolReorder}
                panelInteractionMode="workspace"
                onPanelToolDragStart={(event, toolId) => {
                  event.dataTransfer.setData("text/plain", toolId);
                  event.dataTransfer.effectAllowed = "move";
                  setMainToolDrag({
                    toolId,
                    sourceSessionId: null,
                    islandId: null,
                    targetArea: null,
                    targetIndex: null,
                    targetColumnId: null,
                  });
                }}
                onPanelToolDragEnd={resetMainToolDrag}
                projectPath={activeProjectPath}
                bottomTools={new Set<ToolId>(mainToolWorkspace.bottomToolIslands.map((island) => island.toolId))}
                onMoveToBottom={(toolId) => moveToolToBottom(mainToolWorkspace, toolId as PanelToolId)}
                onMoveToSide={(toolId) => moveToolToSide(mainToolWorkspace, toolId as PanelToolId, canFitToolAsNewColumn)}
                taskProgress={activeTodos.length > 0 ? {
                  completed: activeTodos.filter((t) => t.status === "completed").length,
                  total: activeTodos.length,
                } : undefined}
              />
            </motion.div>
          )}
          </>
          )}
        </div>{/* end top row */}

        {!isSplitActive && manager.activeSessionId && (
          <MainBottomToolDock
            layout={{
              isIsland,
              isResizeActive: isResizing,
              isBottomHeightResizing: isMainBottomHeightResizing,
              bottomRowRef: mainBottomRowRef,
              bottomPaneResize: mainBottomPaneResize,
              onBottomResizeStart: mainBottomHeightResize.handleResizeStart,
              onMoveBottomToolToTop: handleMoveMainBottomToolToTop,
            }}
            workspace={mainToolWorkspace}
            drag={{
              mainToolDrag,
              setMainToolDrag,
              mainDraggedIsland,
              mainToolLabel,
              onCommitDrop: commitMainToolDrop,
              onResetDrag: resetMainToolDrag,
            }}
            renderToolContent={renderMainWorkspaceToolContent}
          />
        )}
        </div>{/* end showSettings wrapper */}
      </div>
      {showCodexAuthDialog && (
        <CodexAuthDialog
          sessionId={manager.activeSessionId!}
          onComplete={() => manager.clearCodexAuthRequired()}
          onCancel={() => manager.clearCodexAuthRequired()}
        />
      )}
      {showAcpAuthDialog && (
        <ACPAuthDialog
          sessionId={manager.acpAuthSessionId!}
          agentId={manager.acpAuthAgentId}
          agentName={acpAuthAgentName}
          authMethods={manager.acpAuthMethods}
          onComplete={(result) => manager.completeAcpAuth(result)}
          onCancel={manager.cancelAcpAuth}
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
          glassSupported={glassSupported}
          permissionMode={settings.permissionMode}
          onPermissionModeChange={handlePermissionModeChange}
          onCreateProject={handleCreateProject}
          hasProjects={hasProjects}
          onComplete={handleWelcomeComplete}
        />
      )}
    </div>
    </AgentProvider>
    </ThemeProvider>
  );
}
