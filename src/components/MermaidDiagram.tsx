import { useEffect, useState, useRef, type ReactNode } from "react";
import mermaid from "mermaid";
import { reportError } from "@/lib/analytics/analytics";
import { CHAT_CONTENT_RESIZED_EVENT } from "@/lib/layout/constants";
import { useResolvedTheme } from "@/hooks/useTheme";
import { CopyButton } from "./CopyButton";

/** Bump when mermaid config changes to invalidate cached SVGs. */
const MERMAID_RENDER_VERSION = "7";
const MAX_CACHE_ENTRIES = 80;
const mermaidSvgCache = new Map<string, string>();
/** Cache parse errors so failed diagrams don't retry on virtualizer remount. */
const mermaidErrorCache = new Map<string, string>();

// ── Shared theme variables (identical in both light & dark) ─────────────

const SHARED_THEME_VARIABLES = {
  lineColor: "#6b7280",
  defaultLinkColor: "#6b7280",
  pieTitleTextSize: "16px",
  pieStrokeWidth: "2px",
  git0: "#6366f1",
  git1: "#8b5cf6",
  git2: "#ec4899",
  git3: "#f59e0b",
  git4: "#10b981",
  git5: "#06b6d4",
  git6: "#f43f5e",
  git7: "#84cc16",
  pie1: "#6366f1",
  pie2: "#8b5cf6",
  pie3: "#a78bfa",
  pie8: "#818cf8",
} as const;

// ── Light theme ─────────────────────────────────────────────────────────

const LIGHT_THEME_VARIABLES = {
  ...SHARED_THEME_VARIABLES,
  // Global text
  primaryTextColor: "#1a1a1a",
  secondaryTextColor: "#374151",
  tertiaryTextColor: "#4b5563",
  textColor: "#1a1a1a",
  // Backgrounds
  primaryColor: "#dbeafe",
  primaryBorderColor: "#93c5fd",
  secondaryColor: "#f3e8ff",
  secondaryBorderColor: "#c4b5fd",
  tertiaryColor: "#e5e7eb",
  tertiaryBorderColor: "#9ca3af",
  mainBkg: "#dbeafe",
  nodeBorder: "#93c5fd",
  // Notes
  noteBkgColor: "#fef9c3",
  noteTextColor: "#1a1a1a",
  noteBorderColor: "#d4aa3c",
  // Labels
  signalColor: "#1a1a1a",
  signalTextColor: "#1a1a1a",
  labelTextColor: "#1a1a1a",
  loopTextColor: "#1a1a1a",
  // Sequence diagram
  actorBkg: "#dbeafe",
  actorBorder: "#93c5fd",
  actorTextColor: "#1a1a1a",
  activationBorderColor: "#93c5fd",
  activationBkgColor: "#eff6ff",
  sequenceNumberColor: "#ffffff",
  // Pie chart
  pieTitleTextColor: "#1a1a1a",
  pieLegendTextColor: "#374151",
  pieStrokeColor: "#ffffff",
  pie4: "#6b7280",
  pie5: "#9ca3af",
  pie6: "#4b5563",
  pie7: "#374151",
  pie9: "#c084fc",
  pie10: "#d1d5db",
  pie11: "#a5b4fc",
  pie12: "#7c3aed",
  // Git graph
  commitLabelColor: "#1a1a1a",
  commitLabelBackground: "#e5e7eb",
  tagLabelColor: "#1a1a1a",
  tagLabelBackground: "#e5e7eb",
  tagLabelBorder: "#9ca3af",
  branchLabelColor: "#1a1a1a",
  gitBranchLabel0: "#1a1a1a",
  gitBranchLabel1: "#1a1a1a",
  gitBranchLabel2: "#1a1a1a",
  gitBranchLabel3: "#1a1a1a",
  gitBranchLabel4: "#1a1a1a",
  gitBranchLabel5: "#1a1a1a",
  gitBranchLabel6: "#1a1a1a",
  gitBranchLabel7: "#1a1a1a",
  gitInv0: "#ffffff",
  gitInv1: "#ffffff",
  gitInv2: "#ffffff",
  gitInv3: "#ffffff",
  gitInv4: "#ffffff",
  gitInv5: "#ffffff",
  gitInv6: "#ffffff",
  gitInv7: "#ffffff",
  // Flowchart / state
  nodeBkg: "#dbeafe",
  clusterBkg: "#f1f5f9",
  clusterBorder: "#cbd5e1",
  edgeLabelBackground: "#ffffff",
  // Class diagram
  classText: "#1a1a1a",
  // State diagram
  labelColor: "#1a1a1a",
  altBackground: "#f1f5f9",
} as const;

// ── Dark theme ──────────────────────────────────────────────────────────

const DARK_THEME_VARIABLES = {
  ...SHARED_THEME_VARIABLES,
  // Global text
  primaryTextColor: "#e5e7eb",
  secondaryTextColor: "#d1d5db",
  tertiaryTextColor: "#9ca3af",
  textColor: "#e5e7eb",
  // Backgrounds
  primaryColor: "#312e81",
  primaryBorderColor: "#4338ca",
  secondaryColor: "#3b1f5e",
  secondaryBorderColor: "#6d28d9",
  tertiaryColor: "#1f2937",
  tertiaryBorderColor: "#4b5563",
  mainBkg: "#312e81",
  nodeBorder: "#4338ca",
  // Notes
  noteBkgColor: "#422006",
  noteTextColor: "#e5e7eb",
  noteBorderColor: "#92400e",
  // Labels
  signalColor: "#e5e7eb",
  signalTextColor: "#e5e7eb",
  labelTextColor: "#e5e7eb",
  loopTextColor: "#d1d5db",
  // Sequence diagram
  actorBkg: "#1e1b4b",
  actorBorder: "#4338ca",
  actorTextColor: "#e5e7eb",
  activationBorderColor: "#4338ca",
  activationBkgColor: "#312e81",
  sequenceNumberColor: "#e5e7eb",
  // Pie chart
  pieTitleTextColor: "#e5e7eb",
  pieLegendTextColor: "#d1d5db",
  pieStrokeColor: "#111827",
  pie4: "#4b5563",
  pie5: "#6b7280",
  pie6: "#374151",
  pie7: "#1f2937",
  pie9: "#7c3aed",
  pie10: "#374151",
  pie11: "#4f46e5",
  pie12: "#5b21b6",
  // Git graph
  commitLabelColor: "#e5e7eb",
  commitLabelBackground: "#374151",
  tagLabelColor: "#e5e7eb",
  tagLabelBackground: "#374151",
  tagLabelBorder: "#4b5563",
  branchLabelColor: "#e5e7eb",
  gitBranchLabel0: "#e5e7eb",
  gitBranchLabel1: "#e5e7eb",
  gitBranchLabel2: "#e5e7eb",
  gitBranchLabel3: "#e5e7eb",
  gitBranchLabel4: "#e5e7eb",
  gitBranchLabel5: "#e5e7eb",
  gitBranchLabel6: "#e5e7eb",
  gitBranchLabel7: "#e5e7eb",
  gitInv0: "#111827",
  gitInv1: "#111827",
  gitInv2: "#111827",
  gitInv3: "#111827",
  gitInv4: "#111827",
  gitInv5: "#111827",
  gitInv6: "#111827",
  gitInv7: "#111827",
  // Flowchart / state
  nodeBkg: "#1e1b4b",
  clusterBkg: "#111827",
  clusterBorder: "#374151",
  edgeLabelBackground: "#1f2937",
  // Class diagram
  classText: "#e5e7eb",
  // State diagram
  labelColor: "#e5e7eb",
  altBackground: "#111827",
  // Canvas
  background: "#1b1b1f",
} as const;

// ── Helpers ─────────────────────────────────────────────────────────────

function getMermaidCacheKey(code: string, theme: "light" | "dark"): string {
  return `${MERMAID_RENDER_VERSION}::${theme}::${code}`;
}

/** Evict oldest entries when the cache exceeds `MAX_CACHE_ENTRIES`. */
function evictCache() {
  while (mermaidSvgCache.size > MAX_CACHE_ENTRIES) {
    const oldest = mermaidSvgCache.keys().next().value;
    if (oldest !== undefined) mermaidSvgCache.delete(oldest);
    else break;
  }
}

/** Parse a CSS color (hex or rgb()) to relative luminance (0–1). */
function getColorLuminance(color: string): number | null {
  const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    return null;
  }
  // Browser normalizes inline styles to rgb(r, g, b)
  const rgbMatch = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  return null;
}

/**
 * Fix text contrast in nodes with custom inline fills (from mermaid `style` directives).
 * Theme-managed fills already pair with correct text colors — only inline overrides break contrast.
 */
function fixNodeTextContrast(container: HTMLElement): void {
  const nodes = container.querySelectorAll(".node");
  for (const node of nodes) {
    const shape = node.querySelector("rect, polygon, circle, ellipse");
    if (!shape) continue;

    // Only fix nodes with inline fill styles (mermaid `style X fill:...` directives).
    const inlineFill = (shape as HTMLElement).style?.fill;
    if (!inlineFill) continue;

    const lum = getColorLuminance(inlineFill);
    if (lum === null) continue;

    const textColor = lum > 0.5 ? "#1a1a1a" : "#f5f5f5";

    // foreignObject text (flowchart/graph nodes)
    const labels = node.querySelectorAll(".nodeLabel");
    for (const label of labels) {
      (label as HTMLElement).style.color = textColor;
    }
  }
}

// ── Shared wrapper ──────────────────────────────────────────────────────

function MermaidCard({ label, code, children }: { label: string; code: string; children: ReactNode }) {
  return (
    <div className="not-prose group/code relative my-2 rounded-lg bg-foreground/[0.03] overflow-hidden">
      <div className="flex items-center justify-between bg-foreground/[0.04] px-3 py-1">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <CopyButton text={code} className="opacity-0 transition-opacity group-hover/code:opacity-100" />
      </div>
      {children}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────

interface MermaidDiagramProps {
  code: string;
  isStreaming: boolean;
}

export function MermaidDiagram({ code, isStreaming }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderRequestRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const resolvedTheme = useResolvedTheme();
  const cacheKey = getMermaidCacheKey(code, resolvedTheme);

  // Single merged effect: initialize mermaid with the current theme, then render.
  // Merging prevents a race where the render effect fires before initialization.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const requestId = ++renderRequestRef.current;

    // Re-initialize mermaid for the current theme
    const isDark = resolvedTheme === "dark";
    mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: isDark ? DARK_THEME_VARIABLES : LIGHT_THEME_VARIABLES,
      securityLevel: "loose",
    });
    mermaid.setParseErrorHandler(() => {});

    if (!code.trim() || isStreaming) {
      container.innerHTML = "";
      setError(null);
      return;
    }

    // Check caches — success cache first, then error cache to avoid
    // retrying failed renders on virtualizer remount (which causes an
    // infinite unmount/remount loop from height changes between states).
    const cached = mermaidSvgCache.get(cacheKey);
    if (cached) {
      container.innerHTML = cached;
      setError(null);
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event(CHAT_CONTENT_RESIZED_EVENT));
      });
      return;
    }

    const cachedError = mermaidErrorCache.get(cacheKey);
    if (cachedError) {
      container.innerHTML = "";
      setError(cachedError);
      return;
    }

    container.innerHTML = "";

    async function renderDiagram() {
      try {
        setError(null);

        const id = `mermaid-${requestId}-${Math.random().toString(36).slice(2, 9)}`;
        // Don't pass our container to mermaid.render() — mermaid uses the
        // container for DOM measurements (getBBox, getBoundingClientRect).
        // The virtualizer can unmount this component mid-render, detaching
        // the container and crashing mermaid. Without a container arg,
        // mermaid creates its own temp element in document.body.
        const { svg: renderedSvg } = await mermaid.render(id, code);

        if (renderRequestRef.current !== requestId) return;

        container!.innerHTML = renderedSvg;

        // Fix SVG dimensions: mermaid sets width="100%" + max-width style,
        // which forces all diagrams to stretch to container width. Convert to
        // pixel width so diagrams use their natural size (small ones stay small,
        // wide ones extend and the container scrolls horizontally).
        const svg = container!.querySelector("svg");
        if (svg) {
          const maxW = svg.style.maxWidth;
          if (svg.getAttribute("width") === "100%" && maxW) {
            svg.setAttribute("width", maxW);
            svg.style.maxWidth = "";
          }
        }

        // Fix text contrast for nodes with custom inline fills (e.g. `style DEV fill:#e1f5ff`).
        // Mermaid doesn't adjust text color to match custom fills, so light fills
        // get light text in dark mode (invisible). Runs before caching.
        fixNodeTextContrast(container!);

        mermaidSvgCache.set(cacheKey, container!.innerHTML);
        evictCache();

        // Notify virtualizer that content height changed after async render
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event(CHAT_CONTENT_RESIZED_EVENT));
        });
      } catch (err) {
        if (renderRequestRef.current !== requestId) return;

        container!.innerHTML = "";
        const errorMsg = reportError("MERMAID_RENDER", err);
        mermaidErrorCache.set(cacheKey, errorMsg);
        setError(errorMsg);
      }
    }

    void renderDiagram();

    return () => {
      if (renderRequestRef.current === requestId) {
        container.innerHTML = "";
      }
    };
  }, [cacheKey, isStreaming]);

  if (error) {
    return (
      <MermaidCard label="mermaid (error)" code={code}>
        <div className="wrap-break-word whitespace-pre-wrap p-3 text-xs text-destructive">
          Failed to render diagram: {error}
        </div>
        <pre className="overflow-x-auto p-3 text-xs font-mono text-muted-foreground border-t border-foreground/[0.06]">
          <code>{code}</code>
        </pre>
      </MermaidCard>
    );
  }

  if (isStreaming) {
    return (
      <MermaidCard label="mermaid" code={code}>
        <pre className="overflow-x-auto p-3 text-xs font-mono text-muted-foreground">
          <code>{code}</code>
        </pre>
      </MermaidCard>
    );
  }

  return (
    <MermaidCard label="mermaid" code={code}>
      <div
        ref={containerRef}
        className="flex min-h-24 items-center justify-center overflow-x-auto p-4 [&_svg]:h-auto"
      />
    </MermaidCard>
  );
}
