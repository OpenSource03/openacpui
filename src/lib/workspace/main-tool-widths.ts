import { equalWidthFractions } from "@/lib/layout/constants";

function clampFraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getTopToolAreaFraction(widthFractions: number[]): number {
  return clampFraction(1 - (widthFractions[0] ?? 1));
}

export function getTopToolAreaWidthPx(widthFractions: number[], workspaceWidth: number): number {
  if (workspaceWidth <= 0) return 0;
  return getTopToolAreaFraction(widthFractions) * workspaceWidth;
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
