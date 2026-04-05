import { describe, expect, it } from "vitest";
import type { ToolId } from "@/types/tools";
import { applyDockDrop } from "./tool-docking";

const DEFAULT_ORDER: ToolId[] = ["terminal", "git", "browser", "files", "project-files", "mcp"];

describe("applyDockDrop", () => {
  it("keeps every panel tool when reordering within the side area", () => {
    const result = applyDockDrop(
      {
        toolOrder: DEFAULT_ORDER,
        bottomTools: new Set<ToolId>(),
      },
      "terminal",
      { area: "side", beforeId: "browser" },
    );

    expect(result.toolOrder).toEqual(["git", "terminal", "browser", "files", "project-files", "mcp"]);
    expect(new Set(result.toolOrder)).toEqual(new Set(DEFAULT_ORDER));
  });

  it("keeps every panel tool when moving a side tool into the bottom area", () => {
    const result = applyDockDrop(
      {
        toolOrder: DEFAULT_ORDER,
        bottomTools: new Set<ToolId>(["git"]),
      },
      "terminal",
      { area: "bottom", atEnd: true },
    );

    expect(result.toolOrder).toEqual(["browser", "files", "project-files", "mcp", "git", "terminal"]);
    expect(new Set(result.toolOrder)).toEqual(new Set(DEFAULT_ORDER));
    expect(result.bottomTools).toEqual(new Set<ToolId>(["git", "terminal"]));
  });

  it("keeps every panel tool when moving a bottom tool back to the side area", () => {
    const result = applyDockDrop(
      {
        toolOrder: ["git", "browser", "files", "terminal", "project-files", "mcp"],
        bottomTools: new Set<ToolId>(["terminal", "project-files", "mcp"]),
      },
      "terminal",
      { area: "side", atEnd: true },
    );

    expect(result.toolOrder).toEqual(["git", "browser", "files", "terminal", "project-files", "mcp"]);
    expect(new Set(result.toolOrder)).toEqual(new Set(DEFAULT_ORDER));
    expect(result.bottomTools).toEqual(new Set<ToolId>(["project-files", "mcp"]));
  });
});
