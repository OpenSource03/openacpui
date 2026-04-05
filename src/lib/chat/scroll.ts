export const BOTTOM_LOCK_THRESHOLD_PX = 48;
export const USER_SCROLL_INTENT_WINDOW_MS = 250;
export const TOP_SCROLL_FADE_RANGE_PX = 96;

interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

interface UnlockDecision extends ScrollMetrics {
  hasRecentUserIntent: boolean;
  threshold?: number;
}

export function getDistanceFromBottom({
  scrollTop,
  scrollHeight,
  clientHeight,
}: ScrollMetrics): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

export function isWithinBottomLockThreshold(
  metrics: ScrollMetrics,
  threshold = BOTTOM_LOCK_THRESHOLD_PX,
): boolean {
  return getDistanceFromBottom(metrics) <= threshold;
}

export function shouldUnlockBottomLock({
  hasRecentUserIntent,
  threshold = BOTTOM_LOCK_THRESHOLD_PX,
  ...metrics
}: UnlockDecision): boolean {
  if (!hasRecentUserIntent) return false;
  return getDistanceFromBottom(metrics) > threshold;
}

export function getTopScrollProgress(
  scrollTop: number,
  range = TOP_SCROLL_FADE_RANGE_PX,
): number {
  const safeScrollTop = Number.isFinite(scrollTop) ? scrollTop : 0;
  const safeRange = Math.max(1, range);
  const normalized = Math.max(0, Math.min(1, safeScrollTop / safeRange));
  return normalized * normalized * (3 - 2 * normalized);
}
