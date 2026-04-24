import { memo } from "react";
import { resolveSimpleIcon } from "@/lib/simple-icon-catalog";

interface SimpleIconGlyphProps {
  /** simple-icons slug (e.g. "react", "typescript", "docker"). */
  slug: string;
  /** Pixel size of the rendered glyph — applied to both width and height. */
  size?: number;
  /** Optional Tailwind / CSS class — glyph inherits `currentColor` unless `colored` is true. */
  className?: string;
  /**
   * When true, render with the brand's official hex color. Default false:
   * glyph adopts `currentColor` so it fits the active theme like a lucide icon.
   */
  colored?: boolean;
  /** Accessibility label — defaults to the brand's canonical title. */
  title?: string;
}

/**
 * Inline-SVG renderer for a simple-icons brand logo. Uses the icon's single
 * path; theme-aware by default (inherits color from parent text color).
 * Returns null for unknown slugs so the caller can render a fallback.
 */
export const SimpleIconGlyph = memo(function SimpleIconGlyph({
  slug,
  size = 16,
  className,
  colored = false,
  title,
}: SimpleIconGlyphProps) {
  const icon = resolveSimpleIcon(slug);
  if (!icon) return null;
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-label={title ?? icon.title}
      className={className}
      fill={colored ? `#${icon.hex}` : "currentColor"}
    >
      <title>{title ?? icon.title}</title>
      <path d={icon.path} />
    </svg>
  );
});
