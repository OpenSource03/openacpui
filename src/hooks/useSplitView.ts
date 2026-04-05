/**
 * Split-view state management.
 *
 * Wraps `useToolIslands` with session pane management:
 * - Add/remove/replace split sessions
 * - Per-pane contextual tools (tasks, agents)
 * - Equal-width fraction strategy
 * - In-memory only (no persistence)
 */

import { useCallback, useState } from "react";
import type { ToolId } from "@/types/tools";
import {
  DEFAULT_BOTTOM_TOOLS_HEIGHT,
  equalWidthFractions,
} from "@/lib/layout/constants";
import {
  type SplitAddRejectionReason,
  getSplitAddRejectionReason,
} from "@/lib/layout/split-layout";
import { replaceVisibleSessionId } from "@/lib/layout/split-view-state";
import {
  findTopInsertIndexAfterSource,
  isPanelTool,
  makeChatItemId,
  makeToolMemoryKey,
  normalizeInsertIndex,
  stripToolColumnItemId,
} from "@/lib/workspace/tool-island-utils";
import type {
  ToolColumn,
  ToolIsland,
  ToolIslandDock,
  ToolIslandMemory,
  TopRowItem,
} from "@/types";
import {
  type UseToolIslandsConfig,
  emptyToolIslandsState,
  useToolIslands,
} from "./useToolIslands";

// ── Re-exports ──

export type { TopRowItem as SplitTopRowItem } from "@/types";

// ── Types ──

type ContextualToolId = Extract<ToolId, "tasks" | "agents">;

export interface SplitAddSessionResult {
  ok: boolean;
  reason: SplitAddRejectionReason | null;
}

interface SplitAddSessionInput {
  sessionId: string;
  activeSessionId: string | null;
  maxPaneCount: number;
  position?: number;
}

export interface SplitViewState {
  enabled: boolean;
  visibleSessionIds: string[];
  paneCount: number;
  focusedSessionId: string | null;
  widthFractions: number[];
  topRowItems: TopRowItem[];
  bottomToolIslands: ToolIsland[];
  bottomHeight: number;
  bottomWidthFractions: number[];
  setFocusedSession: (sessionId: string | null) => void;
  setWidthFractions: (fractions: number[]) => void;
  setTopToolColumnSplitRatios: (columnId: string, ratios: number[]) => void;
  setBottomHeight: (height: number) => void;
  setBottomWidthFractions: (fractions: number[]) => void;
  requestAddSplitSession: (input: SplitAddSessionInput) => SplitAddSessionResult;
  replaceSessionId: (previousSessionId: string, nextSessionId: string) => void;
  removeSplitSession: (sessionId: string) => void;
  dismissSplitView: () => void;
  openToolIsland: (sourceSessionId: string, toolId: ToolId, dock: ToolIslandDock, position?: number) => string | null;
  moveToolIsland: (islandId: string, dock: ToolIslandDock, position?: number) => void;
  openToolIslandInTopColumn: (sourceSessionId: string, toolId: ToolId, columnId: string, position?: number) => string | null;
  moveToolIslandToTopColumn: (islandId: string, columnId: string, position?: number) => void;
  closeToolIsland: (islandId: string) => void;
  getToolIslandForPane: (sessionId: string, toolId: ToolId) => ToolIsland | null;
  getPaneContextualTool: (sessionId: string) => ContextualToolId | null;
  togglePaneContextualTool: (sessionId: string, toolId: ContextualToolId) => void;
  pruneSplitSessions: (validSessionIds: ReadonlySet<string>) => { removedSessionIds: string[] };
  canShowSessionSplitAction: (sessionId: string | null | undefined, activeSessionId: string | null) => boolean;
}

// ── Config (split view uses equal-width fractions) ──

function moveSplitWidthFraction(widthFractions: number[], fromIndex: number, toIndex: number): number[] {
  if (widthFractions.length <= 1 || fromIndex === toIndex) {
    return widthFractions;
  }

  const safeFromIndex = Math.max(0, Math.min(fromIndex, widthFractions.length - 1));
  const safeToIndex = Math.max(0, Math.min(toIndex, widthFractions.length - 1));
  if (safeFromIndex === safeToIndex) {
    return widthFractions;
  }

  const next = [...widthFractions];
  const [moved] = next.splice(safeFromIndex, 1);
  if (moved == null) {
    return widthFractions;
  }
  next.splice(safeToIndex, 0, moved);
  return next;
}

const splitConfig: UseToolIslandsConfig = {
  computeTopRowLayout: (change, current) => ({
    widthFractions: change.kind === "column-moved"
      ? moveSplitWidthFraction(
        current.widthFractions,
        change.fromIndex ?? change.changeIndex,
        change.changeIndex,
      )
      : equalWidthFractions(change.nextItemCount),
  }),

  makeIslandId: (_toolId, _sessionId, existingId) => existingId ?? crypto.randomUUID(),

  makePersistKey: (toolId, sourceSessionId, islandId) =>
    `split-tool:${sourceSessionId}:${toolId}:${islandId}`,

  makeMemoryKey: (sourceSessionId, toolId) => makeToolMemoryKey(sourceSessionId, toolId),

  makeColumnId: (_toolId, islandId, prevColumnId) => prevColumnId ?? `tool-col:${islandId}`,

  findDefaultTopInsertIndex: (topRowItemIds, sourceSessionId) =>
    findTopInsertIndexAfterSource(topRowItemIds, sourceSessionId),

  findExistingIsland: (islands, sourceSessionId, toolId) =>
    Object.values(islands).find((island) => island.sourceSessionId === sourceSessionId && island.toolId === toolId) ?? null,
};

// ── Hook ──

export function useSplitView(): SplitViewState {
  // Session-level state (managed by this wrapper, not by useToolIslands)
  const [visibleSessionIds, setVisibleSessionIds] = useState<string[]>([]);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [paneContextualTools, setPaneContextualTools] = useState<Record<string, ContextualToolId | null>>({});

  // Core tool island state
  const toolIslands = useToolIslands(splitConfig, emptyToolIslandsState);

  const topRowItems = toolIslands.topRowItems;
  const bottomToolIslands = toolIslands.bottomToolIslands;
  const paneCount = topRowItems.length > 0 ? topRowItems.length : 1;
  const enabled = topRowItems.length > 1 || bottomToolIslands.length > 0;

  // ── Tool island CRUD adapters ──
  // The split view passes ToolId (not PanelToolId) — the core hook validates internally.

  const openToolIsland = useCallback(
    (sourceSessionId: string, toolId: ToolId, dock: ToolIslandDock, position?: number) => {
      if (!isPanelTool(toolId)) return null;
      return toolIslands.openToolIsland(sourceSessionId, toolId, dock, position);
    },
    [toolIslands.openToolIsland],
  );

  const moveToolIsland = useCallback(
    (islandId: string, dock: ToolIslandDock, position?: number) => {
      const island = toolIslands.state.toolIslandsById[islandId];
      if (!island) return;
      const memoryKey = makeToolMemoryKey(island.sourceSessionId, island.toolId);
      const memory = toolIslands.state.toolMemories[memoryKey] ?? null;
      const topItemIds = toolIslands.state.topRowItemIds;
      const explicitPosition = dock === "top"
        ? (position ?? memory?.lastTopIndex ?? findTopInsertIndexAfterSource(topItemIds, island.sourceSessionId))
        : (position ?? memory?.lastBottomIndex ?? toolIslands.state.bottomToolIslandIds.filter((entry) => entry !== islandId).length);
      openToolIsland(island.sourceSessionId, island.toolId, dock, explicitPosition);
    },
    [openToolIsland, toolIslands.state],
  );

  const openToolIslandInTopColumn = useCallback(
    (sourceSessionId: string, toolId: ToolId, columnId: string, position?: number) => {
      if (!isPanelTool(toolId)) return null;
      return toolIslands.openToolIslandInTopColumn(sourceSessionId, toolId, columnId, position);
    },
    [toolIslands.openToolIslandInTopColumn],
  );

  const moveToolIslandToTopColumn = useCallback(
    (islandId: string, columnId: string, position?: number) => {
      const island = toolIslands.state.toolIslandsById[islandId];
      if (!island) return;
      openToolIslandInTopColumn(island.sourceSessionId, island.toolId, columnId, position);
    },
    [openToolIslandInTopColumn, toolIslands.state.toolIslandsById],
  );

  const getToolIslandForPane = useCallback(
    (sessionId: string, toolId: ToolId): ToolIsland | null => {
      if (!isPanelTool(toolId)) return null;
      return toolIslands.getToolIslandForPane(sessionId, toolId);
    },
    [toolIslands.getToolIslandForPane],
  );

  // ── Session management ──

  const requestAddSplitSession = useCallback(({
    sessionId,
    activeSessionId,
    maxPaneCount,
    position,
  }: SplitAddSessionInput): SplitAddSessionResult => {
    const currentVisibleSessionIds = visibleSessionIds.length > 0
      ? visibleSessionIds
      : activeSessionId
        ? [activeSessionId]
        : [];
    const reason = getSplitAddRejectionReason({
      sessionId,
      activeSessionId,
      visibleSessionIds: currentVisibleSessionIds,
      maxPaneCount,
    });
    if (reason) return { ok: false, reason };

    const normalizedSessionId = sessionId.trim();
    const baseTopRowItemIds = toolIslands.state.topRowItemIds.length > 0
      ? toolIslands.state.topRowItemIds
      : currentVisibleSessionIds.map(makeChatItemId);

    if (baseTopRowItemIds.includes(makeChatItemId(normalizedSessionId))) {
      return { ok: true, reason: null };
    }

    const insertIndex = normalizeInsertIndex(position, baseTopRowItemIds.length);
    const nextTopRowItemIds = [...baseTopRowItemIds];
    nextTopRowItemIds.splice(insertIndex, 0, makeChatItemId(normalizedSessionId));

    const chatInsertIndex = nextTopRowItemIds
      .slice(0, insertIndex + 1)
      .filter((itemId) => itemId.startsWith("chat:")).length - 1;
    const nextVisibleSessionIds = [...currentVisibleSessionIds];
    nextVisibleSessionIds.splice(chatInsertIndex, 0, normalizedSessionId);

    setVisibleSessionIds(nextVisibleSessionIds);
    toolIslands.update((current) => ({
      ...current,
      topRowItemIds: nextTopRowItemIds,
      widthFractions: equalWidthFractions(nextTopRowItemIds.length),
    }));
    return { ok: true, reason: null };
  }, [toolIslands, visibleSessionIds]);

  const replaceSessionId = useCallback((previousSessionId: string, nextSessionId: string) => {
    const previousId = previousSessionId.trim();
    const nextId = nextSessionId.trim();
    if (!previousId || !nextId || previousId === nextId) return;

    setVisibleSessionIds((current) => replaceVisibleSessionId(current, previousId, nextId));
    setFocusedSessionId((current) => current === previousId ? nextId : current);
    setPaneContextualTools((current) => {
      if (!(previousId in current)) return current;
      const next = { ...current };
      next[nextId] = next[previousId] ?? null;
      delete next[previousId];
      return next;
    });

    toolIslands.update((current) => {
      const nextTopRowItemIds = current.topRowItemIds.map((itemId) =>
        itemId === makeChatItemId(previousId) ? makeChatItemId(nextId) : itemId,
      );
      const nextToolIslandsById: Record<string, ToolIsland> = {};
      for (const [id, island] of Object.entries(current.toolIslandsById)) {
        nextToolIslandsById[id] = island.sourceSessionId === previousId
          ? { ...island, sourceSessionId: nextId, persistKey: `split-tool:${nextId}:${island.toolId}:${id}` }
          : island;
      }
      const nextToolMemories: Record<string, ToolIslandMemory> = {};
      for (const [key, memory] of Object.entries(current.toolMemories)) {
        const [sessionId, ...toolIdParts] = key.split(":");
        const toolId = toolIdParts.join(":") as ToolId;
        if (sessionId === previousId) {
          nextToolMemories[makeToolMemoryKey(nextId, toolId)] = {
            ...memory,
            persistKey: `split-tool:${nextId}:${toolId}:${memory.islandId}`,
          };
        } else {
          nextToolMemories[key] = memory;
        }
      }
      return { ...current, topRowItemIds: nextTopRowItemIds, toolIslandsById: nextToolIslandsById, toolMemories: nextToolMemories };
    });
  }, [toolIslands]);

  const removeSplitSession = useCallback((sessionId: string) => {
    const chatItemId = makeChatItemId(sessionId);
    const toolIslandIdsToRemove = Object.values(toolIslands.state.toolIslandsById)
      .filter((island) => island.sourceSessionId === sessionId)
      .map((island) => island.id);

    setVisibleSessionIds((current) => current.filter((entry) => entry !== sessionId));
    setFocusedSessionId((current) => current === sessionId ? null : current);
    setPaneContextualTools((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });

    toolIslands.update((current) => {
      const nextTopRowItemIds = current.topRowItemIds.filter((entry) => entry !== chatItemId);
      const nextTopToolColumnsById: Record<string, ToolColumn> = {};
      for (const [columnId, column] of Object.entries(current.topToolColumnsById)) {
        const nextIslandIds = column.islandIds.filter((islandId) => !toolIslandIdsToRemove.includes(islandId));
        if (nextIslandIds.length > 0) {
          nextTopToolColumnsById[columnId] = {
            ...column,
            islandIds: nextIslandIds,
            splitRatios: equalWidthFractions(nextIslandIds.length),
          };
        }
      }
      const prunedTopRowItemIds = nextTopRowItemIds.filter((itemId) => {
        if (!itemId.startsWith("tool-column:")) return true;
        return !!nextTopToolColumnsById[stripToolColumnItemId(itemId)];
      });
      const nextBottomToolIslandIds = current.bottomToolIslandIds.filter((entry) => !toolIslandIdsToRemove.includes(entry));
      const nextToolIslandsById = { ...current.toolIslandsById };
      for (const islandId of toolIslandIdsToRemove) delete nextToolIslandsById[islandId];
      const nextToolMemories: Record<string, ToolIslandMemory> = {};
      for (const [key, memory] of Object.entries(current.toolMemories)) {
        if (!key.startsWith(`${sessionId}:`)) nextToolMemories[key] = memory;
      }
      return {
        ...current,
        topRowItemIds: prunedTopRowItemIds,
        topToolColumnsById: nextTopToolColumnsById,
        widthFractions: equalWidthFractions(prunedTopRowItemIds.length),
        toolIslandsById: nextToolIslandsById,
        toolMemories: nextToolMemories,
        bottomToolIslandIds: nextBottomToolIslandIds,
        bottomWidthFractions: equalWidthFractions(nextBottomToolIslandIds.length),
      };
    });
  }, [toolIslands]);

  const dismissSplitView = useCallback(() => {
    setVisibleSessionIds([]);
    setFocusedSessionId(null);
    setPaneContextualTools({});
    toolIslands.resetState({
      ...emptyToolIslandsState(),
      bottomHeight: DEFAULT_BOTTOM_TOOLS_HEIGHT,
    });
  }, [toolIslands]);

  // ── Contextual tools (per-pane tasks/agents) ──

  const getPaneContextualTool = useCallback(
    (sessionId: string): ContextualToolId | null => paneContextualTools[sessionId] ?? null,
    [paneContextualTools],
  );

  const togglePaneContextualTool = useCallback((sessionId: string, toolId: ContextualToolId) => {
    setPaneContextualTools((current) => ({
      ...current,
      [sessionId]: current[sessionId] === toolId ? null : toolId,
    }));
  }, []);

  // ── Session utilities ──

  const pruneSplitSessions = useCallback((validSessionIds: ReadonlySet<string>) => {
    const removedSessionIds = visibleSessionIds.filter((sessionId) => !validSessionIds.has(sessionId));
    for (const sessionId of removedSessionIds) {
      removeSplitSession(sessionId);
    }
    return { removedSessionIds };
  }, [removeSplitSession, visibleSessionIds]);

  const canShowSessionSplitAction = useCallback(
    (sessionId: string | null | undefined, activeSessionId: string | null) => {
      const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
      if (!normalizedSessionId) return false;
      return normalizedSessionId !== activeSessionId && !visibleSessionIds.includes(normalizedSessionId);
    },
    [visibleSessionIds],
  );

  return {
    enabled,
    visibleSessionIds,
    paneCount,
    focusedSessionId,
    widthFractions: toolIslands.state.widthFractions,
    topRowItems,
    bottomToolIslands,
    bottomHeight: toolIslands.state.bottomHeight,
    bottomWidthFractions: toolIslands.state.bottomWidthFractions,
    setFocusedSession: setFocusedSessionId,
    setWidthFractions: toolIslands.setWidthFractions,
    setTopToolColumnSplitRatios: toolIslands.setTopToolColumnSplitRatios,
    setBottomHeight: toolIslands.setBottomHeight,
    setBottomWidthFractions: toolIslands.setBottomWidthFractions,
    requestAddSplitSession,
    replaceSessionId,
    removeSplitSession,
    dismissSplitView,
    openToolIsland,
    moveToolIsland,
    openToolIslandInTopColumn,
    moveToolIslandToTopColumn,
    closeToolIsland: toolIslands.closeToolIsland,
    getToolIslandForPane,
    getPaneContextualTool,
    togglePaneContextualTool,
    pruneSplitSessions,
    canShowSessionSplitAction,
  };
}
