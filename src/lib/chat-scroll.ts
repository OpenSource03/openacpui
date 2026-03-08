export const BOTTOM_LOCK_THRESHOLD_PX = 48;
export const USER_SCROLL_INTENT_WINDOW_MS = 250;

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
