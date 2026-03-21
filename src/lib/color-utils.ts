/**
 * OKLCh → sRGB hex conversion utilities for native glass tinting.
 *
 * Pipeline: OKLCh (polar) → OKLab (cartesian) → linear sRGB (matrix) → sRGB (gamma) → hex
 */

// OKLab → linear sRGB conversion matrix (from Björn Ottosson)
// https://bottosson.github.io/posts/oklab/
function oklabToLinearSRGB(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

// Linear sRGB → sRGB gamma correction
function linearToSRGB(x: number): number {
  if (x <= 0.0031308) return 12.92 * x;
  return 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function clampByte(v: number): number {
  const n = v * 255;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * Convert an OKLCh color to a hex RGBA string (#RRGGBBAA).
 *
 * @param lightness  OKLab L channel (0–1)
 * @param chroma     OKLCh C channel (0–~0.4)
 * @param hueDeg     OKLCh H channel in degrees (0–360)
 * @param alpha      Alpha (0–1, defaults to 1)
 */
export function oklchToHexRGBA(
  lightness: number,
  chroma: number,
  hueDeg: number,
  alpha = 1,
): string {
  const hueRad = (hueDeg * Math.PI) / 180;
  const a = chroma * Math.cos(hueRad);
  const b = chroma * Math.sin(hueRad);

  const [lr, lg, lb] = oklabToLinearSRGB(lightness, a, b);

  const r = clampByte(linearToSRGB(lr));
  const g = clampByte(linearToSRGB(lg));
  const bCh = clampByte(linearToSRGB(lb));
  const aCh = clampByte(alpha);

  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(bCh)}${hex(aCh)}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getTintStrength(chroma: number): number {
  const normalized = clamp01(chroma / 0.3);
  return Math.pow(normalized, 0.8);
}

/**
 * Compute the native glass tint hex color for a space color.
 *
 * Returns null if no tint should be applied (chroma === 0).
 * Uses slightly higher alpha than the CSS overlay because native glass
 * blending absorbs more color than an additive CSS layer.
 */
export function computeGlassTintColor(
  spaceColor: { hue: number; chroma: number },
): string | null {
  if (spaceColor.chroma === 0) return null;

  const tintStrength = getTintStrength(spaceColor.chroma);
  const overlayChroma = Math.min(0.18, 0.04 + 0.12 * tintStrength);
  const alpha = (0.04 + 0.12 * tintStrength) * 1.5;

  return oklchToHexRGBA(0.5, overlayChroma, spaceColor.hue, alpha);
}
