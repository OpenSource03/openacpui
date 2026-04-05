import { describe, expect, it } from "vitest";
import {
  buildConstrainedFractionsFromMinimums,
  canFitTopRowLayout,
  getChatPaneMinWidthPx,
  getRequiredTopRowWidth,
  solveAdjacentResize,
} from "./workspace-constraints";

describe("workspace constraints", () => {
  it("uses stricter chat minimums for single and split layouts", () => {
    expect(getChatPaneMinWidthPx("single")).toBe(704);
    expect(getChatPaneMinWidthPx("split")).toBe(458);
  });

  it("computes required mixed top-row widths", () => {
    expect(getRequiredTopRowWidth(["chat", "chat", "tool-column"], "split")).toBe(1204);
    expect(canFitTopRowLayout(["chat", "chat", "tool-column"], 1203, "split")).toBe(false);
    expect(canFitTopRowLayout(["chat", "chat", "tool-column"], 1204, "split")).toBe(true);
  });

  it("builds constrained preview fractions from pixel minimums", () => {
    const fractions = buildConstrainedFractionsFromMinimums(
      ["chat", "tool-column"],
      1200,
      "split",
      [0.5, 0.5],
    );

    expect(fractions).not.toBeNull();
    const contentWidth = 1200 - 4;
    expect((fractions![0] * contentWidth)).toBeGreaterThanOrEqual(458);
    expect((fractions![1] * contentWidth)).toBeGreaterThanOrEqual(280);
  });

  it("clamps adjacent resize pairs against pixel minimums", () => {
    const result = solveAdjacentResize(
      [0.5, 0.5],
      0,
      -500,
      1200,
      [458, 280],
      4,
    );

    expect(result).not.toBeNull();
    const contentWidth = 1200 - 4;
    expect((result![0] * contentWidth)).toBeCloseTo(458, 4);
    expect((result![1] * contentWidth)).toBeCloseTo(contentWidth - 458, 4);
  });
});
