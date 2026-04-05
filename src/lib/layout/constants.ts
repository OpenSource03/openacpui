export const CHAT_CONTENT_RESIZED_EVENT = "harnss:chat-content-resized";

export const MIN_CHAT_WIDTH_ISLAND = 704;
export const MIN_CHAT_WIDTH_FLAT = 704;
export const BOTTOM_CHAT_MAX_WIDTH_CLASS = "max-w-[52.5rem]";
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

/** Per-tool preferred pixel widths — used as default when a tool has no remembered width. */
export const TOOL_PREFERRED_WIDTHS: Record<string, number> = {
  terminal: 480,
  browser: 560,
  git: 360,
  files: 320,
  "project-files": 320,
  mcp: 380,
};

/** Fallback preferred width for tools not in the map. */
export const DEFAULT_TOOL_PREFERRED_WIDTH = 380;

export const MIN_BOTTOM_TOOLS_HEIGHT = 120;
export const MAX_BOTTOM_TOOLS_HEIGHT = 600;
export const DEFAULT_BOTTOM_TOOLS_HEIGHT = 250;

// Includes the picker strip itself plus the gap that separates it from the tools column.
export const TOOL_PICKER_WIDTH_ISLAND = 48;
export const TOOL_PICKER_WIDTH_FLAT = 44;

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

// ── Split view constants ──

/** Maximum number of panes (including the primary pane). */
export const MAX_SPLIT_PANES = 4;

/** Maximum number of extra panes (beyond the primary). */
export const MAX_EXTRA_PANES = MAX_SPLIT_PANES - 1;

/** Minimum chat pane width in split mode. */
export const MIN_CHAT_WIDTH_SPLIT = 458;

/** Split handle width between panes. */
export const SPLIT_HANDLE_WIDTH = ISLAND_PANEL_GAP;

/** Minimum width fraction for any single pane. */
export const MIN_PANE_WIDTH_FRACTION = 0.15;

/** Minimum split ratio (prevents either pane from becoming too narrow). */
export const MIN_SPLIT_RATIO = 0.3;

/** Maximum split ratio. */
export const MAX_SPLIT_RATIO = 0.7;

/** Default split ratio (50/50). */
export const DEFAULT_SPLIT_RATIO = 0.5;

/** Minimum height for per-pane tool drawer. */
export const MIN_PANE_DRAWER_HEIGHT = 120;

/** Maximum height for per-pane tool drawer. */
export const MAX_PANE_DRAWER_HEIGHT = 400;

/** Default height for per-pane tool drawer. */
export const DEFAULT_PANE_DRAWER_HEIGHT = 200;

/** Width of the animated drop zone when dragging a session into split view. */
export const SPLIT_DROP_ZONE_WIDTH = 200;

/** Minimum window width for split view (sidebar + margin + N panes + handles). */
export function getMinSplitViewWindowWidth(platform: string, paneCount = 2): number {
  const handles = Math.max(0, paneCount - 1) * SPLIT_HANDLE_WIDTH;
  const splitPaneMinWidth = 458;
  const width =
    APP_SIDEBAR_WIDTH +
    ISLAND_LAYOUT_MARGIN +
    splitPaneMinWidth * paneCount +
    handles;

  return platform === "win32" ? width + WINDOWS_FRAME_BUFFER_WIDTH : width;
}

/** Calculate equal width fractions for N panes. */
export function equalWidthFractions(count: number): number[] {
  if (count <= 0) return [1];
  const fraction = 1 / count;
  return Array.from({ length: count }, () => fraction);
}

/** Clamp width fractions so no pane is below MIN_PANE_WIDTH_FRACTION. */
export function clampWidthFractions(fractions: number[]): number[] {
  if (fractions.length <= 1) return [1];
  const clamped = fractions.map(f => Math.max(MIN_PANE_WIDTH_FRACTION, f));
  const sum = clamped.reduce((a, b) => a + b, 0);
  return clamped.map(f => f / sum); // normalize to sum=1
}
