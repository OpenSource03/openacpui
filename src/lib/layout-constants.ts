export const MIN_CHAT_WIDTH_ISLAND = 768;
export const MIN_CHAT_WIDTH_FLAT = 828;

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