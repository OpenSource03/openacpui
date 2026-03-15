import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { CopyButton } from "./CopyButton";

interface MermaidDiagramProps {
  code: string;
}

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("dark");

  // Detect the current theme from the DOM and system preferences
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const getTheme = (): "light" | "dark" => {
      if (document.documentElement.classList.contains("dark")) {
        return "dark";
      }
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        return "dark";
      }
      return "light";
    };

    setResolvedTheme(getTheme());

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setResolvedTheme(event.matches ? "dark" : "light");
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleMediaChange);
    } else {
      // Fallback for older browsers
      // @ts-expect-error addListener is deprecated but still present in some environments
      mediaQuery.addListener(handleMediaChange);
    }

    const observer = new MutationObserver(() => {
      setResolvedTheme(getTheme());
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleMediaChange);
      } else {
        // @ts-expect-error removeListener is deprecated but still present in some environments
        mediaQuery.removeListener(handleMediaChange);
      }
      observer.disconnect();
    };
  }, []);

  // Initialize mermaid with the resolved theme, and update when the theme changes
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: resolvedTheme === "dark" ? "dark" : "default",
      securityLevel: "loose",
    });
  }, [resolvedTheme]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Generate unique ID for this diagram
    const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    async function renderDiagram() {
      try {
        setError(null);
        const { svg: renderedSvg } = await mermaid.render(id, code);
        setSvg(renderedSvg);
      } catch (err) {
        console.error("Mermaid rendering error:", err);
        setError(err instanceof Error ? err.message : "Failed to render diagram");
      }
    }

    void renderDiagram();
  }, [code, resolvedTheme]);

  if (error) {
    return (
      <div className="not-prose group/code relative my-2 rounded-lg bg-foreground/[0.03] overflow-hidden">
        <div className="flex items-center justify-between bg-foreground/[0.04] px-3 py-1">
          <span className="text-[11px] text-muted-foreground">mermaid (error)</span>
          <CopyButton text={code} className="opacity-0 transition-opacity group-hover/code:opacity-100" />
        </div>
        <div className="p-3 text-xs text-destructive">
          Failed to render diagram: {error}
        </div>
        <pre className="overflow-x-auto p-3 text-xs font-mono text-muted-foreground border-t border-foreground/[0.06]">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="not-prose group/code relative my-2 rounded-lg bg-foreground/[0.03] overflow-hidden">
      <div className="flex items-center justify-between bg-foreground/[0.04] px-3 py-1">
        <span className="text-[11px] text-muted-foreground">mermaid</span>
        <CopyButton text={code} className="opacity-0 transition-opacity group-hover/code:opacity-100" />
      </div>
      <div
        ref={containerRef}
        className="p-4 flex items-center justify-center overflow-x-auto"
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
    </div>
  );
}
