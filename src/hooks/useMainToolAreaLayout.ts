/**
 * Pure computation hook for the main workspace tool area layout.
 *
 * Extracts ~55 lines of width fraction math, clamping, and derived layout
 * values from AppLayout into a focused, testable hook.
 */

import { useCallback, useMemo } from "react";
import { normalizeRatios } from "@/hooks/useSettings";
import type { MainToolWorkspaceState } from "@/hooks/useMainToolWorkspace";
import type { ToolDragState, ToolIsland } from "@/types";
import type { PanelToolId, ToolId } from "@/types/tools";
import {
  DEFAULT_TOOL_PREFERRED_WIDTH,
  getMinChatWidth,
  MIN_TOOLS_PANEL_WIDTH,
  SPLIT_HANDLE_WIDTH,
  TOOL_PREFERRED_WIDTHS,
} from "@/lib/layout/constants";
import {
  projectMainToolWidthChange,
  resolveProjectedMainToolWidthChange,
  resolveMainToolAreaWidth,
} from "@/lib/workspace/main-tool-widths";
import { getRequiredToolIslandsWidth } from "@/lib/workspace/drag";
import { getChatPaneMinWidthPx } from "@/lib/layout/workspace-constraints";

export interface MainToolAreaLayoutInput {
  mainToolWorkspace: MainToolWorkspaceState;
  mainToolDrag: ToolDragState | null;
  mainDraggedIsland: ToolIsland | null;
  availableSplitWidth: number;
  hasActiveSession: boolean;
  isIsland: boolean;
  showToolPicker: boolean;
  hasRightPanel: boolean;
  pickerW: number;
  handleW: number;
  rightPanelWidth: number;
}

export interface MainToolAreaLayout {
  mainTopToolColumnCount: number;
  mainWorkspaceChatMinWidth: number;
  mainHasToolWorkspace: boolean;
  mainCombinedWorkspaceWidth: number;
  mainMaxToolAreaWidth: number;
  mainShowTopToolArea: boolean;
  mainToolAreaWidth: number;
  mainToolRelativeFractions: number[];
  maxMainTopToolColumns: number;
  canAddMainTopColumn: boolean;
  effectiveMainChatFraction: number;
  effectiveMainToolAreaFraction: number;
  mainMinChatFraction: number;
  canFitToolAsNewColumn: (toolId: ToolId) => boolean;
}

export function useMainToolAreaLayout(input: MainToolAreaLayoutInput): MainToolAreaLayout {
  const {
    mainToolWorkspace,
    mainToolDrag,
    mainDraggedIsland,
    availableSplitWidth,
    hasActiveSession,
    showToolPicker,
    hasRightPanel,
    pickerW,
    handleW,
    rightPanelWidth,
  } = input;

  const mainTopToolColumnCount = mainToolWorkspace.topRowItems.length;
  const mainWorkspaceChatMinWidth = hasActiveSession ? getChatPaneMinWidthPx("single") : getMinChatWidth(input.isIsland);
  const draggedTopColumnIslandCount = useMemo(() => {
    if (!mainDraggedIsland || mainDraggedIsland.dock !== "top") return 0;
    for (const item of mainToolWorkspace.topRowItems) {
      if (item.islands.some((island) => island.id === mainDraggedIsland.id)) {
        return item.islands.length;
      }
    }
    return 0;
  }, [mainDraggedIsland, mainToolWorkspace.topRowItems]);
  const draggedTopColumnId = useMemo(() => {
    if (!mainDraggedIsland || mainDraggedIsland.dock !== "top") return null;
    for (let index = 0; index < mainToolWorkspace.topRowItems.length; index++) {
      const item = mainToolWorkspace.topRowItems[index]!;
      if (item.islands.some((island) => island.id === mainDraggedIsland.id)) {
        return item.column.id;
      }
    }
    return null;
  }, [mainDraggedIsland, mainToolWorkspace.topRowItems]);
  const draggedTopColumnIndex = useMemo(() => {
    if (!mainDraggedIsland || mainDraggedIsland.dock !== "top") return null;
    for (let index = 0; index < mainToolWorkspace.topRowItems.length; index++) {
      const item = mainToolWorkspace.topRowItems[index]!;
      if (item.islands.some((island) => island.id === mainDraggedIsland.id)) {
        return index;
      }
    }
    return null;
  }, [mainDraggedIsland, mainToolWorkspace.topRowItems]);

  const mainHasToolWorkspace =
    mainTopToolColumnCount > 0 ||
    mainToolWorkspace.bottomToolIslands.length > 0 ||
    !!mainToolDrag;

  const mainWorkspaceReservedWidth =
    (showToolPicker ? pickerW : 0) +
    (hasRightPanel ? rightPanelWidth + handleW : 0) +
    (mainHasToolWorkspace ? handleW : 0);

  const mainCombinedWorkspaceWidth = Math.max(0, availableSplitWidth - mainWorkspaceReservedWidth);

  const mainMaxToolAreaWidth = Math.max(0, mainCombinedWorkspaceWidth - mainWorkspaceChatMinWidth);

  const mainShowTopToolArea =
    mainTopToolColumnCount > 0 ||
    mainToolDrag?.targetArea === "top" ||
    mainToolDrag?.targetArea === "top-stack";

  const topInsertCreatesColumn = !!mainToolDrag && (
    !mainDraggedIsland
    || mainDraggedIsland.dock !== "top"
    || draggedTopColumnIslandCount > 1
  );
  const dragCreatesTopColumn = mainToolDrag?.targetArea === "top" && (
    topInsertCreatesColumn
  );
  const dragMovesTopColumn = mainToolDrag?.targetArea === "top"
    && !!mainDraggedIsland
    && mainDraggedIsland.dock === "top"
    && draggedTopColumnIslandCount === 1
    && draggedTopColumnIndex != null;
  const dragRemovesTopColumn = !!mainDraggedIsland
    && mainDraggedIsland.dock === "top"
    && draggedTopColumnIslandCount === 1
    && (
      (mainToolDrag?.targetArea === "top-stack"
        && !!mainToolDrag.targetColumnId
        && mainToolDrag.targetColumnId !== draggedTopColumnId)
      || mainToolDrag?.targetArea === "bottom"
    );

  const mainTopPreviewColumnCount =
    mainTopToolColumnCount +
    (dragCreatesTopColumn ? 1 : 0) -
    (dragRemovesTopColumn ? 1 : 0);

  const mainRequiredToolWidth = mainShowTopToolArea
    ? getRequiredToolIslandsWidth(Math.max(mainTopPreviewColumnCount, 1))
    : 0;

  const resolvedMainToolArea = resolveMainToolAreaWidth({
    preferredTopAreaWidthPx: mainToolWorkspace.preferredTopAreaWidthPx,
    widthFractions: mainToolWorkspace.widthFractions,
    workspaceWidth: mainCombinedWorkspaceWidth,
    minChatWidth: mainWorkspaceChatMinWidth,
    requiredToolWidth: mainShowTopToolArea ? mainRequiredToolWidth : 0,
    showToolArea: mainShowTopToolArea,
  });
  const addColumnProjection = useMemo(() => {
    if (!mainToolDrag || !topInsertCreatesColumn || mainCombinedWorkspaceWidth <= 0) {
      return null;
    }

    const rememberedWidthFraction = mainToolDrag.toolId in TOOL_PREFERRED_WIDTHS
      ? mainToolWorkspace.getRememberedWidthFraction(mainToolDrag.toolId as PanelToolId)
      : null;
    const projection = projectMainToolWidthChange({
      preferredTopAreaWidthPx: mainToolWorkspace.preferredTopAreaWidthPx,
      widthFractions: mainToolWorkspace.widthFractions,
      workspaceWidth: mainCombinedWorkspaceWidth,
      minChatWidth: mainWorkspaceChatMinWidth,
      change: {
        kind: "column-added",
        prevItemCount: mainTopToolColumnCount,
        nextItemCount: mainTopToolColumnCount + 1,
        changeIndex: 0,
        toolHint: {
          toolId: mainToolDrag.toolId,
          lastWidthFraction: rememberedWidthFraction ?? undefined,
        },
      },
    });

    return resolveProjectedMainToolWidthChange({
      projection,
      workspaceWidth: mainCombinedWorkspaceWidth,
      minChatWidth: mainWorkspaceChatMinWidth,
      nextToolColumnCount: mainTopToolColumnCount + 1,
    });
  }, [
    topInsertCreatesColumn,
    mainCombinedWorkspaceWidth,
    mainToolDrag,
    mainToolWorkspace.getRememberedWidthFraction,
    mainToolWorkspace.preferredTopAreaWidthPx,
    mainToolWorkspace.widthFractions,
    mainTopToolColumnCount,
    mainWorkspaceChatMinWidth,
  ]);
  const previewInsertIndex = Math.max(0, Math.min(mainToolDrag?.targetIndex ?? mainTopToolColumnCount, mainTopToolColumnCount));
  const previewProjection = useMemo(() => {
    if (mainCombinedWorkspaceWidth <= 0) {
      return null;
    }

    if (dragCreatesTopColumn && mainToolDrag?.targetArea === "top") {
      const rememberedWidthFraction = mainToolDrag.toolId in TOOL_PREFERRED_WIDTHS
        ? mainToolWorkspace.getRememberedWidthFraction(mainToolDrag.toolId as PanelToolId)
        : null;
      const projection = projectMainToolWidthChange({
        preferredTopAreaWidthPx: mainToolWorkspace.preferredTopAreaWidthPx,
        widthFractions: mainToolWorkspace.widthFractions,
        workspaceWidth: mainCombinedWorkspaceWidth,
        minChatWidth: mainWorkspaceChatMinWidth,
        change: {
          kind: "column-added",
          prevItemCount: mainTopToolColumnCount,
          nextItemCount: mainTopToolColumnCount + 1,
          changeIndex: previewInsertIndex,
          toolHint: {
            toolId: mainToolDrag.toolId,
            lastWidthFraction: rememberedWidthFraction ?? undefined,
          },
        },
      });
      return resolveProjectedMainToolWidthChange({
        projection,
        workspaceWidth: mainCombinedWorkspaceWidth,
        minChatWidth: mainWorkspaceChatMinWidth,
        nextToolColumnCount: mainTopToolColumnCount + 1,
      });
    }

    if (dragMovesTopColumn && draggedTopColumnIndex != null) {
      const projection = projectMainToolWidthChange({
        preferredTopAreaWidthPx: mainToolWorkspace.preferredTopAreaWidthPx,
        widthFractions: mainToolWorkspace.widthFractions,
        workspaceWidth: mainCombinedWorkspaceWidth,
        minChatWidth: mainWorkspaceChatMinWidth,
        change: {
          kind: "column-moved",
          prevItemCount: mainTopToolColumnCount,
          nextItemCount: mainTopToolColumnCount,
          changeIndex: previewInsertIndex,
          fromIndex: draggedTopColumnIndex,
        },
      });
      return resolveProjectedMainToolWidthChange({
        projection,
        workspaceWidth: mainCombinedWorkspaceWidth,
        minChatWidth: mainWorkspaceChatMinWidth,
        nextToolColumnCount: mainTopToolColumnCount,
      });
    }

    if (dragRemovesTopColumn) {
      const projection = projectMainToolWidthChange({
        preferredTopAreaWidthPx: mainToolWorkspace.preferredTopAreaWidthPx,
        widthFractions: mainToolWorkspace.widthFractions,
        workspaceWidth: mainCombinedWorkspaceWidth,
        minChatWidth: mainWorkspaceChatMinWidth,
        change: {
          kind: "column-removed",
          prevItemCount: mainTopToolColumnCount,
          nextItemCount: Math.max(0, mainTopToolColumnCount - 1),
          changeIndex: draggedTopColumnIndex ?? 0,
        },
      });
      return resolveProjectedMainToolWidthChange({
        projection,
        workspaceWidth: mainCombinedWorkspaceWidth,
        minChatWidth: mainWorkspaceChatMinWidth,
        nextToolColumnCount: Math.max(0, mainTopToolColumnCount - 1),
      });
    }

    return null;
  }, [
    dragRemovesTopColumn,
    dragCreatesTopColumn,
    dragMovesTopColumn,
    draggedTopColumnId,
    draggedTopColumnIndex,
    mainCombinedWorkspaceWidth,
    mainToolDrag?.targetArea,
    mainToolDrag?.targetColumnId,
    mainToolDrag?.toolId,
    mainToolWorkspace.getRememberedWidthFraction,
    mainToolWorkspace.preferredTopAreaWidthPx,
    mainToolWorkspace.widthFractions,
    mainTopToolColumnCount,
    mainWorkspaceChatMinWidth,
    previewInsertIndex,
  ]);
  const effectiveMainToolAreaWidth = previewProjection?.toolAreaWidth ?? resolvedMainToolArea.toolAreaWidth;

  const mainToolRelativeFractions = useMemo(
    () =>
      previewProjection
        ? previewProjection.toolRelativeFractions
        : mainTopToolColumnCount > 0
          ? normalizeRatios(mainToolWorkspace.widthFractions.slice(1), mainTopToolColumnCount)
        : [],
    [mainToolWorkspace.widthFractions, mainTopToolColumnCount, previewProjection],
  );

  const maxMainTopToolColumns = Math.max(
    1,
    Math.floor(
      (mainMaxToolAreaWidth + SPLIT_HANDLE_WIDTH) / (MIN_TOOLS_PANEL_WIDTH + SPLIT_HANDLE_WIDTH),
    ),
  );

  const canAddMainTopColumn = topInsertCreatesColumn
    ? addColumnProjection != null
    : mainTopToolColumnCount <= maxMainTopToolColumns;

  /** Check if a specific tool can fit as a new column at its preferred width. */
  const canFitToolAsNewColumn = useCallback(
    (toolId: ToolId): boolean => {
      const preferredPx = TOOL_PREFERRED_WIDTHS[toolId] ?? DEFAULT_TOOL_PREFERRED_WIDTH;
      const handleCost = mainTopToolColumnCount > 0 ? SPLIT_HANDLE_WIDTH : 0;
      const totalNeeded = effectiveMainToolAreaWidth + handleCost + preferredPx;
      return mainCombinedWorkspaceWidth - totalNeeded >= mainWorkspaceChatMinWidth;
    },
    [effectiveMainToolAreaWidth, mainTopToolColumnCount, mainCombinedWorkspaceWidth, mainWorkspaceChatMinWidth],
  );

  return {
    mainTopToolColumnCount,
    mainWorkspaceChatMinWidth,
    mainHasToolWorkspace,
    mainCombinedWorkspaceWidth,
    mainMaxToolAreaWidth,
    mainShowTopToolArea,
    mainToolAreaWidth: effectiveMainToolAreaWidth,
    mainToolRelativeFractions,
    maxMainTopToolColumns,
    canAddMainTopColumn,
    effectiveMainChatFraction: previewProjection?.chatFraction ?? resolvedMainToolArea.chatFraction,
    effectiveMainToolAreaFraction: previewProjection?.toolAreaFraction ?? resolvedMainToolArea.toolAreaFraction,
    mainMinChatFraction: resolvedMainToolArea.minChatFraction,
    canFitToolAsNewColumn,
  };
}
