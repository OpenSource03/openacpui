import { describe, expect, it } from "vitest";
import {
  buildDefaultMainToolWidthFractions,
  getTopToolAreaWidthPx,
  projectMainToolColumnInsertPreview,
  projectMainToolWidthChange,
  resolveMainToolAreaLeadingColumnResize,
  resolveProjectedMainToolWidthChange,
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

  it("projects the preview width when inserting a new top tool column", () => {
    const preview = projectMainToolColumnInsertPreview({
      preferredTopAreaWidthPx: 420,
      widthFractions: [0.65, 0.35],
      workspaceWidth: 1400,
      minChatWidth: 800,
      currentToolColumnCount: 1,
      insertIndex: 0,
      desiredColumnFraction: 0.34,
    });

    expect(preview.toolAreaWidth).toBeGreaterThan(420);
    expect(preview.preferredTopAreaWidthPx).toBeCloseTo(preview.toolAreaWidth, 5);
    expect(preview.widthFractions.length).toBe(3);
    expect(preview.toolRelativeFractions.length).toBe(2);
  });

  it("preserves the surviving column width when merging two columns into one", () => {
    const preview = projectMainToolWidthChange({
      preferredTopAreaWidthPx: 640,
      widthFractions: [760 / 1400, 280 / 1400, 360 / 1400],
      workspaceWidth: 1400,
      minChatWidth: 704,
      change: {
        kind: "column-removed",
        prevItemCount: 2,
        nextItemCount: 1,
        changeIndex: 0,
      },
    });

    expect(preview.widthFractions).toEqual([1040 / 1400, 360 / 1400]);
    expect(preview.toolAreaWidth).toBeCloseTo(360, 5);
    expect(preview.preferredTopAreaWidthPx).toBeCloseTo(360, 5);
    expect(preview.toolRelativeFractions).toEqual([1]);
  });

  it("reorders standalone top columns without changing their widths", () => {
    const preview = projectMainToolWidthChange({
      preferredTopAreaWidthPx: 640,
      widthFractions: [760 / 1400, 280 / 1400, 360 / 1400],
      workspaceWidth: 1400,
      minChatWidth: 704,
      change: {
        kind: "column-moved",
        prevItemCount: 2,
        nextItemCount: 2,
        changeIndex: 1,
        fromIndex: 0,
      },
    });

    expect(preview.widthFractions[0]).toBeCloseTo(760 / 1400, 5);
    expect(preview.widthFractions[1]).toBeCloseTo(360 / 1400, 5);
    expect(preview.widthFractions[2]).toBeCloseTo(280 / 1400, 5);
    expect(preview.toolAreaWidth).toBeCloseTo(640, 5);
    expect(preview.preferredTopAreaWidthPx).toBeCloseTo(640, 5);
  });

  it("rejects projected add-column previews when the window is too narrow", () => {
    const rawProjection = projectMainToolWidthChange({
      preferredTopAreaWidthPx: 320,
      widthFractions: [920 / 1240, 320 / 1240],
      workspaceWidth: 1240,
      minChatWidth: 704,
      change: {
        kind: "column-added",
        prevItemCount: 1,
        nextItemCount: 2,
        changeIndex: 0,
        toolHint: { lastWidthFraction: 0.32 },
      },
    });

    expect(resolveProjectedMainToolWidthChange({
      projection: rawProjection,
      workspaceWidth: 1240,
      minChatWidth: 704,
      nextToolColumnCount: 2,
    })).toBeNull();
  });

  it("keeps trailing tool columns at the same pixel width during single-chat outer resize", () => {
    const result = resolveMainToolAreaLeadingColumnResize({
      startToolAreaWidth: 644,
      desiredToolAreaWidth: 744,
      workspaceWidth: 1600,
      minChatWidth: 704,
      toolRelativeFractions: [280 / 636, 356 / 636],
      outerHandleWidth: 4,
    });

    const nextContentWidth = result.toolAreaWidth - 8;
    expect(result.toolAreaWidth).toBe(744);
    expect(result.toolRelativeFractions[1]! * nextContentWidth).toBeCloseTo(356, 5);
    expect(result.toolRelativeFractions[0]! * nextContentWidth).toBeCloseTo(380, 5);
  });

  it("stops shrinking once the leading tool column reaches its minimum width", () => {
    const result = resolveMainToolAreaLeadingColumnResize({
      startToolAreaWidth: 644,
      desiredToolAreaWidth: 540,
      workspaceWidth: 1600,
      minChatWidth: 704,
      toolRelativeFractions: [280 / 636, 356 / 636],
      outerHandleWidth: 4,
    });

    expect(result.toolAreaWidth).toBeCloseTo(644, 5);
    expect(result.toolRelativeFractions[0]! * (result.toolAreaWidth - 8)).toBeCloseTo(280, 5);
  });

  it("builds the default single-column layout used after merging columns", () => {
    const fractions = buildDefaultMainToolWidthFractions(1);
    expect(fractions[0]).toBeCloseTo(0.68, 5);
    expect(fractions[1]).toBeCloseTo(0.32, 5);
  });
});
