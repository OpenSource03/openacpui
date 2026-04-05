import { describe, expect, it } from "vitest";
import {
  getDistinctPatchPaths,
  isMultiFileStructuredPatch,
  type StructuredPatchEntry,
} from "./patch-utils";

describe("structured patch helpers", () => {
  it("treats Claude multi-hunk patches without file paths as single-file", () => {
    const patches: StructuredPatchEntry[] = [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [" context", "-old", "+new"],
      },
      {
        oldStart: 20,
        oldLines: 2,
        newStart: 20,
        newLines: 2,
        lines: [" context", "-old2", "+new2"],
      },
    ];

    expect(getDistinctPatchPaths(patches)).toEqual([]);
    expect(isMultiFileStructuredPatch(patches)).toBe(false);
  });

  it("treats multiple distinct patch file paths as multi-file", () => {
    const patches: StructuredPatchEntry[] = [
      { filePath: "/repo/src/a.ts", diff: "diff --git a/src/a.ts b/src/a.ts" },
      { filePath: "/repo/src/b.ts", diff: "diff --git a/src/b.ts b/src/b.ts" },
    ];

    expect(getDistinctPatchPaths(patches)).toEqual([
      "/repo/src/a.ts",
      "/repo/src/b.ts",
    ]);
    expect(isMultiFileStructuredPatch(patches)).toBe(true);
  });
});
