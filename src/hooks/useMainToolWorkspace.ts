/**
 * Single-chat tool workspace state management.
 *
 * Thin wrapper around `useToolIslands` that adds:
 * - localStorage persistence (per-project)
 * - Chat-absorbs-width fraction strategy (tools keep size, chat shrinks)
 * - Migration from legacy settings
 * - State sanitization on load
 */

import { type RefObject, useCallback, useEffect, useMemo } from "react";
import type { ToolId } from "@/types/tools";
import {
  MAX_BOTTOM_TOOLS_HEIGHT,
  MIN_BOTTOM_TOOLS_HEIGHT,
  clampWidthFractions,
  equalWidthFractions,
} from "@/lib/layout/constants";
import {
  buildDefaultMainToolWidthFractions,
  getTopToolAreaWidthPx,
  projectMainToolWidthChange,
  resolveCurrentToolAreaFraction,
  scaleTopRowFractionsToToolArea,
} from "@/lib/workspace/main-tool-widths";
import { isPanelTool, makeToolColumnItemId } from "@/lib/workspace/tool-island-utils";
import { getChatPaneMinWidthPx } from "@/lib/layout/workspace-constraints";
import type {
  PanelToolId,
  ToolColumn,
  ToolIsland,
  ToolIslandDock,
  ToolIslandMemory,
} from "@/types";
import {
  type ToolIslandsState,
  type TopRowChange,
  type UseToolIslandsConfig,
  useToolIslands,
} from "./useToolIslands";

// ── Re-exports ──

export type { PanelToolId } from "@/types";
export type { TopRowItem as MainTopRowItem } from "@/types";

// ── Constants ──

const MAIN_SOURCE_SESSION = "__main__";

// ── Sanitization ──

function sanitizeColumnSplitRatios(splitRatios: number[], islandCount: number): number[] {
  if (islandCount <= 0) return [];
  if (splitRatios.length !== islandCount) return equalWidthFractions(islandCount);
  return clampWidthFractions(splitRatios);
}

function sanitizeTopRowWidthFractions(widthFractions: number[], toolColumnCount: number): number[] {
  if (toolColumnCount <= 0) return [1];
  if (widthFractions.length !== toolColumnCount + 1) return buildDefaultMainToolWidthFractions(toolColumnCount);
  return clampWidthFractions(widthFractions);
}

function stripToolColumnItemId(itemId: string): string {
  return itemId.startsWith("tool-column:") ? itemId.slice(12) : itemId;
}

function sanitizeWorkspaceState(state: ToolIslandsState): ToolIslandsState {
  const seenToolIds = new Set<string>();
  const nextTopRowItemIds: string[] = [];
  const nextTopToolColumnsById: Record<string, ToolColumn> = {};
  const nextToolIslandsById: Record<string, ToolIsland> = {};
  const nextToolMemories: Record<string, ToolIslandMemory> = {};

  let topIndex = 0;
  for (const itemId of state.topRowItemIds) {
    const columnId = stripToolColumnItemId(itemId);
    const column = state.topToolColumnsById[columnId];
    if (!column) continue;

    const nextIslandIds: string[] = [];
    for (let stackIndex = 0; stackIndex < column.islandIds.length; stackIndex++) {
      const islandId = column.islandIds[stackIndex]!;
      const island = state.toolIslandsById[islandId];
      if (!island || seenToolIds.has(island.toolId)) continue;
      seenToolIds.add(island.toolId);
      nextToolIslandsById[islandId] = { ...island, dock: "top" };
      nextIslandIds.push(islandId);
      const memory = state.toolMemories[island.toolId];
      nextToolMemories[island.toolId] = {
        islandId,
        persistKey: memory?.persistKey ?? island.persistKey,
        lastDock: memory?.lastDock ?? "top",
        lastTopIndex: topIndex,
        lastBottomIndex: memory?.lastBottomIndex ?? null,
        lastTopColumnId: columnId,
        lastTopStackIndex: stackIndex,
        lastWidthFraction: memory?.lastWidthFraction,
      };
    }

    if (nextIslandIds.length === 0) continue;
    nextTopRowItemIds.push(makeToolColumnItemId(columnId));
    nextTopToolColumnsById[columnId] = {
      ...column,
      islandIds: nextIslandIds,
      splitRatios: sanitizeColumnSplitRatios(column.splitRatios, nextIslandIds.length),
    };
    topIndex += 1;
  }

  const nextBottomToolIslandIds: string[] = [];
  let bottomIndex = 0;
  for (const islandId of state.bottomToolIslandIds) {
    const island = state.toolIslandsById[islandId];
    if (!island || seenToolIds.has(island.toolId)) continue;
    seenToolIds.add(island.toolId);
    nextToolIslandsById[islandId] = { ...island, dock: "bottom" };
    nextBottomToolIslandIds.push(islandId);
    const memory = state.toolMemories[island.toolId];
    nextToolMemories[island.toolId] = {
      islandId,
      persistKey: memory?.persistKey ?? island.persistKey,
      lastDock: memory?.lastDock ?? "bottom",
      lastTopIndex: memory?.lastTopIndex ?? null,
      lastBottomIndex: bottomIndex,
      lastTopColumnId: memory?.lastTopColumnId ?? null,
      lastTopStackIndex: memory?.lastTopStackIndex ?? null,
      lastWidthFraction: memory?.lastWidthFraction,
    };
    bottomIndex += 1;
  }

  return {
    topRowItemIds: nextTopRowItemIds,
    topToolColumnsById: nextTopToolColumnsById,
    widthFractions: sanitizeTopRowWidthFractions(state.widthFractions, nextTopRowItemIds.length),
    preferredTopAreaWidthPx: state.preferredTopAreaWidthPx ?? null,
    toolIslandsById: nextToolIslandsById,
    toolMemories: nextToolMemories,
    bottomToolIslandIds: nextBottomToolIslandIds,
    bottomHeight: Math.max(MIN_BOTTOM_TOOLS_HEIGHT, Math.min(MAX_BOTTOM_TOOLS_HEIGHT, state.bottomHeight)),
    bottomWidthFractions: nextBottomToolIslandIds.length > 0 && state.bottomWidthFractions.length === nextBottomToolIslandIds.length
      ? clampWidthFractions(state.bottomWidthFractions)
      : equalWidthFractions(nextBottomToolIslandIds.length),
  };
}

// ── Persistence ──

interface LegacySerializedState {
  version: 1;
  topRowItemIds: string[];
  topToolColumnsById: Record<string, ToolColumn>;
  widthFractions: number[];
  preferredTopAreaWidthPx?: number | null;
  toolIslandsById: Record<string, { id: string; toolId: PanelToolId; dock: ToolIslandDock; persistKey: string }>;
  toolMemoriesByToolId: Partial<Record<PanelToolId, ToolIslandMemory>>;
  bottomToolIslandIds: string[];
  bottomHeight: number;
  bottomWidthFractions: number[];
}

interface MigrationInput {
  activeToolIds: ReadonlySet<ToolId>;
  toolOrder: ToolId[];
  bottomTools: ReadonlySet<ToolId>;
  bottomHeight: number;
  bottomWidthFractions: number[];
}

function makeStorageKey(projectId: string | null): string {
  return `harnss-${projectId ?? "__none__"}-main-tool-workspace-v1`;
}

function readAndConvertState(projectId: string | null, migration: MigrationInput): ToolIslandsState {
  const raw = localStorage.getItem(makeStorageKey(projectId));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as LegacySerializedState;
      if (parsed && parsed.version === 1) {
        // Convert legacy format: add sourceSessionId to islands, rename memory key
        const toolIslandsById: Record<string, ToolIsland> = {};
        for (const [id, island] of Object.entries(parsed.toolIslandsById)) {
          toolIslandsById[id] = { ...island, sourceSessionId: MAIN_SOURCE_SESSION };
        }
        const toolMemories: Record<string, ToolIslandMemory> = {};
        for (const [toolId, memory] of Object.entries(parsed.toolMemoriesByToolId)) {
          if (memory) toolMemories[toolId] = memory;
        }
        return {
          topRowItemIds: parsed.topRowItemIds,
          topToolColumnsById: parsed.topToolColumnsById,
          widthFractions: parsed.widthFractions,
          preferredTopAreaWidthPx: parsed.preferredTopAreaWidthPx ?? null,
          toolIslandsById,
          toolMemories,
          bottomToolIslandIds: parsed.bottomToolIslandIds,
          bottomHeight: parsed.bottomHeight,
          bottomWidthFractions: parsed.bottomWidthFractions,
        };
      }
    } catch {
      // fall through to migration
    }
  }

  // Migrate from old settings format
  return migrateFromSettings(projectId, migration);
}

function migrateFromSettings(projectId: string | null, migration: MigrationInput): ToolIslandsState {
  const activePanelToolIds: PanelToolId[] = migration.toolOrder.filter(
    (toolId): toolId is PanelToolId => isPanelTool(toolId) && migration.activeToolIds.has(toolId),
  );
  const sideToolIds = activePanelToolIds.filter((toolId) => !migration.bottomTools.has(toolId));
  const bottomToolIds = activePanelToolIds.filter((toolId) => migration.bottomTools.has(toolId));

  const topRowItemIds: string[] = [];
  const topToolColumnsById: Record<string, ToolColumn> = {};
  const toolIslandsById: Record<string, ToolIsland> = {};
  const toolMemories: Record<string, ToolIslandMemory> = {};

  sideToolIds.forEach((toolId, index) => {
    const islandId = `main-tool:${toolId}`;
    const columnId = `main-col:${toolId}`;
    const persistKey = `main-tool:${projectId ?? "__none__"}:${toolId}`;
    toolIslandsById[islandId] = { id: islandId, toolId, sourceSessionId: MAIN_SOURCE_SESSION, dock: "top", persistKey };
    topToolColumnsById[columnId] = { id: columnId, islandIds: [islandId], splitRatios: [1] };
    topRowItemIds.push(makeToolColumnItemId(columnId));
    toolMemories[toolId] = {
      islandId,
      persistKey,
      lastDock: "top",
      lastTopIndex: index,
      lastBottomIndex: null,
      lastTopColumnId: columnId,
      lastTopStackIndex: 0,
    };
  });

  const bottomToolIslandIds: string[] = [];
  bottomToolIds.forEach((toolId, index) => {
    const islandId = `main-tool:${toolId}`;
    const persistKey = `main-tool:${projectId ?? "__none__"}:${toolId}`;
    toolIslandsById[islandId] = { id: islandId, toolId, sourceSessionId: MAIN_SOURCE_SESSION, dock: "bottom", persistKey };
    toolMemories[toolId] = {
      islandId,
      persistKey,
      lastDock: "bottom",
      lastTopIndex: toolMemories[toolId]?.lastTopIndex ?? null,
      lastBottomIndex: index,
      lastTopColumnId: toolMemories[toolId]?.lastTopColumnId ?? null,
      lastTopStackIndex: toolMemories[toolId]?.lastTopStackIndex ?? null,
    };
    bottomToolIslandIds.push(islandId);
  });

  return {
    topRowItemIds,
    topToolColumnsById,
    widthFractions: buildDefaultMainToolWidthFractions(topRowItemIds.length),
    preferredTopAreaWidthPx: null,
    toolIslandsById,
    toolMemories,
    bottomToolIslandIds,
    bottomHeight: migration.bottomHeight,
    bottomWidthFractions: bottomToolIslandIds.length > 0
      ? equalWidthFractions(bottomToolIslandIds.length)
      : migration.bottomWidthFractions,
  };
}

function persistState(projectId: string | null, state: ToolIslandsState): void {
  // Persist in legacy format for backward compatibility
  const toolIslandsById: Record<string, { id: string; toolId: PanelToolId; dock: ToolIslandDock; persistKey: string }> = {};
  for (const [id, island] of Object.entries(state.toolIslandsById)) {
    toolIslandsById[id] = { id: island.id, toolId: island.toolId as PanelToolId, dock: island.dock, persistKey: island.persistKey };
  }
  const toolMemoriesByToolId: Partial<Record<PanelToolId, ToolIslandMemory>> = {};
  for (const [key, memory] of Object.entries(state.toolMemories)) {
    toolMemoriesByToolId[key as PanelToolId] = memory;
  }
  const serialized: LegacySerializedState = {
    version: 1,
    topRowItemIds: state.topRowItemIds,
    topToolColumnsById: state.topToolColumnsById,
    widthFractions: state.widthFractions,
    preferredTopAreaWidthPx: state.preferredTopAreaWidthPx,
    toolIslandsById,
    toolMemoriesByToolId,
    bottomToolIslandIds: state.bottomToolIslandIds,
    bottomHeight: state.bottomHeight,
    bottomWidthFractions: state.bottomWidthFractions,
  };
  localStorage.setItem(makeStorageKey(projectId), JSON.stringify(serialized));
}

// ── Config builder ──

function buildConfig(projectId: string | null, workspaceWidthRef: RefObject<number>): UseToolIslandsConfig {
  return {
    computeTopRowLayout: (change: TopRowChange, current) => {
      return projectMainToolWidthChange({
        preferredTopAreaWidthPx: current.preferredTopAreaWidthPx,
        widthFractions: current.widthFractions,
        workspaceWidth: workspaceWidthRef.current,
        minChatWidth: getChatPaneMinWidthPx("single"),
        change,
      });
    },

    getColumnWidthFraction: (state, topRowIndex) => {
      const toolAreaFraction = resolveCurrentToolAreaFraction(
        state.widthFractions,
        state.preferredTopAreaWidthPx,
        workspaceWidthRef.current,
        getChatPaneMinWidthPx("single"),
      );
      return scaleTopRowFractionsToToolArea(
        state.widthFractions,
        Math.max(0, state.widthFractions.length - 1),
        toolAreaFraction,
      )[topRowIndex + 1];
    },

    makeIslandId: (_toolId, _sessionId, existingId) => existingId ?? `main-tool:${_toolId}`,

    makePersistKey: (toolId, _sessionId, _islandId) =>
      `main-tool:${projectId ?? "__none__"}:${toolId}`,

    makeMemoryKey: (_sessionId, toolId) => toolId,

    makeColumnId: (toolId, _islandId, prevColumnId) => prevColumnId ?? `main-col:${toolId}`,

    findDefaultTopInsertIndex: () => 0,

    findExistingIsland: (islands, _sessionId, toolId) =>
      Object.values(islands).find((island) => island.toolId === toolId) ?? null,

    onStateChange: (state) => persistState(projectId, state),
  };
}

// ── Public interface ──

export interface MainToolWorkspaceState {
  topRowItems: Array<{ kind: "tool-column"; itemId: string; column: ToolColumn; islands: ToolIsland[] }>;
  bottomToolIslands: ToolIsland[];
  widthFractions: number[];
  preferredTopAreaWidthPx: number | null;
  bottomHeight: number;
  bottomWidthFractions: number[];
  setWidthFractions: (fractions: number[]) => void;
  setWidthFractionsDirect: (fractions: number[]) => void;
  setPreferredTopAreaWidthPx: (width: number | null) => void;
  setTopToolColumnSplitRatios: (columnId: string, ratios: number[]) => void;
  setBottomHeight: (height: number) => void;
  setBottomWidthFractions: (fractions: number[]) => void;
  openToolIsland: (toolId: PanelToolId, dock: ToolIslandDock, position?: number) => string | null;
  moveToolIsland: (islandId: string, dock: ToolIslandDock, position?: number) => void;
  openToolIslandInTopColumn: (toolId: PanelToolId, columnId: string, position?: number) => string | null;
  moveToolIslandToTopColumn: (islandId: string, columnId: string, position?: number) => void;
  closeToolIsland: (islandId: string) => void;
  getToolIsland: (toolId: PanelToolId) => ToolIsland | null;
  getRememberedDock: (toolId: PanelToolId) => ToolIslandDock | null;
  getRememberedWidthFraction: (toolId: PanelToolId) => number | null;
}

// ── Picker integration (encapsulates the "find target column" heuristic) ──

/**
 * Toggle a panel tool on or off via the tool picker.
 *
 * If open, closes it. If closed, opens it with smart column placement:
 * - Tools that were last in the bottom dock re-open in the top
 * - Tools that fit as a new column get their own column
 * - Otherwise, stack into the last existing column
 */
export function togglePanelTool(
  workspace: MainToolWorkspaceState,
  toolId: PanelToolId,
  canFitToolAsNewColumn: (toolId: PanelToolId) => boolean,
): void {
  const existing = workspace.getToolIsland(toolId);
  if (existing) {
    workspace.closeToolIsland(existing.id);
    return;
  }
  const rememberedDock = workspace.getRememberedDock(toolId);
  if (rememberedDock === "bottom") {
    workspace.openToolIsland(toolId, "top");
    return;
  }
  if (canFitToolAsNewColumn(toolId) || workspace.topRowItems.length === 0) {
    workspace.openToolIsland(toolId, "top");
    return;
  }
  const lastColumnId = workspace.topRowItems[workspace.topRowItems.length - 1]?.column.id;
  if (lastColumnId) {
    workspace.openToolIslandInTopColumn(toolId, lastColumnId);
  } else {
    workspace.openToolIsland(toolId, "top");
  }
}

/**
 * Move a panel tool to the top (side) dock.
 *
 * If already in the top dock, this is a no-op.
 * If in the bottom dock or not open, moves/opens into a new column or stacks.
 */
export function moveToolToSide(
  workspace: MainToolWorkspaceState,
  toolId: PanelToolId,
  canFitToolAsNewColumn: (toolId: PanelToolId) => boolean,
): void {
  const existing = workspace.getToolIsland(toolId);
  if (existing) {
    if (existing.dock === "top") return;
    if (canFitToolAsNewColumn(toolId) || workspace.topRowItems.length === 0) {
      workspace.moveToolIsland(existing.id, "top");
      return;
    }
    const lastColumnId = workspace.topRowItems[workspace.topRowItems.length - 1]?.column.id;
    if (lastColumnId) {
      workspace.moveToolIslandToTopColumn(existing.id, lastColumnId);
    }
    return;
  }
  if (canFitToolAsNewColumn(toolId) || workspace.topRowItems.length === 0) {
    workspace.openToolIsland(toolId, "top");
    return;
  }
  const lastColumnId = workspace.topRowItems[workspace.topRowItems.length - 1]?.column.id;
  if (lastColumnId) {
    workspace.openToolIslandInTopColumn(toolId, lastColumnId);
  }
}

/**
 * Move a panel tool to the bottom dock.
 */
export function moveToolToBottom(
  workspace: MainToolWorkspaceState,
  toolId: PanelToolId,
): void {
  const existing = workspace.getToolIsland(toolId);
  if (existing) {
    workspace.moveToolIsland(existing.id, "bottom");
  } else {
    workspace.openToolIsland(toolId, "bottom");
  }
}

/**
 * Move a bottom-docked tool to the top row (checking column capacity first).
 */
export function moveBottomToolToTop(
  workspace: MainToolWorkspaceState,
  islandId: string,
  canFitToolAsNewColumn: (toolId: PanelToolId) => boolean,
): void {
  const island = workspace.bottomToolIslands.find((i) => i.id === islandId);
  if ((island && canFitToolAsNewColumn(island.toolId)) || workspace.topRowItems.length === 0) {
    workspace.moveToolIsland(islandId, "top");
    return;
  }
  const lastColumnId = workspace.topRowItems[workspace.topRowItems.length - 1]?.column.id;
  if (lastColumnId) {
    workspace.moveToolIslandToTopColumn(islandId, lastColumnId);
    return;
  }
  workspace.moveToolIsland(islandId, "top");
}

// ── Hook ──

export function useMainToolWorkspace(
  projectId: string | null,
  migration: MigrationInput,
  workspaceWidthRef: RefObject<number>,
): MainToolWorkspaceState {
  const config = useMemo(() => buildConfig(projectId, workspaceWidthRef), [projectId, workspaceWidthRef]);

  const toolIslands = useToolIslands(
    config,
    () => sanitizeWorkspaceState(readAndConvertState(projectId, migration)),
  );

  // Re-initialize on project switch
  useEffect(() => {
    toolIslands.resetState(sanitizeWorkspaceState(readAndConvertState(projectId, migration)));
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Adapter: wrap CRUD to match the original API (no sourceSessionId param) ──

  const openToolIsland = useCallback(
    (toolId: PanelToolId, dock: ToolIslandDock, position?: number) =>
      toolIslands.openToolIsland(MAIN_SOURCE_SESSION, toolId, dock, position),
    [toolIslands.openToolIsland],
  );

  const openToolIslandInTopColumn = useCallback(
    (toolId: PanelToolId, columnId: string, position?: number) =>
      toolIslands.openToolIslandInTopColumn(MAIN_SOURCE_SESSION, toolId, columnId, position),
    [toolIslands.openToolIslandInTopColumn],
  );

  const getToolIsland = useCallback(
    (toolId: PanelToolId) => toolIslands.getToolIslandForPane(MAIN_SOURCE_SESSION, toolId),
    [toolIslands.getToolIslandForPane],
  );

  const getRememberedDock = useCallback(
    (toolId: PanelToolId) => toolIslands.getRememberedDock(toolId),
    [toolIslands.getRememberedDock],
  );

  const getRememberedWidthFraction = useCallback(
    (toolId: PanelToolId) => toolIslands.state.toolMemories[toolId]?.lastWidthFraction ?? null,
    [toolIslands.state.toolMemories],
  );

  // Filter topRowItems to only tool-column items (main workspace has no chat items in topRow)
  const topRowItems = useMemo(
    () => toolIslands.topRowItems.filter(
      (item): item is Extract<typeof item, { kind: "tool-column" }> => item.kind === "tool-column",
    ),
    [toolIslands.topRowItems],
  );

  // Validate fractions against current column count
  const widthFractions = toolIslands.state.widthFractions.length === 1 + topRowItems.length
    ? toolIslands.state.widthFractions
    : buildDefaultMainToolWidthFractions(topRowItems.length);

  const bottomWidthFractions = toolIslands.state.bottomWidthFractions.length === toolIslands.bottomToolIslands.length
    ? toolIslands.state.bottomWidthFractions
    : equalWidthFractions(toolIslands.bottomToolIslands.length);

  useEffect(() => {
    if (topRowItems.length <= 0) return;

    const workspaceWidth = workspaceWidthRef.current;
    if (workspaceWidth <= 0) return;

    const nextPreferredTopAreaWidthPx = getTopToolAreaWidthPx(widthFractions, workspaceWidth);
    if (Math.abs((toolIslands.state.preferredTopAreaWidthPx ?? -1) - nextPreferredTopAreaWidthPx) <= 0.5) {
      return;
    }

    toolIslands.setPreferredTopAreaWidthPx(nextPreferredTopAreaWidthPx);
  }, [
    topRowItems.length,
    toolIslands.setPreferredTopAreaWidthPx,
    toolIslands.state.preferredTopAreaWidthPx,
    widthFractions,
    workspaceWidthRef,
  ]);

  return {
    topRowItems,
    bottomToolIslands: toolIslands.bottomToolIslands,
    widthFractions,
    preferredTopAreaWidthPx: toolIslands.state.preferredTopAreaWidthPx,
    bottomHeight: toolIslands.state.bottomHeight,
    bottomWidthFractions,
    setWidthFractions: toolIslands.setWidthFractions,
    setWidthFractionsDirect: toolIslands.setWidthFractionsDirect,
    setPreferredTopAreaWidthPx: toolIslands.setPreferredTopAreaWidthPx,
    setTopToolColumnSplitRatios: toolIslands.setTopToolColumnSplitRatios,
    setBottomHeight: toolIslands.setBottomHeight,
    setBottomWidthFractions: toolIslands.setBottomWidthFractions,
    openToolIsland,
    moveToolIsland: toolIslands.moveToolIsland,
    openToolIslandInTopColumn,
    moveToolIslandToTopColumn: toolIslands.moveToolIslandToTopColumn,
    closeToolIsland: toolIslands.closeToolIsland,
    getToolIsland,
    getRememberedDock,
    getRememberedWidthFraction,
  };
}
