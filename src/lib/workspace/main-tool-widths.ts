import {
  DEFAULT_TOOL_PREFERRED_WIDTH,
  MIN_TOOLS_PANEL_WIDTH,
  MIN_PANE_WIDTH_FRACTION,
  SPLIT_HANDLE_WIDTH,
  TOOL_PREFERRED_WIDTHS,
  equalWidthFractions,
} from "@/lib/layout/constants";

const DEFAULT_TOOL_COLUMN_FRACTION = 0.32;
const MIN_CHAT_FRACTION = 0.35;

export interface MainToolWidthChangeHint {
  toolId?: string;
  lastWidthFraction?: number;
}

export interface MainToolWidthChange {
  kind: "column-added" | "column-removed" | "column-moved" | "count-changed";
  prevItemCount: number;
  nextItemCount: number;
  changeIndex: number;
  fromIndex?: number;
  toolHint?: MainToolWidthChangeHint;
}

function clampFraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(value, length - 1));
}

export function getTopToolAreaFraction(widthFractions: number[]): number {
  return clampFraction(1 - (widthFractions[0] ?? 1));
}

export function getTopToolAreaWidthPx(widthFractions: number[], workspaceWidth: number): number {
  if (workspaceWidth <= 0) return 0;
  return getTopToolAreaFraction(widthFractions) * workspaceWidth;
}

export function buildDefaultMainToolWidthFractions(toolColumnCount: number): number[] {
  if (toolColumnCount <= 0) return [1];
  const perTool = DEFAULT_TOOL_COLUMN_FRACTION;
  const totalTools = perTool * toolColumnCount;
  const chatFraction = Math.max(MIN_CHAT_FRACTION, 1 - totalTools);
  const actualPerTool = (1 - chatFraction) / toolColumnCount;
  return [chatFraction, ...Array.from({ length: toolColumnCount }, () => actualPerTool)];
}

function normalizeToolFractions(widthFractions: number[], toolColumnCount: number): number[] {
  if (toolColumnCount <= 0) return [];

  const toolFractions = widthFractions.slice(1, toolColumnCount + 1);
  if (toolFractions.length !== toolColumnCount) {
    return equalWidthFractions(toolColumnCount);
  }

  const total = toolFractions.reduce((sum, fraction) => sum + Math.max(0, fraction), 0);
  if (total <= 0) return equalWidthFractions(toolColumnCount);
  return toolFractions.map((fraction) => Math.max(0, fraction) / total);
}

function insertToolColumnFraction(
  previousFractions: number[],
  insertIndex: number,
  desiredFraction: number = DEFAULT_TOOL_COLUMN_FRACTION,
): number[] {
  const prevChat = previousFractions[0] ?? 1;
  const newChat = prevChat - desiredFraction;
  if (newChat >= MIN_CHAT_FRACTION) {
    const result = [...previousFractions];
    result[0] = newChat;
    result.splice(insertIndex + 1, 0, desiredFraction);
    return result;
  }
  const toolCount = previousFractions.length;
  return buildDefaultMainToolWidthFractions(toolCount);
}

function removeToolColumnFraction(previousFractions: number[], removedColumnIndex: number): number[] {
  const fractionIndex = removedColumnIndex + 1;
  if (fractionIndex <= 0 || fractionIndex >= previousFractions.length) {
    return buildDefaultMainToolWidthFractions(Math.max(0, previousFractions.length - 2));
  }

  const removedFraction = previousFractions[fractionIndex] ?? 0;
  const result = [...previousFractions];
  result.splice(fractionIndex, 1);
  result[0] = (result[0] ?? 0) + removedFraction;
  return result.length <= 1 ? [1] : result;
}

function moveToolColumnFraction(
  previousFractions: number[],
  fromIndex: number,
  toIndex: number,
): number[] {
  const toolColumnCount = Math.max(0, previousFractions.length - 1);
  if (toolColumnCount <= 1) {
    return previousFractions;
  }

  const fromFractionIndex = clampIndex(fromIndex, toolColumnCount) + 1;
  const toFractionIndex = clampIndex(toIndex, toolColumnCount) + 1;
  if (fromFractionIndex === toFractionIndex) {
    return previousFractions;
  }

  const result = [...previousFractions];
  const [movedFraction] = result.splice(fromFractionIndex, 1);
  if (movedFraction == null) {
    return previousFractions;
  }
  result.splice(toFractionIndex, 0, movedFraction);
  return result;
}

export function scaleTopRowFractionsToToolArea(
  widthFractions: number[],
  toolColumnCount: number,
  toolAreaFraction: number,
): number[] {
  if (toolColumnCount <= 0) return [1];

  const clampedToolAreaFraction = clampFraction(toolAreaFraction);
  const toolRelativeFractions = normalizeToolFractions(widthFractions, toolColumnCount);

  return [
    1 - clampedToolAreaFraction,
    ...toolRelativeFractions.map((fraction) => fraction * clampedToolAreaFraction),
  ];
}

interface ResolveMainToolAreaWidthInput {
  preferredTopAreaWidthPx: number | null;
  widthFractions: number[];
  workspaceWidth: number;
  minChatWidth: number;
  requiredToolWidth: number;
  showToolArea: boolean;
}

interface ResolveMainToolAreaWidthResult {
  toolAreaWidth: number;
  toolAreaFraction: number;
  chatFraction: number;
  minChatFraction: number;
}

interface ProjectMainToolColumnInsertPreviewInput {
  preferredTopAreaWidthPx: number | null;
  widthFractions: number[];
  workspaceWidth: number;
  minChatWidth: number;
  currentToolColumnCount: number;
  insertIndex: number;
  desiredColumnFraction: number;
}

interface ProjectMainToolColumnInsertPreviewResult {
  widthFractions: number[];
  preferredTopAreaWidthPx: number | null;
  toolAreaFraction: number;
  toolAreaWidth: number;
  chatFraction: number;
  toolRelativeFractions: number[];
}

interface ProjectMainToolWidthChangeInput {
  preferredTopAreaWidthPx: number | null;
  widthFractions: number[];
  workspaceWidth: number;
  minChatWidth: number;
  change: MainToolWidthChange;
}

interface ResolveProjectedMainToolWidthChangeInput {
  projection: ProjectMainToolColumnInsertPreviewResult;
  workspaceWidth: number;
  minChatWidth: number;
  nextToolColumnCount: number;
}

interface ResolveMainToolAreaLeadingColumnResizeInput {
  startToolAreaWidth: number;
  desiredToolAreaWidth: number;
  workspaceWidth: number;
  minChatWidth: number;
  toolRelativeFractions: number[];
  outerHandleWidth: number;
}

interface ResolveMainToolAreaLeadingColumnResizeResult {
  widthFractions: number[];
  preferredTopAreaWidthPx: number;
  toolAreaWidth: number;
  toolAreaFraction: number;
  chatFraction: number;
  toolRelativeFractions: number[];
}

export function resolveMainToolAreaWidth(
  input: ResolveMainToolAreaWidthInput,
): ResolveMainToolAreaWidthResult {
  const {
    preferredTopAreaWidthPx,
    widthFractions,
    workspaceWidth,
    minChatWidth,
    requiredToolWidth,
    showToolArea,
  } = input;

  const minChatFraction =
    workspaceWidth > 0
      ? Math.min(0.92, minChatWidth / workspaceWidth)
      : 1;

  if (!showToolArea || workspaceWidth <= 0) {
    return {
      toolAreaWidth: 0,
      toolAreaFraction: 0,
      chatFraction: 1,
      minChatFraction,
    };
  }

  const maxToolAreaWidth = Math.max(0, workspaceWidth - minChatWidth);
  const fallbackWidthPx = getTopToolAreaWidthPx(widthFractions, workspaceWidth);
  const basePreferredWidthPx = preferredTopAreaWidthPx ?? fallbackWidthPx;
  const toolAreaWidth = Math.min(
    maxToolAreaWidth,
    Math.max(requiredToolWidth, basePreferredWidthPx),
  );
  const toolAreaFraction = workspaceWidth > 0 ? clampFraction(toolAreaWidth / workspaceWidth) : 0;

  return {
    toolAreaWidth,
    toolAreaFraction,
    chatFraction: clampFraction(1 - toolAreaFraction),
    minChatFraction,
  };
}

export function projectMainToolColumnInsertPreview(
  input: ProjectMainToolColumnInsertPreviewInput,
): ProjectMainToolColumnInsertPreviewResult {
  const {
    currentToolColumnCount,
    insertIndex,
    desiredColumnFraction,
    ...sharedInput
  } = input;

  return projectMainToolWidthChange({
    ...sharedInput,
    change: {
      kind: "column-added",
      prevItemCount: currentToolColumnCount,
      nextItemCount: currentToolColumnCount + 1,
      changeIndex: insertIndex,
      toolHint: { lastWidthFraction: desiredColumnFraction },
    },
  });
}

export function projectMainToolWidthChange(
  input: ProjectMainToolWidthChangeInput,
): ProjectMainToolColumnInsertPreviewResult {
  const {
    preferredTopAreaWidthPx,
    widthFractions,
    workspaceWidth,
    minChatWidth,
    change,
  } = input;
  const {
    kind,
    prevItemCount,
    nextItemCount,
    changeIndex,
    fromIndex,
    toolHint,
  } = change;

  const currentToolAreaFraction = resolveCurrentToolAreaFraction(
    widthFractions,
    preferredTopAreaWidthPx,
    workspaceWidth,
    minChatWidth,
  );

  const rebasedFractions = widthFractions.length === prevItemCount + 1
    ? scaleTopRowFractionsToToolArea(widthFractions, prevItemCount, currentToolAreaFraction)
    : buildDefaultMainToolWidthFractions(prevItemCount);

  let nextWidthFractions = rebasedFractions;
  if (kind === "column-added") {
    let desiredFraction = DEFAULT_TOOL_COLUMN_FRACTION;
    if (toolHint?.lastWidthFraction != null) {
      desiredFraction = toolHint.lastWidthFraction;
    } else if (toolHint?.toolId) {
      const preferredPx = TOOL_PREFERRED_WIDTHS[toolHint.toolId] ?? DEFAULT_TOOL_PREFERRED_WIDTH;
      if (workspaceWidth > 0) {
        desiredFraction = Math.min(
          getMaxToolAreaFraction(workspaceWidth, minChatWidth),
          Math.max(MIN_PANE_WIDTH_FRACTION, preferredPx / workspaceWidth),
        );
      }
    }
    nextWidthFractions = insertToolColumnFraction(rebasedFractions, changeIndex, desiredFraction);
  } else if (kind === "column-removed") {
    nextWidthFractions = removeToolColumnFraction(rebasedFractions, changeIndex);
  } else if (kind === "column-moved") {
    nextWidthFractions = moveToolColumnFraction(
      rebasedFractions,
      fromIndex ?? changeIndex,
      changeIndex,
    );
  } else if (rebasedFractions.length !== nextItemCount + 1) {
    nextWidthFractions = buildDefaultMainToolWidthFractions(nextItemCount);
  }

  const toolAreaFraction = getTopToolAreaFraction(nextWidthFractions);
  const toolAreaWidth = workspaceWidth > 0 ? toolAreaFraction * workspaceWidth : 0;

  return {
    widthFractions: nextWidthFractions,
    preferredTopAreaWidthPx: nextItemCount > 0 ? toolAreaWidth : null,
    toolAreaFraction,
    toolAreaWidth,
    chatFraction: clampFraction(1 - toolAreaFraction),
    toolRelativeFractions: normalizeToolFractions(nextWidthFractions, nextItemCount),
  };
}

export function resolveProjectedMainToolWidthChange(
  input: ResolveProjectedMainToolWidthChangeInput,
): ProjectMainToolColumnInsertPreviewResult | null {
  const {
    projection,
    workspaceWidth,
    minChatWidth,
    nextToolColumnCount,
  } = input;

  const requiredToolWidth = nextToolColumnCount > 0
    ? ((nextToolColumnCount * MIN_TOOLS_PANEL_WIDTH) + ((nextToolColumnCount - 1) * SPLIT_HANDLE_WIDTH))
    : 0;
  const resolved = resolveMainToolAreaWidth({
    preferredTopAreaWidthPx: projection.preferredTopAreaWidthPx,
    widthFractions: projection.widthFractions,
    workspaceWidth,
    minChatWidth,
    requiredToolWidth,
    showToolArea: nextToolColumnCount > 0,
  });

  if (nextToolColumnCount > 0 && resolved.toolAreaWidth + 0.5 < requiredToolWidth) {
    return null;
  }

  return {
    ...projection,
    preferredTopAreaWidthPx: nextToolColumnCount > 0 ? resolved.toolAreaWidth : null,
    toolAreaFraction: resolved.toolAreaFraction,
    toolAreaWidth: resolved.toolAreaWidth,
    chatFraction: resolved.chatFraction,
  };
}

export function resolveMainToolAreaLeadingColumnResize(
  input: ResolveMainToolAreaLeadingColumnResizeInput,
): ResolveMainToolAreaLeadingColumnResizeResult {
  const {
    startToolAreaWidth,
    desiredToolAreaWidth,
    workspaceWidth,
    minChatWidth,
    toolRelativeFractions,
    outerHandleWidth,
  } = input;
  const toolColumnCount = toolRelativeFractions.length;
  if (toolColumnCount <= 0 || workspaceWidth <= 0) {
    return {
      widthFractions: [1],
      preferredTopAreaWidthPx: 0,
      toolAreaWidth: 0,
      toolAreaFraction: 0,
      chatFraction: 1,
      toolRelativeFractions: [],
    };
  }

  const normalizedToolFractions = normalizeToolFractions(
    [0, ...toolRelativeFractions],
    toolColumnCount,
  );
  const innerHandleWidth = Math.max(0, toolColumnCount - 1) * SPLIT_HANDLE_WIDTH;
  const startContentWidth = Math.max(0, startToolAreaWidth - outerHandleWidth - innerHandleWidth);
  const startColumnWidths = normalizedToolFractions.map((fraction) => fraction * startContentWidth);
  const trailingColumnWidths = startColumnWidths.slice(1);
  const fixedTrailingWidth = trailingColumnWidths.reduce((sum, width) => sum + width, 0);

  const minToolAreaWidth = outerHandleWidth + innerHandleWidth + fixedTrailingWidth + MIN_TOOLS_PANEL_WIDTH;
  const maxToolAreaWidth = Math.max(minToolAreaWidth, workspaceWidth - minChatWidth);
  const nextToolAreaWidth = clampNumber(desiredToolAreaWidth, minToolAreaWidth, maxToolAreaWidth);
  const nextContentWidth = Math.max(0, nextToolAreaWidth - outerHandleWidth - innerHandleWidth);
  const nextLeadingWidth = Math.max(MIN_TOOLS_PANEL_WIDTH, nextContentWidth - fixedTrailingWidth);
  const nextColumnWidths = [nextLeadingWidth, ...trailingColumnWidths];
  const nextToolRelativeFractions = nextContentWidth > 0
    ? nextColumnWidths.map((width) => width / nextContentWidth)
    : equalWidthFractions(toolColumnCount);
  const toolAreaFraction = clampFraction(nextToolAreaWidth / workspaceWidth);
  const chatFraction = clampFraction(1 - toolAreaFraction);

  return {
    widthFractions: [
      chatFraction,
      ...nextToolRelativeFractions.map((fraction) => fraction * toolAreaFraction),
    ],
    preferredTopAreaWidthPx: nextToolAreaWidth,
    toolAreaWidth: nextToolAreaWidth,
    toolAreaFraction,
    chatFraction,
    toolRelativeFractions: nextToolRelativeFractions,
  };
}

export function resolveCurrentToolAreaFraction(
  widthFractions: number[],
  preferredTopAreaWidthPx: number | null,
  workspaceWidth: number,
  minChatWidth: number,
): number {
  if (workspaceWidth > 0) {
    const maxToolAreaFraction = getMaxToolAreaFraction(workspaceWidth, minChatWidth);
    return Math.min(
      maxToolAreaFraction,
      Math.max(
        0,
        (preferredTopAreaWidthPx ?? getTopToolAreaWidthPx(widthFractions, workspaceWidth)) / workspaceWidth,
      ),
    );
  }

  return Math.max(0, 1 - (widthFractions[0] ?? 1));
}

function getMaxToolAreaFraction(workspaceWidth: number, minChatWidth: number): number {
  if (workspaceWidth <= 0) {
    return 1 - MIN_CHAT_FRACTION;
  }

  return Math.max(0, 1 - Math.min(0.92, minChatWidth / workspaceWidth));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
