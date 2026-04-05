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
import type { ToolId } from "@/types/tools";
import {
  DEFAULT_TOOL_PREFERRED_WIDTH,
  MIN_CHAT_WIDTH_SPLIT,
  MIN_TOOLS_PANEL_WIDTH,
  SPLIT_HANDLE_WIDTH,
  TOOL_PREFERRED_WIDTHS,
} from "@/lib/layout/constants";
import { getMinChatWidth } from "@/lib/layout/constants";
import { resolveMainToolAreaWidth } from "@/lib/workspace/main-tool-widths";
import { getRequiredToolIslandsWidth } from "@/lib/workspace/drag";

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
    isIsland,
    showToolPicker,
    hasRightPanel,
    pickerW,
    handleW,
    rightPanelWidth,
  } = input;

  const minChatWidth = getMinChatWidth(isIsland);
  const mainTopToolColumnCount = mainToolWorkspace.topRowItems.length;

  // Use the reduced split min-width whenever there's an active session, since tool islands
  // can be added at any time. This avoids a layout jump when the first tool column
  // is opened or the last one is closed.
  const mainWorkspaceChatMinWidth = hasActiveSession ? MIN_CHAT_WIDTH_SPLIT : minChatWidth;

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

  const mainTopPreviewColumnCount =
    mainTopToolColumnCount +
    (mainToolDrag?.targetArea === "top" && mainDraggedIsland?.dock !== "top" ? 1 : 0);

  const mainRequiredToolWidth = mainShowTopToolArea
    ? getRequiredToolIslandsWidth(Math.max(mainTopPreviewColumnCount, 1))
    : 0;

  const {
    toolAreaWidth: mainToolAreaWidth,
    toolAreaFraction: effectiveMainToolAreaFraction,
    chatFraction: effectiveMainChatFraction,
    minChatFraction: mainMinChatFraction,
  } = resolveMainToolAreaWidth({
    preferredTopAreaWidthPx: mainToolWorkspace.preferredTopAreaWidthPx,
    widthFractions: mainToolWorkspace.widthFractions,
    workspaceWidth: mainCombinedWorkspaceWidth,
    minChatWidth: mainWorkspaceChatMinWidth,
    requiredToolWidth: mainShowTopToolArea ? mainRequiredToolWidth : 0,
    showToolArea: mainShowTopToolArea,
  });

  const mainToolRelativeFractions = useMemo(
    () =>
      mainTopToolColumnCount > 0
        ? normalizeRatios(mainToolWorkspace.widthFractions.slice(1), mainTopToolColumnCount)
        : [],
    [mainToolWorkspace.widthFractions, mainTopToolColumnCount],
  );

  const maxMainTopToolColumns = Math.max(
    1,
    Math.floor(
      (mainMaxToolAreaWidth + SPLIT_HANDLE_WIDTH) / (MIN_TOOLS_PANEL_WIDTH + SPLIT_HANDLE_WIDTH),
    ),
  );

  const isAddingMainTopColumn = !mainDraggedIsland || mainDraggedIsland.dock !== "top";
  const canAddMainTopColumn = isAddingMainTopColumn
    ? mainTopToolColumnCount < maxMainTopToolColumns
    : mainTopToolColumnCount <= maxMainTopToolColumns;

  /** Check if a specific tool can fit as a new column at its preferred width. */
  const canFitToolAsNewColumn = useCallback(
    (toolId: ToolId): boolean => {
      const preferredPx = TOOL_PREFERRED_WIDTHS[toolId] ?? DEFAULT_TOOL_PREFERRED_WIDTH;
      const handleCost = mainTopToolColumnCount > 0 ? SPLIT_HANDLE_WIDTH : 0;
      const totalNeeded = mainToolAreaWidth + handleCost + preferredPx;
      return mainCombinedWorkspaceWidth - totalNeeded >= mainWorkspaceChatMinWidth;
    },
    [mainToolAreaWidth, mainTopToolColumnCount, mainCombinedWorkspaceWidth, mainWorkspaceChatMinWidth],
  );

  return {
    mainTopToolColumnCount,
    mainWorkspaceChatMinWidth,
    mainHasToolWorkspace,
    mainCombinedWorkspaceWidth,
    mainMaxToolAreaWidth,
    mainShowTopToolArea,
    mainToolAreaWidth,
    mainToolRelativeFractions,
    maxMainTopToolColumns,
    canAddMainTopColumn,
    effectiveMainChatFraction,
    effectiveMainToolAreaFraction,
    mainMinChatFraction,
    canFitToolAsNewColumn,
  };
}
