import type { ToolId, PanelToolId } from "@/types/tools";

export type { PanelToolId } from "@/types/tools";

// ── Core island types ──

export type ToolIslandDock = "top" | "bottom";

export interface ToolIsland {
  id: string;
  toolId: PanelToolId;
  sourceSessionId: string;
  dock: ToolIslandDock;
  persistKey: string;
}

export interface ToolColumn {
  id: string;
  islandIds: string[];
  splitRatios: number[];
}

export type TopRowItem =
  | { kind: "chat"; itemId: string; sessionId: string }
  | { kind: "tool-column"; itemId: string; column: ToolColumn; islands: ToolIsland[] };

// ── Memory (remembers where a tool was last docked) ──

export interface ToolIslandMemory {
  islandId: string;
  persistKey: string;
  lastDock: ToolIslandDock;
  lastTopIndex: number | null;
  lastBottomIndex: number | null;
  /** Column id this tool last occupied while docked in the top row. */
  lastTopColumnId?: string | null;
  /** Stack index this tool last occupied inside its top-row column. */
  lastTopStackIndex?: number | null;
  /** Fraction this tool column occupied when it was last open in the top dock. */
  lastWidthFraction?: number;
}

// ── Drag state (shared by both split-view and single-chat) ──

export interface ToolDragState {
  toolId: ToolId;
  sourceSessionId: string | null;
  islandId: string | null;
  targetArea: "top" | "top-stack" | "bottom" | null;
  targetIndex: number | null;
  targetColumnId: string | null;
}

// ── Shared controller interfaces (used by workspace components) ──

export interface PaneResizeController {
  isResizing: boolean;
  handleSplitResizeStart: (handleIndex: number, event: React.MouseEvent) => void;
  handleSplitDoubleClick: () => void;
}

// ── Location result from findTopColumnLocation ──

export interface TopColumnLocation {
  columnId: string;
  topRowIndex: number;
  stackIndex: number;
  islandCount: number;
}
