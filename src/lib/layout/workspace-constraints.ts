import { MIN_TOOLS_PANEL_WIDTH, SPLIT_HANDLE_WIDTH } from "@/lib/layout/constants";

export type ChatPaneLayoutMode = "single" | "split";
export type TopRowLayoutItemKind = "chat" | "tool-column";

export const MIN_SINGLE_CHAT_PANE_WIDTH = 704;
export const MIN_SPLIT_CHAT_PANE_WIDTH = 458;
export const MIN_STACKED_TOOL_PANEL_HEIGHT = 120;

export function getChatPaneMinWidthPx(mode: ChatPaneLayoutMode): number {
  return mode === "single" ? MIN_SINGLE_CHAT_PANE_WIDTH : MIN_SPLIT_CHAT_PANE_WIDTH;
}

export function getTopRowItemMinWidthPx(
  itemKind: TopRowLayoutItemKind,
  chatMode: ChatPaneLayoutMode,
): number {
  return itemKind === "chat" ? getChatPaneMinWidthPx(chatMode) : MIN_TOOLS_PANEL_WIDTH;
}

export function getRequiredTopRowWidth(
  itemKinds: readonly TopRowLayoutItemKind[],
  chatMode: ChatPaneLayoutMode,
  handleWidth = SPLIT_HANDLE_WIDTH,
): number {
  if (itemKinds.length <= 0) return 0;

  const itemWidth = itemKinds.reduce(
    (sum, itemKind) => sum + getTopRowItemMinWidthPx(itemKind, chatMode),
    0,
  );
  return itemWidth + Math.max(0, itemKinds.length - 1) * handleWidth;
}

export function canFitTopRowLayout(
  itemKinds: readonly TopRowLayoutItemKind[],
  containerWidth: number,
  chatMode: ChatPaneLayoutMode,
  handleWidth = SPLIT_HANDLE_WIDTH,
): boolean {
  return containerWidth >= getRequiredTopRowWidth(itemKinds, chatMode, handleWidth);
}

export function buildMinimumWidthArray(
  itemKinds: readonly TopRowLayoutItemKind[],
  chatMode: ChatPaneLayoutMode,
): number[] {
  return itemKinds.map((itemKind) => getTopRowItemMinWidthPx(itemKind, chatMode));
}

export function buildConstrainedFractionsFromMinimums(
  itemKinds: readonly TopRowLayoutItemKind[],
  containerWidth: number,
  chatMode: ChatPaneLayoutMode,
  baseFractions?: readonly number[],
  handleWidth = SPLIT_HANDLE_WIDTH,
): number[] | null {
  if (itemKinds.length <= 0) return [];

  const totalHandleWidth = Math.max(0, itemKinds.length - 1) * handleWidth;
  const contentWidth = Math.max(0, containerWidth - totalHandleWidth);
  if (contentWidth <= 0) return null;

  const minimumWidths = buildMinimumWidthArray(itemKinds, chatMode);
  const minimumContentWidth = minimumWidths.reduce((sum, width) => sum + width, 0);
  if (minimumContentWidth > contentWidth) return null;

  const normalizedBase = normalizeFractions(baseFractions, itemKinds.length);
  const remaining = contentWidth - minimumContentWidth;
  const widths = minimumWidths.map((width, index) => width + remaining * normalizedBase[index]!);
  return widths.map((width) => width / contentWidth);
}

export function solveAdjacentResize(
  widthFractions: readonly number[],
  handleIndex: number,
  deltaPx: number,
  containerWidth: number,
  minWidthsPx: readonly number[],
  handleWidth = 0,
): number[] | null {
  if (
    handleIndex < 0
    || handleIndex + 1 >= widthFractions.length
    || widthFractions.length !== minWidthsPx.length
  ) {
    return null;
  }

  const totalHandleWidth = Math.max(0, widthFractions.length - 1) * handleWidth;
  const contentWidth = Math.max(0, containerWidth - totalHandleWidth);
  if (contentWidth <= 0) return null;

  const next = [...widthFractions];
  const pairWidth = (next[handleIndex]! + next[handleIndex + 1]!) * contentWidth;
  const minLeft = minWidthsPx[handleIndex]!;
  const minRight = minWidthsPx[handleIndex + 1]!;
  const maxLeft = pairWidth - minRight;
  if (maxLeft < minLeft) return null;

  const startLeft = next[handleIndex]! * contentWidth;
  const leftWidth = clampNumber(startLeft + deltaPx, minLeft, maxLeft);
  const rightWidth = pairWidth - leftWidth;

  next[handleIndex] = leftWidth / contentWidth;
  next[handleIndex + 1] = rightWidth / contentWidth;
  return next;
}

function normalizeFractions(
  fractions: readonly number[] | undefined,
  expectedLength: number,
): number[] {
  if (!fractions || fractions.length !== expectedLength) {
    return Array.from({ length: expectedLength }, () => 1 / expectedLength);
  }

  const sanitized = fractions.map((fraction) => Math.max(0, fraction));
  const total = sanitized.reduce((sum, fraction) => sum + fraction, 0);
  if (total <= 0) {
    return Array.from({ length: expectedLength }, () => 1 / expectedLength);
  }

  return sanitized.map((fraction) => fraction / total);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
