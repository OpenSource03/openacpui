export const MIN_CHAT_WIDTH_ISLAND = 828;
export const MIN_CHAT_WIDTH_FLAT = 828;
export const BOTTOM_CHAT_MAX_WIDTH_CLASS = "max-w-[61.5rem]";
export const CHAT_INPUT_MAX_WIDTH_CLASS = BOTTOM_CHAT_MAX_WIDTH_CLASS;
export const APP_SIDEBAR_WIDTH = 280;
export const ISLAND_GAP = 6;
export const ISLAND_SHELL_GAP = ISLAND_GAP;
export const ISLAND_PANEL_GAP = 4;
export const ISLAND_LAYOUT_MARGIN = ISLAND_GAP * 2;
export const ISLAND_RADIUS = 12;
export const ISLAND_CONTROL_RADIUS = 11;
export const WINDOWS_FRAME_BUFFER_WIDTH = 16;

export const MIN_RIGHT_PANEL_WIDTH = 200;
export const MIN_TOOLS_PANEL_WIDTH = 280;

export const MIN_BOTTOM_TOOLS_HEIGHT = 120;
export const MAX_BOTTOM_TOOLS_HEIGHT = 600;
export const DEFAULT_BOTTOM_TOOLS_HEIGHT = 250;

// Includes the picker strip itself plus the gap that separates it from the tools column.
export const TOOL_PICKER_WIDTH_ISLAND = 58;
export const TOOL_PICKER_WIDTH_FLAT = 56;

export const RESIZE_HANDLE_WIDTH_ISLAND = ISLAND_PANEL_GAP;
export const RESIZE_HANDLE_WIDTH_FLAT = 1;

export function getMinChatWidth(isIsland: boolean): number {
  return isIsland ? MIN_CHAT_WIDTH_ISLAND : MIN_CHAT_WIDTH_FLAT;
}

export function getToolPickerWidth(isIsland: boolean): number {
  return isIsland ? TOOL_PICKER_WIDTH_ISLAND : TOOL_PICKER_WIDTH_FLAT;
}

export function getResizeHandleWidth(isIsland: boolean): number {
  return isIsland ? RESIZE_HANDLE_WIDTH_ISLAND : RESIZE_HANDLE_WIDTH_FLAT;
}

export function getBootstrapMinWindowWidth(platform: string): number {
  const width =
    APP_SIDEBAR_WIDTH +
    ISLAND_LAYOUT_MARGIN +
    MIN_CHAT_WIDTH_ISLAND +
    TOOL_PICKER_WIDTH_ISLAND +
    MIN_RIGHT_PANEL_WIDTH +
    RESIZE_HANDLE_WIDTH_ISLAND +
    MIN_TOOLS_PANEL_WIDTH +
    RESIZE_HANDLE_WIDTH_ISLAND;

  return platform === "win32" ? width + WINDOWS_FRAME_BUFFER_WIDTH : width;
}
