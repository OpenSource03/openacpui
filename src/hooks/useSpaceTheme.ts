import { useEffect, useState } from "react";
import type { Space } from "@/types";

const TINT_VARS = [
  "--space-hue", "--space-chroma",
  "--background", "--accent", "--border",
  "--muted", "--secondary", "--card", "--input",
  "--sidebar", "--sidebar-accent",
  "--island-overlay-bg", "--island-fill",
];

/**
 * Applies the active space's color tint to CSS custom properties on the document root.
 * Handles dark/light mode branching and glass/non-glass transparency.
 *
 * Returns the glass overlay style object (or null) for the tint overlay div.
 */
export function useSpaceTheme(
  activeSpace: Space | undefined,
  resolvedTheme: string,
): React.CSSProperties | null {
  const [glassOverlayStyle, setGlassOverlayStyle] = useState<React.CSSProperties | null>(null);

  useEffect(() => {
    const space = activeSpace;
    const root = document.documentElement;
    const isGlass = root.classList.contains("glass-enabled");

    if (!space || space.color.chroma === 0) {
      // Clear all tinted vars so the CSS base values take over
      for (const v of TINT_VARS) root.style.removeProperty(v);
      setGlassOverlayStyle(null);

      // Still apply opacity even for colorless (default) space
      const opacity = space?.color.opacity;
      if (opacity !== undefined && opacity < 1) {
        const isDark = root.classList.contains("dark");
        const bg = isDark ? `oklch(0.205 0 0 / ${opacity})` : `oklch(1 0 0 / ${opacity})`;
        root.style.setProperty("--island-fill", bg);
      } else {
        root.style.removeProperty("--island-fill");
      }
      return;
    }

    const { hue, chroma } = space.color;
    const opacity = space.color.opacity ?? 1;
    root.style.setProperty("--space-hue", String(hue));
    root.style.setProperty("--space-chroma", String(chroma));

    const isDark = root.classList.contains("dark");
    // Light mode needs higher chroma — tints are invisible at high lightness
    const bgChroma    = isDark ? Math.min(chroma, 0.012) : Math.min(chroma, 0.02);
    const accentChroma = isDark ? Math.min(chroma, 0.02)  : Math.min(chroma, 0.03);

    if (isDark) {
      root.style.setProperty("--background", `oklch(0.185 ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(0.3 ${accentChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(0.36 ${bgChroma} ${hue})`);
      root.style.setProperty("--muted", `oklch(0.3 ${accentChroma} ${hue})`);
      root.style.setProperty("--secondary", `oklch(0.3 ${accentChroma} ${hue})`);
      root.style.setProperty("--card", `oklch(0.22 ${bgChroma} ${hue})`);
      root.style.setProperty("--input", `oklch(0.36 ${bgChroma} ${hue})`);
      // Island fill with alpha for per-space opacity (--background stays opaque for gradient fades)
      if (opacity < 1) {
        root.style.setProperty("--island-fill", `oklch(0.185 ${bgChroma} ${hue} / ${opacity})`);
      } else {
        root.style.removeProperty("--island-fill");
      }
      if (!isGlass) {
        root.style.setProperty("--sidebar", `oklch(0.175 ${bgChroma} ${hue})`);
        root.style.setProperty("--sidebar-accent", `oklch(0.28 ${accentChroma} ${hue})`);
      }
    } else {
      // L=0.975 is perceptibly off-white — the sweet spot where chroma becomes visible
      root.style.setProperty("--background", `oklch(0.975 ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(0.945 ${accentChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(0.90 ${bgChroma} ${hue})`);
      root.style.setProperty("--muted", `oklch(0.945 ${accentChroma} ${hue})`);
      root.style.setProperty("--secondary", `oklch(0.945 ${accentChroma} ${hue})`);
      root.style.setProperty("--card", `oklch(0.975 ${bgChroma} ${hue})`);
      root.style.setProperty("--input", `oklch(0.90 ${bgChroma} ${hue})`);
      // Island fill with alpha for per-space opacity
      if (opacity < 1) {
        root.style.setProperty("--island-fill", `oklch(0.975 ${bgChroma} ${hue} / ${opacity})`);
      } else {
        root.style.removeProperty("--island-fill");
      }
      if (!isGlass) {
        root.style.setProperty("--sidebar", `oklch(0.96 ${bgChroma} ${hue})`);
        root.style.setProperty("--sidebar-accent", `oklch(0.94 ${accentChroma} ${hue})`);
      } else {
        // Glass + light: semi-transparent white tinted with space hue
        root.style.setProperty("--sidebar", `oklch(1 ${bgChroma} ${hue} / 0.45)`);
        root.style.setProperty("--sidebar-accent", `oklch(0.965 ${accentChroma} ${hue} / 0.45)`);
      }
    }

    const gradientHue = space.color.gradientHue;
    const c = Math.min(chroma, 0.15);

    if (isGlass) {
      const a = 0.08; // equal opacity for both light and dark
      const bg = gradientHue !== undefined
        ? `linear-gradient(135deg, oklch(0.5 ${c} ${hue} / ${a}), oklch(0.5 ${c} ${gradientHue} / ${a}))`
        : `oklch(0.5 ${c} ${hue} / ${a})`;
      setGlassOverlayStyle({ background: bg });
    } else {
      setGlassOverlayStyle(null);
    }

    if (gradientHue !== undefined) {
      const a = 0.07; // equal opacity for both light and dark
      // Set CSS custom prop so .island::before picks up the gradient on ALL islands
      root.style.setProperty(
        "--island-overlay-bg",
        `linear-gradient(135deg, oklch(0.5 ${c} ${hue} / ${a}), oklch(0.5 ${c} ${gradientHue} / ${a}))`,
      );
    } else {
      root.style.removeProperty("--island-overlay-bg");
    }

    return () => {
      for (const v of TINT_VARS) root.style.removeProperty(v);
      setGlassOverlayStyle(null);
    };
  }, [activeSpace, resolvedTheme]);

  return glassOverlayStyle;
}
