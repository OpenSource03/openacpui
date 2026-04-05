/**
 * Unified drag-and-drop state machine for tool islands.
 *
 * Replaces the duplicate `splitToolDrag` and `mainToolDrag` state + commit/reset
 * handlers in AppLayout. A single instance is used, dispatching drops to the
 * correct workspace (split view or main workspace) via the `commitDrop` callback.
 */

import { useCallback, useMemo, useState } from "react";
import { PANEL_TOOLS_MAP } from "@/components/ToolPicker";
import type { ToolId } from "@/types/tools";
import type { ToolDragState, ToolIsland, ToolIslandDock, TopRowItem } from "@/types";

export type { ToolDragState } from "@/types";

// ── Workspace interface that both splitView and mainToolWorkspace satisfy ──

export interface ToolDragDropWorkspace {
  topRowItems: TopRowItem[];
  bottomToolIslands: ToolIsland[];
  moveToolIsland: (islandId: string, dock: ToolIslandDock, position?: number) => void;
  moveToolIslandToTopColumn: (islandId: string, columnId: string, position?: number) => void;
  openToolIsland: (...args: unknown[]) => string | null;
  openToolIslandInTopColumn: (...args: unknown[]) => string | null;
  getToolIslandForPane?: (sessionId: string, toolId: ToolId) => ToolIsland | null;
}

export interface UseToolDragDropOptions {
  /**
   * Commit the drop to the active workspace.
   * Called with the final drag state when the user drops.
   */
  commitDrop: (drag: ToolDragState) => void;
}

export interface UseToolDragDropReturn {
  drag: ToolDragState | null;
  setDrag: React.Dispatch<React.SetStateAction<ToolDragState | null>>;
  commitDrop: () => void;
  resetDrag: () => void;
  dragLabel: string | null;
}

export function useToolDragDrop({ commitDrop: onCommitDrop }: UseToolDragDropOptions): UseToolDragDropReturn {
  const [drag, setDrag] = useState<ToolDragState | null>(null);

  const resetDrag = useCallback(() => setDrag(null), []);

  const commitDrop = useCallback(() => {
    if (!drag || drag.targetArea === null || drag.targetIndex === null) {
      setDrag(null);
      return;
    }
    onCommitDrop(drag);
    setDrag(null);
  }, [drag, onCommitDrop]);

  const dragLabel = useMemo(
    () => drag ? PANEL_TOOLS_MAP[drag.toolId]?.label ?? drag.toolId : null,
    [drag],
  );

  return { drag, setDrag, commitDrop, resetDrag, dragLabel };
}

/**
 * Find the currently dragged island in the workspace's top row or bottom dock.
 * If no islandId is set (new island from picker), tries to find via getToolIslandForPane.
 */
export function findDraggedIsland(
  drag: ToolDragState | null,
  topRowItems: TopRowItem[],
  bottomToolIslands: ToolIsland[],
  getToolIslandForPane?: (sessionId: string, toolId: ToolId) => ToolIsland | null,
): ToolIsland | null {
  if (!drag) return null;

  if (drag.islandId) {
    for (const item of topRowItems) {
      if (item.kind !== "tool-column") continue;
      const island = item.islands.find((entry) => entry.id === drag.islandId);
      if (island) return island;
    }
    return bottomToolIslands.find((island) => island.id === drag.islandId) ?? null;
  }

  if (drag.sourceSessionId && getToolIslandForPane) {
    return getToolIslandForPane(drag.sourceSessionId, drag.toolId);
  }

  return null;
}
