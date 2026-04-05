import { describe, expect, it } from "vitest";
import { ensureUniqueColumnId, resolveRememberedTopStackPlacement } from "./tool-island-utils";

describe("ensureUniqueColumnId", () => {
  it("keeps the proposed column id when it is unused", () => {
    expect(ensureUniqueColumnId("main-col:terminal", {}, "main-tool:terminal")).toBe("main-col:terminal");
  });

  it("creates a distinct id when the surviving source column still owns the base id", () => {
    expect(ensureUniqueColumnId(
      "main-col:terminal",
      {
        "main-col:terminal": { id: "main-col:terminal", islandIds: ["main-tool:browser"], splitRatios: [1] },
      },
      "main-tool:terminal",
    )).toBe("main-col:terminal:main-tool:terminal");
  });
});

describe("resolveRememberedTopStackPlacement", () => {
  it("restores the remembered stack slot when the old column still exists", () => {
    expect(resolveRememberedTopStackPlacement(
      {
        islandId: "main-tool:browser",
        persistKey: "persist",
        lastDock: "top",
        lastTopIndex: 1,
        lastBottomIndex: null,
        lastTopColumnId: "main-col:stack",
        lastTopStackIndex: 0,
      },
      {
        "main-col:stack": {
          id: "main-col:stack",
          islandIds: ["main-tool:git"],
          splitRatios: [1],
        },
      },
    )).toEqual({ columnId: "main-col:stack", stackIndex: 0 });
  });

  it("returns null when the remembered column no longer exists", () => {
    expect(resolveRememberedTopStackPlacement(
      {
        islandId: "main-tool:browser",
        persistKey: "persist",
        lastDock: "top",
        lastTopIndex: 1,
        lastBottomIndex: null,
        lastTopColumnId: "main-col:missing",
        lastTopStackIndex: 0,
      },
      {},
    )).toBeNull();
  });
});
