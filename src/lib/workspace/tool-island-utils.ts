/**
 * Shared utility functions for tool island state management.
 *
 * These are the pure data-transformation helpers used by both
 * `useMainToolWorkspace` and `useSplitView`. Extracted here to
 * eliminate the copy-paste duplication between the two hooks.
 */

import { equalWidthFractions } from "@/lib/layout/constants";
import type { ToolId, PanelToolId } from "@/types/tools";
import type { ToolColumn, ToolIslandMemory, TopColumnLocation } from "@/types";

// ── Panel tool runtime values ──

/** The set of tool IDs that render as panels in the tools column. */
export const PANEL_TOOL_IDS = new Set<PanelToolId>([
  "terminal", "browser", "git", "files", "project-files", "mcp",
]);

/** Type guard: is this ToolId one of the panel tools? */
export function isPanelTool(toolId: ToolId): toolId is PanelToolId {
  return PANEL_TOOL_IDS.has(toolId as PanelToolId);
}

/** Tool IDs that render in the tools column (not contextual right-panel tools). */
export const COLUMN_TOOL_IDS = new Set<ToolId>(PANEL_TOOL_IDS);

// ── Item ID helpers ──

export function makeChatItemId(sessionId: string): string {
  return `chat:${sessionId}`;
}

export function makeToolColumnItemId(columnId: string): string {
  return `tool-column:${columnId}`;
}

export function stripChatItemId(itemId: string): string {
  return itemId.startsWith("chat:") ? itemId.slice(5) : itemId;
}

export function stripToolColumnItemId(itemId: string): string {
  return itemId.startsWith("tool-column:") ? itemId.slice(12) : itemId;
}

// ── Index helpers ──

/** Clamp an optional insert position to the valid range [0, length]. */
export function normalizeInsertIndex(position: number | undefined, length: number): number {
  if (position === undefined) return length;
  return Math.max(0, Math.min(position, length));
}

/**
 * Find the index of `islandId` in the bottom tool island array.
 * Returns `null` if the island is not in the bottom row.
 */
export function findBottomToolIndex(itemIds: string[], islandId: string): number | null {
  const index = itemIds.indexOf(islandId);
  return index >= 0 ? index : null;
}

/**
 * Find the position of an island within the top-row tool columns.
 * Returns column ID, top-row index, stack index, and column island count.
 */
export function findTopColumnLocation(
  topRowItemIds: string[],
  topToolColumnsById: Record<string, ToolColumn>,
  islandId: string,
): TopColumnLocation | null {
  for (let topRowIndex = 0; topRowIndex < topRowItemIds.length; topRowIndex++) {
    const itemId = topRowItemIds[topRowIndex]!;
    if (!itemId.startsWith("tool-column:")) continue;
    const columnId = stripToolColumnItemId(itemId);
    const column = topToolColumnsById[columnId];
    if (!column) continue;
    const stackIndex = column.islandIds.indexOf(islandId);
    if (stackIndex >= 0) {
      return { columnId, topRowIndex, stackIndex, islandCount: column.islandIds.length };
    }
  }
  return null;
}

/**
 * Remove an island from the top-row columns.
 * If the column becomes empty, it is deleted and its top-row entry removed.
 * Otherwise the column's split ratios are reset to equal widths.
 */
export function removeIslandFromTopColumns(
  topRowItemIds: string[],
  topToolColumnsById: Record<string, ToolColumn>,
  islandId: string,
): {
  nextTopRowItemIds: string[];
  nextTopToolColumnsById: Record<string, ToolColumn>;
  location: TopColumnLocation | null;
} {
  const location = findTopColumnLocation(topRowItemIds, topToolColumnsById, islandId);
  if (!location) {
    return {
      nextTopRowItemIds: topRowItemIds,
      nextTopToolColumnsById: topToolColumnsById,
      location: null,
    };
  }

  const nextTopRowItemIds = [...topRowItemIds];
  const nextTopToolColumnsById = { ...topToolColumnsById };
  const column = nextTopToolColumnsById[location.columnId]!;
  const nextIslandIds = column.islandIds.filter((entry) => entry !== islandId);

  if (nextIslandIds.length === 0) {
    delete nextTopToolColumnsById[location.columnId];
    nextTopRowItemIds.splice(location.topRowIndex, 1);
  } else {
    nextTopToolColumnsById[location.columnId] = {
      ...column,
      islandIds: nextIslandIds,
      splitRatios: equalWidthFractions(nextIslandIds.length),
    };
  }

  return { nextTopRowItemIds, nextTopToolColumnsById, location };
}

// ── Split-view specific helpers ──

/**
 * Find the top-row insert position immediately after the source session's chat item.
 * Used in split view where chat items and tool columns are interleaved.
 */
export function findTopInsertIndexAfterSource(itemIds: string[], sourceSessionId: string): number {
  const chatIndex = itemIds.indexOf(makeChatItemId(sourceSessionId));
  return chatIndex >= 0 ? chatIndex + 1 : itemIds.length;
}

/**
 * Build a memory key for a given session + tool combination.
 * In split view: `"sessionId:toolId"`. Single-chat mode uses just the toolId.
 */
export function makeToolMemoryKey(sourceSessionId: string, toolId: string): string {
  return `${sourceSessionId}:${toolId}`;
}

/**
 * Ensure a newly-created top-row column ID does not collide with a column that
 * already remains in the layout after the dragged island is removed.
 */
export function ensureUniqueColumnId(
  baseColumnId: string,
  existingColumnsById: Record<string, ToolColumn>,
  islandId: string,
): string {
  if (!existingColumnsById[baseColumnId]) {
    return baseColumnId;
  }

  const islandScopedId = `${baseColumnId}:${islandId}`;
  if (!existingColumnsById[islandScopedId]) {
    return islandScopedId;
  }

  let suffix = 2;
  let nextId = `${islandScopedId}:${suffix}`;
  while (existingColumnsById[nextId]) {
    suffix += 1;
    nextId = `${islandScopedId}:${suffix}`;
  }

  return nextId;
}

export function resolveRememberedTopStackPlacement(
  memory: ToolIslandMemory | null | undefined,
  topToolColumnsById: Record<string, ToolColumn>,
): { columnId: string; stackIndex: number } | null {
  const columnId = memory?.lastTopColumnId ?? null;
  if (!columnId) {
    return null;
  }

  const column = topToolColumnsById[columnId];
  if (!column) {
    return null;
  }

  return {
    columnId,
    stackIndex: normalizeInsertIndex(memory?.lastTopStackIndex ?? column.islandIds.length, column.islandIds.length),
  };
}
