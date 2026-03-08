import { describe, expect, it } from "vitest";
import {
  parseStoredTerminalState,
  reconcileTerminalState,
} from "../../../../src/lib/terminal-tabs";

describe("terminal tabs state", () => {
  it("keeps persisted tab metadata for live terminals and drops stale ones", () => {
    const persisted = parseStoredTerminalState(JSON.stringify({
      default: {
        tabs: [
          { id: "term-a", terminalId: "term-a", label: "Build" },
          { id: "term-stale", terminalId: "term-stale", label: "Old" },
        ],
        activeTabId: "term-a",
      },
    }));

    expect(reconcileTerminalState(persisted, [
      { terminalId: "term-a", spaceId: "default", createdAt: 1 },
    ])).toEqual({
      default: {
        tabs: [
          { id: "term-a", terminalId: "term-a", label: "Build" },
        ],
        activeTabId: "term-a",
      },
    });
  });

  it("recovers live terminals missing from persisted state without duplicates", () => {
    expect(reconcileTerminalState({}, [
      { terminalId: "term-a", spaceId: "default", createdAt: 1 },
      { terminalId: "term-b", spaceId: "default", createdAt: 2 },
    ])).toEqual({
      default: {
        tabs: [
          { id: "term-a", terminalId: "term-a", label: "Terminal 1" },
          { id: "term-b", terminalId: "term-b", label: "Terminal 2" },
        ],
        activeTabId: "term-b",
      },
    });
  });
});
