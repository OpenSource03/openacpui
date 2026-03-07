export const MIN_CHAT_WIDTH_ISLAND = 828;
export const MIN_CHAT_WIDTH_FLAT = 828;
export const BOTTOM_CHAT_MAX_WIDTH_CLASS = "max-w-[61.5rem]";
export const CHAT_INPUT_MAX_WIDTH_CLASS = BOTTOM_CHAT_MAX_WIDTH_CLASS;
export const APP_SIDEBAR_WIDTH = 260;
export const ISLAND_LAYOUT_MARGIN = 16;
export const WINDOWS_FRAME_BUFFER_WIDTH = 16;

export const MIN_RIGHT_PANEL_WIDTH = 200;
export const MIN_TOOLS_PANEL_WIDTH = 280;

export const TOOL_PICKER_WIDTH_ISLAND = 64;
export const TOOL_PICKER_WIDTH_FLAT = 56;

export const RESIZE_HANDLE_WIDTH_ISLAND = 8;
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
