import { describe, expect, it } from "vitest";
import { replaceVisibleSessionId } from "./split-view-state";

describe("replaceVisibleSessionId", () => {
  it("replaces a visible draft pane with the materialized session id", () => {
    expect(replaceVisibleSessionId(
      ["__draft__", "history-1"],
      "__draft__",
      "live-1",
    )).toEqual(["live-1", "history-1"]);
  });

  it("ignores replacements when the previous session is not visible", () => {
    expect(replaceVisibleSessionId(
      ["session-1", "session-2"],
      "missing-session",
      "session-3",
    )).toEqual(["session-1", "session-2"]);
  });

  it("collapses split state when replacement would duplicate another visible pane", () => {
    expect(replaceVisibleSessionId(
      ["session-1", "session-2"],
      "session-1",
      "session-2",
    )).toEqual([]);
  });
});
