import { describe, expect, it } from "vitest";
import {
  BOTTOM_LOCK_THRESHOLD_PX,
  TOP_SCROLL_FADE_RANGE_PX,
  getDistanceFromBottom,
  getTopScrollProgress,
  isWithinBottomLockThreshold,
  shouldUnlockBottomLock,
} from "../../../../src/lib/chat-scroll";

describe("chat scroll helpers", () => {
  it("computes exact distance from the bottom", () => {
    expect(getDistanceFromBottom({
      scrollTop: 700,
      scrollHeight: 1000,
      clientHeight: 300,
    })).toBe(0);
  });

  it("treats near-bottom viewports as bottom-locked", () => {
    expect(isWithinBottomLockThreshold({
      scrollTop: 660,
      scrollHeight: 1000,
      clientHeight: 300,
    })).toBe(true);
  });

  it("does not unlock from passive content growth alone", () => {
    expect(shouldUnlockBottomLock({
      scrollTop: 600,
      scrollHeight: 1000,
      clientHeight: 300,
      hasRecentUserIntent: false,
    })).toBe(false);
  });

  it("unlocks only after user-originated upward scroll leaves the threshold", () => {
    expect(shouldUnlockBottomLock({
      scrollTop: 500,
      scrollHeight: 1000,
      clientHeight: 300,
      hasRecentUserIntent: true,
    })).toBe(true);
  });

  it("re-locks when the viewport returns within the threshold", () => {
    expect(isWithinBottomLockThreshold({
      scrollTop: 1000 - 300 - BOTTOM_LOCK_THRESHOLD_PX,
      scrollHeight: 1000,
      clientHeight: 300,
    })).toBe(true);
  });

  it("keeps the top shadow hidden at the top and fully visible at the fade range", () => {
    expect(getTopScrollProgress(0)).toBe(0);
    expect(getTopScrollProgress(TOP_SCROLL_FADE_RANGE_PX)).toBe(1);
  });

  it("eases the top shadow progress through the fade ramp", () => {
    expect(getTopScrollProgress(TOP_SCROLL_FADE_RANGE_PX / 2)).toBe(0.5);
  });
});
