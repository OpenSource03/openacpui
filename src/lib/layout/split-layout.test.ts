import { describe, expect, it } from "vitest";
import {
  getAppMinimumWidth,
  getMaxVisibleSplitPaneCount,
  getRequiredSplitContentWidth,
  getSplitAddRejectionReason,
} from "./split-layout";

describe("split layout utilities", () => {
  it("rejects invalid split add requests", () => {
    expect(getSplitAddRejectionReason({
      sessionId: "",
      activeSessionId: "session-1",
      visibleSessionIds: ["session-1"],
      maxPaneCount: 3,
    })).toBe("missing-session");

    expect(getSplitAddRejectionReason({
      sessionId: "session-1",
      activeSessionId: "session-1",
      visibleSessionIds: ["session-1"],
      maxPaneCount: 3,
    })).toBe("active-session");

    expect(getSplitAddRejectionReason({
      sessionId: "session-2",
      activeSessionId: "session-1",
      visibleSessionIds: ["session-1", "session-2"],
      maxPaneCount: 3,
    })).toBe("duplicate-session");

    expect(getSplitAddRejectionReason({
      sessionId: "session-3",
      activeSessionId: "session-1",
      visibleSessionIds: ["session-1", "session-2", "session-4"],
      maxPaneCount: 3,
    })).toBe("insufficient-width");
  });

  it("accepts valid split add requests", () => {
    expect(getSplitAddRejectionReason({
      sessionId: "session-2",
      activeSessionId: "session-1",
      visibleSessionIds: ["session-1"],
      maxPaneCount: 3,
    })).toBeNull();
  });

  it("calculates split pane capacity from width", () => {
    expect(getMaxVisibleSplitPaneCount(0)).toBe(1);
    expect(getMaxVisibleSplitPaneCount(400)).toBe(1);
    expect(getMaxVisibleSplitPaneCount(804)).toBe(2);
    expect(getMaxVisibleSplitPaneCount(1208)).toBe(3);
  });

  it("includes split pane count in the app minimum width", () => {
    expect(getRequiredSplitContentWidth(3)).toBe(1208);

    expect(getAppMinimumWidth({
      sidebarOpen: true,
      isIslandLayout: true,
      hasActiveSession: true,
      hasRightPanel: true,
      hasToolsColumn: true,
      isSplitViewEnabled: false,
      splitPaneCount: 1,
      isWindows: false,
    })).toBe(1542);

    expect(getAppMinimumWidth({
      sidebarOpen: true,
      isIslandLayout: true,
      hasActiveSession: true,
      hasRightPanel: false,
      hasToolsColumn: false,
      isSplitViewEnabled: true,
      splitPaneCount: 3,
      isWindows: false,
    })).toBe(1500);
  });
});
