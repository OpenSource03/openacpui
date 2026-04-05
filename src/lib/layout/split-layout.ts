import {
  APP_SIDEBAR_WIDTH,
  ISLAND_LAYOUT_MARGIN,
  MIN_CHAT_WIDTH_SPLIT,
  MIN_RIGHT_PANEL_WIDTH,
  MIN_TOOLS_PANEL_WIDTH,
  SPLIT_HANDLE_WIDTH,
  WINDOWS_FRAME_BUFFER_WIDTH,
  getMinChatWidth,
  getResizeHandleWidth,
  getToolPickerWidth,
} from "@/lib/layout/constants";

export type SplitAddRejectionReason =
  | "missing-session"
  | "active-session"
  | "duplicate-session"
  | "insufficient-width";

export interface SplitAddGuardInput {
  sessionId: string | null | undefined;
  activeSessionId: string | null;
  visibleSessionIds: readonly string[];
  maxPaneCount: number;
}

export interface AppMinimumWidthInput {
  sidebarOpen: boolean;
  isIslandLayout: boolean;
  hasActiveSession: boolean;
  hasRightPanel: boolean;
  hasToolsColumn: boolean;
  isSplitViewEnabled: boolean;
  splitPaneCount: number;
  isWindows: boolean;
}

export function getRequiredSplitContentWidth(paneCount: number): number {
  if (paneCount <= 1) {
    return MIN_CHAT_WIDTH_SPLIT;
  }

  return (MIN_CHAT_WIDTH_SPLIT * paneCount) + (SPLIT_HANDLE_WIDTH * (paneCount - 1));
}

export function getMaxVisibleSplitPaneCount(availableWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return 1;
  }

  const paneWidthWithHandle = MIN_CHAT_WIDTH_SPLIT + SPLIT_HANDLE_WIDTH;
  return Math.max(1, Math.floor((availableWidth + SPLIT_HANDLE_WIDTH) / paneWidthWithHandle));
}

export function getSplitAddRejectionReason({
  sessionId,
  activeSessionId,
  visibleSessionIds,
  maxPaneCount,
}: SplitAddGuardInput): SplitAddRejectionReason | null {
  const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalizedSessionId) {
    return "missing-session";
  }

  if (normalizedSessionId === activeSessionId) {
    return "active-session";
  }

  if (visibleSessionIds.includes(normalizedSessionId)) {
    return "duplicate-session";
  }

  if (visibleSessionIds.length >= maxPaneCount) {
    return "insufficient-width";
  }

  return null;
}

export function getAppMinimumWidth({
  sidebarOpen,
  isIslandLayout,
  hasActiveSession,
  hasRightPanel,
  hasToolsColumn,
  isSplitViewEnabled,
  splitPaneCount,
  isWindows,
}: AppMinimumWidthInput): number {
  const sidebarWidth = sidebarOpen ? APP_SIDEBAR_WIDTH : 0;
  const outerMarginWidth = isIslandLayout ? ISLAND_LAYOUT_MARGIN : 0;
  const windowsFrameWidth = isWindows ? WINDOWS_FRAME_BUFFER_WIDTH : 0;

  if (isSplitViewEnabled && splitPaneCount > 1) {
    return sidebarWidth
      + outerMarginWidth
      + getRequiredSplitContentWidth(splitPaneCount)
      + windowsFrameWidth;
  }

  let minimumWidth = sidebarWidth + outerMarginWidth + getMinChatWidth(isIslandLayout) + windowsFrameWidth;
  if (!hasActiveSession) {
    return minimumWidth;
  }

  minimumWidth += getToolPickerWidth(isIslandLayout);
  if (hasRightPanel) {
    minimumWidth += MIN_RIGHT_PANEL_WIDTH + getResizeHandleWidth(isIslandLayout);
  }
  if (hasToolsColumn) {
    minimumWidth += MIN_TOOLS_PANEL_WIDTH + getResizeHandleWidth(isIslandLayout);
  }
  return minimumWidth;
}
