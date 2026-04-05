/**
 * Core hook for tool island state management.
 *
 * Provides all CRUD operations for tool islands (open, close, move, stack)
 * with configurable behavior for width fractions, ID generation, and positioning.
 *
 * Used by both `useMainToolWorkspace` (single-chat mode, with persistence)
 * and `useSplitView` (split-chat mode, in-memory).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  MAX_BOTTOM_TOOLS_HEIGHT,
  MIN_BOTTOM_TOOLS_HEIGHT,
  clampWidthFractions,
  equalWidthFractions,
} from "@/lib/layout/constants";
import {
  findBottomToolIndex,
  findTopColumnLocation,
  isPanelTool,
  makeToolColumnItemId,
  normalizeInsertIndex,
  removeIslandFromTopColumns,
} from "@/lib/workspace/tool-island-utils";
import type {
  PanelToolId,
  ToolColumn,
  ToolIsland,
  ToolIslandDock,
  ToolIslandMemory,
  TopRowItem,
} from "@/types";

// ── State shape ──

export interface ToolIslandsState {
  topRowItemIds: string[];
  topToolColumnsById: Record<string, ToolColumn>;
  widthFractions: number[];
  preferredTopAreaWidthPx: number | null;
  toolIslandsById: Record<string, ToolIsland>;
  toolMemories: Record<string, ToolIslandMemory>;
  bottomToolIslandIds: string[];
  bottomHeight: number;
  bottomWidthFractions: number[];
}

export function emptyToolIslandsState(): ToolIslandsState {
  return {
    topRowItemIds: [],
    topToolColumnsById: {},
    widthFractions: [1],
    preferredTopAreaWidthPx: null,
    toolIslandsById: {},
    toolMemories: {},
    bottomToolIslandIds: [],
    bottomHeight: 250,
    bottomWidthFractions: [],
  };
}

// ── Top-row change descriptor (passed to width fraction callback) ──

export interface TopRowChange {
  kind: "column-added" | "column-removed" | "count-changed";
  prevFractions: number[];
  prevItemCount: number;
  nextItemCount: number;
  /** Top-row index of the added/removed column (only meaningful for add/remove). */
  changeIndex: number;
  /** Optional hint for the tool being added (only present for "column-added"). */
  toolHint?: { toolId: string; lastWidthFraction?: number };
}

// ── Config ──

export interface UseToolIslandsConfig {
  /** Compute new width fractions when the top row changes. */
  computeWidthFractions: (change: TopRowChange, current: ToolIslandsState) => number[];

  /** Generate a unique island ID for a tool+session combo. */
  makeIslandId: (toolId: PanelToolId, sourceSessionId: string, existingId: string | null) => string;

  /** Generate a persist key for a tool island's state. */
  makePersistKey: (toolId: PanelToolId, sourceSessionId: string, islandId: string) => string;

  /** Generate a memory key for a session+tool pair. */
  makeMemoryKey: (sourceSessionId: string, toolId: PanelToolId) => string;

  /** Generate a column ID when creating a new tool column. */
  makeColumnId: (toolId: PanelToolId, islandId: string, prevColumnId: string | null) => string;

  /** Find default top-row insert position when no position/memory is available. */
  findDefaultTopInsertIndex: (topRowItemIds: string[], sourceSessionId: string) => number;

  /** Find an existing island for a given session+tool combo. */
  findExistingIsland: (islands: Record<string, ToolIsland>, sourceSessionId: string, toolId: PanelToolId) => ToolIsland | null;

  /** Extract the width fraction for a tool column at the given top-row index. */
  getColumnWidthFraction?: (state: ToolIslandsState, topRowIndex: number) => number | undefined;

  /** Called synchronously after every state update (for persistence). */
  onStateChange?: (state: ToolIslandsState) => void;
}

// ── Return type ──

export interface UseToolIslandsReturn {
  // Derived state
  state: ToolIslandsState;
  topRowItems: TopRowItem[];
  bottomToolIslands: ToolIsland[];

  // Direct state mutation (for wrapper-level operations like session management)
  update: (updater: (current: ToolIslandsState) => ToolIslandsState) => void;
  resetState: (next: ToolIslandsState) => void;

  // Width fractions
  setWidthFractions: (fractions: number[]) => void;
  setWidthFractionsDirect: (fractions: number[]) => void;
  setPreferredTopAreaWidthPx: (width: number | null) => void;

  // Column split ratios
  setTopToolColumnSplitRatios: (columnId: string, ratios: number[]) => void;

  // Bottom dock
  setBottomHeight: (height: number) => void;
  setBottomWidthFractions: (fractions: number[]) => void;

  // Tool island CRUD
  openToolIsland: (sourceSessionId: string, toolId: PanelToolId, dock: ToolIslandDock, position?: number) => string | null;
  closeToolIsland: (islandId: string) => void;
  moveToolIsland: (islandId: string, dock: ToolIslandDock, position?: number) => void;
  openToolIslandInTopColumn: (sourceSessionId: string, toolId: PanelToolId, columnId: string, position?: number) => string | null;
  moveToolIslandToTopColumn: (islandId: string, columnId: string, position?: number) => void;

  // Getters
  getToolIslandForPane: (sourceSessionId: string, toolId: PanelToolId) => ToolIsland | null;
  getRememberedDock: (memoryKey: string) => ToolIslandDock | null;
}

// ── Hook implementation ──

export function useToolIslands(
  config: UseToolIslandsConfig,
  initialState: ToolIslandsState | (() => ToolIslandsState),
): UseToolIslandsReturn {
  const [state, setState] = useState<ToolIslandsState>(initialState);
  const configRef = useRef(config);
  configRef.current = config;

  // ── Internal updater (calls onStateChange synchronously) ──

  const update = useCallback((updater: (current: ToolIslandsState) => ToolIslandsState) => {
    setState((current) => {
      const next = updater(current);
      configRef.current.onStateChange?.(next);
      return next;
    });
  }, []);

  const resetState = useCallback((next: ToolIslandsState) => {
    setState(next);
    configRef.current.onStateChange?.(next);
  }, []);

  // ── Derived memos ──

  const topRowItems = useMemo<TopRowItem[]>(() => {
    const items: TopRowItem[] = [];
    for (const itemId of state.topRowItemIds) {
      if (itemId.startsWith("chat:")) {
        items.push({ kind: "chat", itemId, sessionId: itemId.slice(5) });
        continue;
      }
      if (itemId.startsWith("tool-column:")) {
        const columnId = itemId.slice(12);
        const column = state.topToolColumnsById[columnId];
        if (!column) continue;
        const islands = column.islandIds.flatMap((islandId) => {
          const island = state.toolIslandsById[islandId];
          return island ? [island] : [];
        });
        if (islands.length > 0) {
          items.push({ kind: "tool-column", itemId, column, islands });
        }
      }
    }
    return items;
  }, [state.topRowItemIds, state.topToolColumnsById, state.toolIslandsById]);

  const bottomToolIslands = useMemo(
    () => state.bottomToolIslandIds.flatMap((islandId) => {
      const island = state.toolIslandsById[islandId];
      return island ? [island] : [];
    }),
    [state.bottomToolIslandIds, state.toolIslandsById],
  );

  // ── Width fractions ──

  const setWidthFractions = useCallback((fractions: number[]) => {
    update((current) => ({ ...current, widthFractions: clampWidthFractions(fractions) }));
  }, [update]);

  const setWidthFractionsDirect = useCallback((fractions: number[]) => {
    update((current) => ({ ...current, widthFractions: fractions }));
  }, [update]);

  const setPreferredTopAreaWidthPx = useCallback((width: number | null) => {
    update((current) => ({
      ...current,
      preferredTopAreaWidthPx: width == null ? null : Math.max(0, width),
    }));
  }, [update]);

  // ── Column split ratios ──

  const setTopToolColumnSplitRatios = useCallback((columnId: string, ratios: number[]) => {
    update((current) => {
      const column = current.topToolColumnsById[columnId];
      if (!column) return current;
      const nextRatios = ratios.length === column.islandIds.length
        ? clampWidthFractions(ratios)
        : equalWidthFractions(column.islandIds.length);
      return {
        ...current,
        topToolColumnsById: {
          ...current.topToolColumnsById,
          [columnId]: { ...column, splitRatios: nextRatios },
        },
      };
    });
  }, [update]);

  // ── Bottom dock ──

  const setBottomHeight = useCallback((height: number) => {
    update((current) => ({
      ...current,
      bottomHeight: Math.max(MIN_BOTTOM_TOOLS_HEIGHT, Math.min(MAX_BOTTOM_TOOLS_HEIGHT, height)),
    }));
  }, [update]);

  const setBottomWidthFractions = useCallback((fractions: number[]) => {
    update((current) => ({ ...current, bottomWidthFractions: clampWidthFractions(fractions) }));
  }, [update]);

  // ── Getters ──

  const getToolIslandForPane = useCallback(
    (sourceSessionId: string, toolId: PanelToolId): ToolIsland | null => {
      for (const island of Object.values(state.toolIslandsById)) {
        if (island.sourceSessionId === sourceSessionId && island.toolId === toolId) {
          return island;
        }
      }
      return null;
    },
    [state.toolIslandsById],
  );

  const getRememberedDock = useCallback(
    (memoryKey: string): ToolIslandDock | null => {
      return state.toolMemories[memoryKey]?.lastDock ?? null;
    },
    [state.toolMemories],
  );

  // ── Helper: compute next width fractions ──

  const computeNextFractions = (
    current: ToolIslandsState,
    prevItemCount: number,
    nextItemIds: string[],
    changeKind: "column-added" | "column-removed" | "count-changed",
    changeIndex: number,
    toolHint?: TopRowChange["toolHint"],
  ): number[] => {
    const nextItemCount = nextItemIds.length;
    if (changeKind === "count-changed" && nextItemCount === prevItemCount) {
      // No actual count change — preserve existing fractions
      return current.widthFractions;
    }
    return configRef.current.computeWidthFractions({
      kind: changeKind,
      prevFractions: current.widthFractions,
      prevItemCount,
      nextItemCount,
      changeIndex,
      toolHint,
    }, current);
  };

  // ── CRUD: openToolIsland ──

  const openToolIsland = useCallback(
    (sourceSessionId: string, toolId: PanelToolId, dock: ToolIslandDock, position?: number): string | null => {
      if (!isPanelTool(toolId)) return null;

      let openedIslandId: string | null = null;

      update((current) => {
        const cfg = configRef.current;
        const memoryKey = cfg.makeMemoryKey(sourceSessionId, toolId);
        const memory = current.toolMemories[memoryKey] ?? null;
        const existing = cfg.findExistingIsland(current.toolIslandsById, sourceSessionId, toolId);
        const islandId = cfg.makeIslandId(toolId, sourceSessionId, existing?.id ?? memory?.islandId ?? null);
        const persistKey = memory?.persistKey ?? cfg.makePersistKey(toolId, sourceSessionId, islandId);
        // Only use memory's lastDock when freshly opening a tool (no existing island).
        // When an existing island is being moved, always honor the explicitly-passed dock.
        const resolvedDock = position === undefined && !existing && memory ? memory.lastDock : dock;

        // Remove from current location
        const topRemoval = removeIslandFromTopColumns(current.topRowItemIds, current.topToolColumnsById, islandId);
        const nextBottomToolIslandIds = current.bottomToolIslandIds.filter((entry) => entry !== islandId);
        let nextTopRowItemIds = topRemoval.nextTopRowItemIds;
        const nextTopToolColumnsById = { ...topRemoval.nextTopToolColumnsById };
        let nextTopIndex = topRemoval.location?.topRowIndex ?? memory?.lastTopIndex ?? null;
        let nextBottomIndex = findBottomToolIndex(current.bottomToolIslandIds, islandId) ?? memory?.lastBottomIndex ?? null;

        // Compute intermediate top-row count (after removal, before re-insertion)
        const prevTopCount = topRemoval.nextTopRowItemIds.length;

        if (resolvedDock === "top") {
          const defaultInsert = cfg.findDefaultTopInsertIndex(nextTopRowItemIds, sourceSessionId);
          nextTopIndex = normalizeInsertIndex(position ?? memory?.lastTopIndex ?? defaultInsert, nextTopRowItemIds.length);

          // Reuse column if the island was alone in one, otherwise create new
          const columnId = cfg.makeColumnId(
            toolId,
            islandId,
            topRemoval.location?.islandCount === 1 ? topRemoval.location.columnId : null,
          );
          nextTopToolColumnsById[columnId] = { id: columnId, islandIds: [islandId], splitRatios: [1] };
          nextTopRowItemIds = [...nextTopRowItemIds];
          nextTopRowItemIds.splice(nextTopIndex, 0, makeToolColumnItemId(columnId));
        } else {
          nextBottomIndex = normalizeInsertIndex(
            position ?? memory?.lastBottomIndex ?? nextBottomToolIslandIds.length,
            nextBottomToolIslandIds.length,
          );
          nextBottomToolIslandIds.splice(nextBottomIndex, 0, islandId);
        }

        // Compute next width fractions
        const addedColumn = resolvedDock === "top" && nextTopRowItemIds.length > prevTopCount;
        const toolHint = addedColumn ? { toolId, lastWidthFraction: memory?.lastWidthFraction } : undefined;
        const nextWidthFractions = addedColumn
          ? computeNextFractions(current, prevTopCount, nextTopRowItemIds, "column-added", nextTopIndex ?? 0, toolHint)
          : computeNextFractions(current, prevTopCount, nextTopRowItemIds, "count-changed", 0);

        openedIslandId = islandId;
        return {
          ...current,
          topRowItemIds: nextTopRowItemIds,
          topToolColumnsById: nextTopToolColumnsById,
          widthFractions: nextWidthFractions,
          bottomToolIslandIds: nextBottomToolIslandIds,
          bottomWidthFractions: nextBottomToolIslandIds.length > 0
            ? equalWidthFractions(nextBottomToolIslandIds.length)
            : [],
          toolIslandsById: {
            ...current.toolIslandsById,
            [islandId]: { id: islandId, toolId, sourceSessionId, dock: resolvedDock, persistKey },
          },
          toolMemories: {
            ...current.toolMemories,
            [memoryKey]: {
              islandId, persistKey, lastDock: resolvedDock,
              lastTopIndex: nextTopIndex, lastBottomIndex: nextBottomIndex,
              lastWidthFraction: memory?.lastWidthFraction,
            },
          },
        };
      });

      return openedIslandId;
    },
    [update],
  );

  // ── CRUD: moveToolIsland ──

  const moveToolIsland = useCallback(
    (islandId: string, dock: ToolIslandDock, position?: number) => {
      const island = state.toolIslandsById[islandId];
      if (!island) return;
      openToolIsland(island.sourceSessionId, island.toolId as PanelToolId, dock, position);
    },
    [openToolIsland, state.toolIslandsById],
  );

  // ── CRUD: openToolIslandInTopColumn ──

  const openToolIslandInTopColumn = useCallback(
    (sourceSessionId: string, toolId: PanelToolId, columnId: string, position?: number): string | null => {
      if (!isPanelTool(toolId)) return null;

      let openedIslandId: string | null = null;

      update((current) => {
        const targetColumn = current.topToolColumnsById[columnId];
        if (!targetColumn) return current;

        const cfg = configRef.current;
        const memoryKey = cfg.makeMemoryKey(sourceSessionId, toolId);
        const memory = current.toolMemories[memoryKey] ?? null;
        const existing = cfg.findExistingIsland(current.toolIslandsById, sourceSessionId, toolId);
        const islandId = cfg.makeIslandId(toolId, sourceSessionId, existing?.id ?? memory?.islandId ?? null);
        const persistKey = memory?.persistKey ?? cfg.makePersistKey(toolId, sourceSessionId, islandId);

        // Remove from current location
        const topRemoval = removeIslandFromTopColumns(current.topRowItemIds, current.topToolColumnsById, islandId);
        const nextBottomToolIslandIds = current.bottomToolIslandIds.filter((entry) => entry !== islandId);
        const nextTopToolColumnsById = { ...topRemoval.nextTopToolColumnsById };
        const resolvedColumn = nextTopToolColumnsById[columnId];
        if (!resolvedColumn) return current;

        // Insert into the column's stack
        const insertIndex = normalizeInsertIndex(position, resolvedColumn.islandIds.length);
        const nextIslandIds = [...resolvedColumn.islandIds];
        nextIslandIds.splice(insertIndex, 0, islandId);
        nextTopToolColumnsById[columnId] = {
          ...resolvedColumn,
          islandIds: nextIslandIds,
          splitRatios: equalWidthFractions(nextIslandIds.length),
        };

        // Stacking within a column doesn't change the column count — preserve fractions
        const nextTopRowItemIds = topRemoval.nextTopRowItemIds;
        const prevTopCount = current.topRowItemIds.length;
        const nextWidthFractions = nextTopRowItemIds.length === prevTopCount
          ? current.widthFractions
          : computeNextFractions(current, prevTopCount, nextTopRowItemIds, "count-changed", 0);

        const targetTopIndex = nextTopRowItemIds.indexOf(makeToolColumnItemId(columnId));
        openedIslandId = islandId;

        return {
          ...current,
          topRowItemIds: nextTopRowItemIds,
          topToolColumnsById: nextTopToolColumnsById,
          widthFractions: nextWidthFractions,
          bottomToolIslandIds: nextBottomToolIslandIds,
          bottomWidthFractions: nextBottomToolIslandIds.length > 0
            ? equalWidthFractions(nextBottomToolIslandIds.length)
            : [],
          toolIslandsById: {
            ...current.toolIslandsById,
            [islandId]: { id: islandId, toolId, sourceSessionId, dock: "top", persistKey },
          },
          toolMemories: {
            ...current.toolMemories,
            [memoryKey]: {
              islandId,
              persistKey,
              lastDock: "top",
              lastTopIndex: targetTopIndex >= 0 ? targetTopIndex : (memory?.lastTopIndex ?? null),
              lastBottomIndex: findBottomToolIndex(current.bottomToolIslandIds, islandId) ?? memory?.lastBottomIndex ?? null,
              lastWidthFraction: memory?.lastWidthFraction,
            },
          },
        };
      });

      return openedIslandId;
    },
    [update],
  );

  // ── CRUD: moveToolIslandToTopColumn ──

  const moveToolIslandToTopColumn = useCallback(
    (islandId: string, columnId: string, position?: number) => {
      const island = state.toolIslandsById[islandId];
      if (!island) return;
      openToolIslandInTopColumn(island.sourceSessionId, island.toolId as PanelToolId, columnId, position);
    },
    [openToolIslandInTopColumn, state.toolIslandsById],
  );

  // ── CRUD: closeToolIsland ──

  const closeToolIsland = useCallback(
    (islandId: string) => {
      update((current) => {
        const island = current.toolIslandsById[islandId];
        if (!island) return current;

        const cfg = configRef.current;
        const memoryKey = cfg.makeMemoryKey(island.sourceSessionId, island.toolId as PanelToolId);
        const topLocation = findTopColumnLocation(current.topRowItemIds, current.topToolColumnsById, islandId);
        const bottomIndex = findBottomToolIndex(current.bottomToolIslandIds, islandId);

        // Remove from all locations
        const topRemoval = removeIslandFromTopColumns(current.topRowItemIds, current.topToolColumnsById, islandId);
        const nextBottomToolIslandIds = current.bottomToolIslandIds.filter((entry) => entry !== islandId);

        // Remove island record
        const nextToolIslandsById = { ...current.toolIslandsById };
        delete nextToolIslandsById[islandId];

        // Save the closing tool's width fraction before removal
        const closingFraction = topLocation
          ? cfg.getColumnWidthFraction?.(current, topLocation.topRowIndex)
          : undefined;

        // Compute width fractions
        const columnWasRemoved = topLocation && topRemoval.nextTopRowItemIds.length < current.topRowItemIds.length;
        const nextWidthFractions = columnWasRemoved
          ? computeNextFractions(current, current.topRowItemIds.length, topRemoval.nextTopRowItemIds, "column-removed", topLocation.topRowIndex)
          : computeNextFractions(current, current.topRowItemIds.length, topRemoval.nextTopRowItemIds, "count-changed", 0);

        return {
          ...current,
          topRowItemIds: topRemoval.nextTopRowItemIds,
          topToolColumnsById: topRemoval.nextTopToolColumnsById,
          widthFractions: nextWidthFractions,
          bottomToolIslandIds: nextBottomToolIslandIds,
          bottomWidthFractions: nextBottomToolIslandIds.length > 0
            ? equalWidthFractions(nextBottomToolIslandIds.length)
            : [],
          toolIslandsById: nextToolIslandsById,
          toolMemories: {
            ...current.toolMemories,
            [memoryKey]: {
              islandId,
              persistKey: current.toolMemories[memoryKey]?.persistKey ?? island.persistKey,
              lastDock: island.dock,
              lastTopIndex: topLocation?.topRowIndex ?? current.toolMemories[memoryKey]?.lastTopIndex ?? null,
              lastBottomIndex: bottomIndex ?? current.toolMemories[memoryKey]?.lastBottomIndex ?? null,
              lastWidthFraction: closingFraction ?? current.toolMemories[memoryKey]?.lastWidthFraction,
            },
          },
        };
      });
    },
    [update],
  );

  return {
    state,
    topRowItems,
    bottomToolIslands,
    update,
    resetState,
    setWidthFractions,
    setWidthFractionsDirect,
    setPreferredTopAreaWidthPx,
    setTopToolColumnSplitRatios,
    setBottomHeight,
    setBottomWidthFractions,
    openToolIsland,
    closeToolIsland,
    moveToolIsland,
    openToolIslandInTopColumn,
    moveToolIslandToTopColumn,
    getToolIslandForPane,
    getRememberedDock,
  };
}
