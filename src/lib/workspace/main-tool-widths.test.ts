import { describe, expect, it } from "vitest";
import {
  getTopToolAreaWidthPx,
  resolveMainToolAreaWidth,
  scaleTopRowFractionsToToolArea,
} from "@/lib/workspace/main-tool-widths";

describe("main tool width helpers", () => {
  it("preserves the preferred tool width in pixels when the workspace grows", () => {
    const result = resolveMainToolAreaWidth({
      preferredTopAreaWidthPx: 320,
      widthFractions: [0.68, 0.32],
      workspaceWidth: 1400,
      minChatWidth: 400,
      requiredToolWidth: 280,
      showToolArea: true,
    });

    expect(result.toolAreaWidth).toBe(320);
    expect(result.toolAreaFraction).toBeCloseTo(320 / 1400, 5);
    expect(result.chatFraction).toBeCloseTo(1080 / 1400, 5);
  });

  it("falls back to the stored fraction when no preferred pixel width exists yet", () => {
    const result = resolveMainToolAreaWidth({
      preferredTopAreaWidthPx: null,
      widthFractions: [0.6, 0.4],
      workspaceWidth: 1000,
      minChatWidth: 400,
      requiredToolWidth: 280,
      showToolArea: true,
    });

    expect(result.toolAreaWidth).toBe(400);
    expect(result.toolAreaFraction).toBeCloseTo(0.4, 5);
  });

  it("clamps the tool area when the chat minimum width would be violated", () => {
    const result = resolveMainToolAreaWidth({
      preferredTopAreaWidthPx: 560,
      widthFractions: [0.44, 0.56],
      workspaceWidth: 800,
      minChatWidth: 400,
      requiredToolWidth: 280,
      showToolArea: true,
    });

    expect(result.toolAreaWidth).toBe(400);
    expect(result.chatFraction).toBeCloseTo(0.5, 5);
  });

  it("rescales top-row fractions to a new absolute tool-area fraction", () => {
    expect(
      scaleTopRowFractionsToToolArea([0.6, 0.25, 0.15], 2, 0.2),
    ).toEqual([0.8, 0.125, 0.075]);
  });

  it("computes the stored tool area width from top-row fractions", () => {
    expect(getTopToolAreaWidthPx([0.7, 0.3], 1200)).toBeCloseTo(360, 5);
  });
});
