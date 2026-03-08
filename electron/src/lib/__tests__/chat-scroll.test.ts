import { describe, expect, it } from "vitest";
import {
  BOTTOM_LOCK_THRESHOLD_PX,
  getDistanceFromBottom,
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
});
