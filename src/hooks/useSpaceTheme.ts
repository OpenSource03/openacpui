import { useEffect, useState } from "react";
import type { Space } from "@/types";

const TINT_VARS = [
  "--space-hue", "--space-chroma",
  "--background", "--accent", "--border",
  "--muted", "--secondary", "--card", "--input",
  "--sidebar", "--sidebar-accent", "--sidebar-border",
  "--island-overlay-bg", "--island-fill",
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getTintStrength(chroma: number): number {
  const normalized = clamp01(chroma / 0.3);
  return Math.pow(normalized, 0.8);
}

/**
 * Applies the active space's color tint to CSS custom properties on the document root.
 * Handles dark/light mode branching and glass/non-glass transparency.
 *
 * Returns the glass overlay style object (or null) for the tint overlay div.
 */
export function useSpaceTheme(
  activeSpace: Space | undefined,
  resolvedTheme: string,
  isGlassActive: boolean,
): React.CSSProperties | null {
  const [glassOverlayStyle, setGlassOverlayStyle] = useState<React.CSSProperties | null>(null);

  useEffect(() => {
    const space = activeSpace;
    const root = document.documentElement;
    const isGlass = isGlassActive;
    const isDark = resolvedTheme === "dark";

    if (!space || space.color.chroma === 0) {
      // Clear all tinted vars so the CSS base values take over
      for (const v of TINT_VARS) root.style.removeProperty(v);
      setGlassOverlayStyle(null);

      // Still apply opacity even for colorless (default) space
      const opacity = space?.color.opacity;
      if (opacity !== undefined && opacity < 1) {
        const bg = isDark ? `oklch(0.214 0 0 / ${opacity})` : `oklch(1 0 0 / ${opacity})`;
        root.style.setProperty("--island-fill", bg);
      } else {
        root.style.removeProperty("--island-fill");
      }
      return;
    }

    const { hue, chroma } = space.color;
    const opacity = space.color.opacity ?? 1;
    const tintStrength = getTintStrength(chroma);
    const bgChroma = (isDark ? 0.028 : 0.04) * tintStrength;
    const surfaceChroma = (isDark ? 0.04 : 0.055) * tintStrength;
    const borderChroma = (isDark ? 0.026 : 0.034) * tintStrength;
    const sidebarChroma = (isDark ? 0.024 : 0.03) * tintStrength;
    const lightBgLightness = 0.985 - 0.012 * tintStrength;
    const lightSurfaceLightness = 0.955 - 0.02 * tintStrength;
    const darkBgLightness = 0.214 - 0.02 * tintStrength;
    const darkSurfaceLightness = 0.355 - 0.04 * tintStrength;

    root.style.setProperty("--space-hue", String(hue));
    root.style.setProperty("--space-chroma", String(chroma));

    if (isDark) {
      root.style.setProperty("--background", `oklch(${darkBgLightness} ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(${darkSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(0.39 ${borderChroma} ${hue})`);
      root.style.setProperty("--muted", `oklch(${darkSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--secondary", `oklch(${darkSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--card", `oklch(0.25 ${bgChroma} ${hue})`);
      root.style.setProperty("--input", `oklch(0.39 ${borderChroma} ${hue})`);
      // Island fill with alpha for per-space opacity (--background stays opaque for gradient fades)
      if (opacity < 1) {
        root.style.setProperty("--island-fill", `oklch(${darkBgLightness} ${bgChroma} ${hue} / ${opacity})`);
      } else {
        root.style.removeProperty("--island-fill");
      }
      if (!isGlass) {
        root.style.setProperty("--sidebar", `oklch(0.2 ${sidebarChroma} ${hue})`);
        root.style.setProperty("--sidebar-accent", `oklch(0.31 ${surfaceChroma} ${hue})`);
        root.style.setProperty("--sidebar-border", `oklch(0.4 ${borderChroma} ${hue})`);
      }
    } else {
      root.style.setProperty("--background", `oklch(${lightBgLightness} ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(${lightSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(0.91 ${borderChroma} ${hue})`);
      root.style.setProperty("--muted", `oklch(${lightSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--secondary", `oklch(${lightSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--card", `oklch(0.98 ${bgChroma} ${hue})`);
      root.style.setProperty("--input", `oklch(0.91 ${borderChroma} ${hue})`);
      // Island fill with alpha for per-space opacity
      if (opacity < 1) {
        root.style.setProperty("--island-fill", `oklch(${lightBgLightness} ${bgChroma} ${hue} / ${opacity})`);
      } else {
        root.style.removeProperty("--island-fill");
      }
      if (!isGlass) {
        root.style.setProperty("--sidebar", `oklch(0.968 ${sidebarChroma} ${hue})`);
        root.style.setProperty("--sidebar-accent", `oklch(0.947 ${surfaceChroma} ${hue})`);
        root.style.setProperty("--sidebar-border", `oklch(0.91 ${borderChroma} ${hue})`);
      } else {
        // Glass + light: show more native glass while keeping a subtle space tint.
        root.style.setProperty("--sidebar", `oklch(1 ${sidebarChroma} ${hue} / ${0.22 + 0.12 * tintStrength})`);
        root.style.setProperty("--sidebar-accent", `oklch(0.965 ${surfaceChroma} ${hue} / ${0.22 + 0.14 * tintStrength})`);
        root.style.setProperty("--sidebar-border", `oklch(0 ${borderChroma} ${hue} / ${0.08 + 0.08 * tintStrength})`);
      }
    }

    const gradientHue = space.color.gradientHue;
    const overlayChroma = Math.min(0.18, 0.04 + 0.12 * tintStrength);

    if (isGlass) {
      const a = 0.04 + 0.12 * tintStrength;
      const bg = gradientHue !== undefined
        ? `linear-gradient(135deg, oklch(0.5 ${overlayChroma} ${hue} / ${a}), oklch(0.5 ${overlayChroma} ${gradientHue} / ${a}))`
        : `oklch(0.5 ${overlayChroma} ${hue} / ${a})`;
      setGlassOverlayStyle({ background: bg });
    } else {
      setGlassOverlayStyle(null);
    }

    if (gradientHue !== undefined) {
      const a = 0.035 + 0.115 * tintStrength;
      // Set CSS custom prop so .island::before picks up the gradient on ALL islands
      root.style.setProperty(
        "--island-overlay-bg",
        `linear-gradient(135deg, oklch(0.5 ${overlayChroma} ${hue} / ${a}), oklch(0.5 ${overlayChroma} ${gradientHue} / ${a}))`,
      );
    } else {
      root.style.removeProperty("--island-overlay-bg");
    }

    return () => {
      for (const v of TINT_VARS) root.style.removeProperty(v);
      setGlassOverlayStyle(null);
    };
  }, [activeSpace, resolvedTheme, isGlassActive]);

  return glassOverlayStyle;
}
