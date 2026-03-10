import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, File, Loader2 } from "lucide-react";
import Editor from "@monaco-editor/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OpenInEditorButton } from "./OpenInEditorButton";
import { useResolvedThemeClass } from "@/hooks/useResolvedThemeClass";
import { getLanguageFromPath } from "@/lib/languages";
import { captureException } from "@/lib/analytics";

// ── Monaco language mapping ──

const EXTENSION_TO_MONACO: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mts: "typescript",
  mjs: "javascript",
  cts: "typescript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  md: "markdown",
  mdx: "markdown",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  svg: "xml",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  toml: "toml",
  ini: "ini",
  r: "r",
  lua: "lua",
  dart: "dart",
  scala: "scala",
  dockerfile: "dockerfile",
};

function getMonacoLanguage(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? "";
  const lower = fileName.toLowerCase();

  // Check full filename first
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile" || lower === "gnumakefile") return "plaintext";

  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : undefined;
  if (ext && ext in EXTENSION_TO_MONACO) return EXTENSION_TO_MONACO[ext];
  return "plaintext";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Props ──

interface FilePreviewOverlayProps {
  filePath: string | null;
  sourceRect: DOMRect | null;
  onClose: () => void;
}

// ── Overlay dimensions ──

const OVERLAY_WIDTH = 800;
const OVERLAY_MAX_HEIGHT_VH = 85;

// ── Component ──

export const FilePreviewOverlay = memo(function FilePreviewOverlay({
  filePath,
  sourceRect,
  onClose,
}: FilePreviewOverlayProps) {
  return (
    <AnimatePresence mode="wait">
      {filePath && (
        <OverlayContent
          key={filePath}
          filePath={filePath}
          sourceRect={sourceRect}
          onClose={onClose}
        />
      )}
    </AnimatePresence>
  );
});

// ── Inner content (separate for AnimatePresence keying) ──

interface OverlayContentProps {
  filePath: string;
  sourceRect: DOMRect | null;
  onClose: () => void;
}

const OverlayContent = memo(function OverlayContent({
  filePath,
  sourceRect,
  onClose,
}: OverlayContentProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const resolvedTheme = useResolvedThemeClass();

  // Load file content
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

    window.claude
      .readFile(filePath)
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
        } else {
          setContent(result.content ?? "");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        captureException(err instanceof Error ? err : new Error(String(err)), { label: "FILE_READ_ERR" });
        setError(err instanceof Error ? err.message : "Failed to read file");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  // Compute FLIP transform from source rect
  const flipTransform = useMemo(() => {
    if (!sourceRect) return null;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const overlayW = Math.min(OVERLAY_WIDTH, viewportW - 48);
    const overlayH = Math.min(
      viewportH * (OVERLAY_MAX_HEIGHT_VH / 100),
      viewportH - 48,
    );

    // Source center offset from viewport center (overlay's final position)
    const sourceX = sourceRect.left + sourceRect.width / 2;
    const sourceY = sourceRect.top + sourceRect.height / 2;

    return {
      x: sourceX - viewportW / 2,
      y: sourceY - viewportH / 2,
      scaleX: Math.max(sourceRect.width / overlayW, 0.02),
      scaleY: Math.max(sourceRect.height / overlayH, 0.02),
    };
  }, [sourceRect]);

  // File metadata
  const fileName = filePath.split("/").pop() ?? filePath;
  const dirPath = filePath.split("/").slice(0, -1).join("/");
  const language = getLanguageFromPath(filePath);
  const monacoLang = getMonacoLanguage(filePath);
  const lineCount = content ? content.split("\n").length : 0;
  const fileSize = content ? formatFileSize(new Blob([content]).size) : "";

  const morphTransform = flipTransform
    ? { x: flipTransform.x, y: flipTransform.y, scaleX: flipTransform.scaleX, scaleY: flipTransform.scaleY, opacity: 0 }
    : { scale: 0.92, opacity: 0 };

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-50 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={handleBackdropClick}
      />

      {/* Morphing overlay card */}
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
        onClick={handleBackdropClick}
      >
        <motion.div
          className="pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-2xl"
          style={{
            width: Math.min(OVERLAY_WIDTH, window.innerWidth - 48),
            height: `${OVERLAY_MAX_HEIGHT_VH}vh`,
          }}
          initial={morphTransform}
          animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, scale: 1, opacity: 1 }}
          exit={morphTransform}
          transition={{
            type: "spring",
            damping: 32,
            stiffness: 380,
            mass: 0.8,
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-foreground/[0.08] px-4 py-2.5">
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-foreground">{fileName}</span>
              <span className="ms-2 truncate text-xs text-muted-foreground/60">{dirPath}</span>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <OpenInEditorButton filePath={filePath} className="!text-muted-foreground/40 hover:!text-muted-foreground" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}>
                  <p className="text-xs">Open in editor</p>
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md
                  text-muted-foreground/40 transition-colors duration-150
                  hover:text-foreground hover:bg-foreground/[0.06]
                  active:scale-90"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Editor content */}
          <div className="relative flex-1 overflow-hidden" style={{ minHeight: 300 }}>
            {loading && (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
              </div>
            )}

            {error && (
              <div className="flex h-full items-center justify-center p-6">
                <p className="text-center text-sm text-muted-foreground/60">{error}</p>
              </div>
            )}

            {content !== null && !loading && (
              <Editor
                height="100%"
                language={monacoLang}
                value={content}
                theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                options={{
                  readOnly: true,
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  lineNumbers: "on",
                  wordWrap: "on",
                  automaticLayout: true,
                  domReadOnly: true,
                  renderLineHighlight: "none",
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                  padding: { top: 8, bottom: 8 },
                }}
                loading={
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
                  </div>
                }
              />
            )}
          </div>

          {/* Footer */}
          {content !== null && !loading && (
            <div className="flex items-center gap-3 border-t border-foreground/[0.08] px-4 py-1.5">
              <span className="text-[11px] text-muted-foreground/50">
                {lineCount} {lineCount === 1 ? "line" : "lines"}
              </span>
              <span className="text-[11px] text-muted-foreground/30">•</span>
              <span className="text-[11px] text-muted-foreground/50">{language}</span>
              <span className="text-[11px] text-muted-foreground/30">•</span>
              <span className="text-[11px] text-muted-foreground/50">{fileSize}</span>
            </div>
          )}
        </motion.div>
      </motion.div>
    </>
  );
});
