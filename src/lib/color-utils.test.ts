import { describe, it, expect } from "vitest";
import { oklchToHexRGBA, computeGlassTintColor } from "./color-utils";

describe("oklchToHexRGBA", () => {
  it("converts a known blue OKLCh to hex", () => {
    const hex = oklchToHexRGBA(0.5, 0.15, 260, 0.2);
    expect(hex).toMatch(/^#[0-9a-f]{8}$/);
    // Alpha byte should be ~0x33 (0.2 * 255 ≈ 51)
    const alphaByte = parseInt(hex.slice(7, 9), 16);
    expect(alphaByte).toBeGreaterThanOrEqual(50);
    expect(alphaByte).toBeLessThanOrEqual(52);
  });

  it("produces full opacity when alpha is 1", () => {
    const hex = oklchToHexRGBA(0.5, 0.1, 30, 1);
    expect(hex.slice(7, 9)).toBe("ff");
  });

  it("defaults alpha to 1", () => {
    const hex = oklchToHexRGBA(0.5, 0.1, 30);
    expect(hex.slice(7, 9)).toBe("ff");
  });

  it("clamps out-of-gamut values without crashing", () => {
    // Extreme chroma can push sRGB channels out of [0,1]
    const hex = oklchToHexRGBA(0.9, 0.4, 140, 0.5);
    expect(hex).toMatch(/^#[0-9a-f]{8}$/);
  });

  it("handles NaN inputs gracefully", () => {
    const hex = oklchToHexRGBA(NaN, 0.1, 30, 0.5);
    expect(hex).toMatch(/^#[0-9a-f]{8}$/);
  });

  it("handles Infinity inputs gracefully", () => {
    const hex = oklchToHexRGBA(0.5, Infinity, 30, 0.5);
    expect(hex).toMatch(/^#[0-9a-f]{8}$/);
  });

  it("produces stable output for the same input", () => {
    const a = oklchToHexRGBA(0.5, 0.12, 200, 0.15);
    const b = oklchToHexRGBA(0.5, 0.12, 200, 0.15);
    expect(a).toBe(b);
  });
});

describe("computeGlassTintColor", () => {
  it("returns null when chroma is 0", () => {
    expect(computeGlassTintColor({ hue: 260, chroma: 0 })).toBeNull();
  });

  it("returns a hex string for non-zero chroma", () => {
    const result = computeGlassTintColor({ hue: 260, chroma: 0.15 });
    expect(result).toMatch(/^#[0-9a-f]{8}$/);
  });

  it("produces different colors for different hues", () => {
    const blue = computeGlassTintColor({ hue: 260, chroma: 0.15 });
    const red = computeGlassTintColor({ hue: 30, chroma: 0.15 });
    expect(blue).not.toBe(red);
  });

  it("increases alpha with higher chroma", () => {
    const low = computeGlassTintColor({ hue: 200, chroma: 0.05 });
    const high = computeGlassTintColor({ hue: 200, chroma: 0.25 });
    // Extract alpha byte
    const alphaLow = parseInt(low!.slice(7, 9), 16);
    const alphaHigh = parseInt(high!.slice(7, 9), 16);
    expect(alphaHigh).toBeGreaterThan(alphaLow);
  });
});
