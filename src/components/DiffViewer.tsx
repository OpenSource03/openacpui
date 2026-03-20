import { lazy, memo, Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { OpenInEditorButton } from "./OpenInEditorButton";
import { useResolvedThemeClass } from "@/hooks/useResolvedThemeClass";
import { copyToClipboard } from "@/lib/clipboard";
import { useChatIsScrolling } from "@/components/chat-ui-state";
import { getMonacoLanguageFromPath } from "@/lib/monaco";
import { parseUnifiedDiffFromUnknown } from "@/lib/unified-diff";

const MonacoDiffEditor = lazy(() =>
  import("@monaco-editor/react").then((mod) => ({ default: mod.DiffEditor })),
);

interface DiffViewerProps {
  oldString: string;
  newString: string;
  filePath: string;
  unifiedDiff?: string;
  /** Fill parent height instead of capping at max-h */
  fillHeight?: boolean;
}

interface DiffDocuments {
  original: string;
  modified: string;
}

interface DiffStats {
  added: number;
  removed: number;
}

const FULL_FILE_CACHE_LIMIT = 64;
const DIFF_HEIGHT_CACHE_LIMIT = 128;
const MIN_EDITOR_HEIGHT_PX = 96;
const MAX_EDITOR_HEIGHT_PX = 720;
const MONACO_DIFF_OPTIONS = {
  readOnly: true,
  domReadOnly: true,
  originalEditable: false,
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  lineNumbers: "on" as const,
  wordWrap: "on" as const,
  diffWordWrap: "on" as const,
  renderLineHighlight: "none" as const,
  renderOverviewRuler: false,
  renderIndicators: false,
  renderMarginRevertIcon: false,
  glyphMargin: false,
  folding: false,
  links: false,
  contextmenu: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  useInlineViewWhenSpaceIsLimited: true,
  renderSideBySide: false,
  hideUnchangedRegions: {
    enabled: true,
    contextLineCount: 3,
    minimumLineCount: 4,
    revealLineCount: 3,
  },
  maxComputationTime: 1000,
  ignoreTrimWhitespace: false,
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
    alwaysConsumeMouseWheel: false,
  },
  padding: { top: 8, bottom: 8 },
} satisfies Record<string, unknown>;

const fullFileContentCache = new Map<string, string | null>();
const fullFileContentRequests = new Map<string, Promise<string | null>>();
const measuredDiffHeightCache = new Map<string, number>();
let nextDiffViewerInstanceId = 0;

interface MonacoDisposableLike {
  dispose(): void;
}

interface MonacoTextModelLike extends MonacoDisposableLike {}

interface MonacoUriLike {}

interface MonacoLike {
  Uri: {
    parse(path: string): MonacoUriLike;
  };
  editor: {
    getModel(uri: MonacoUriLike): MonacoTextModelLike | null;
  };
}

interface MonacoCodeEditorLike {
  getContentHeight(): number;
  onDidContentSizeChange(listener: () => void): MonacoDisposableLike;
}

interface MonacoDiffEditorLike {
  getOriginalEditor(): MonacoCodeEditorLike;
  getModifiedEditor(): MonacoCodeEditorLike;
  onDidUpdateDiff(listener: () => void): MonacoDisposableLike;
}

function setCachedMeasuredDiffHeight(cacheKey: string, heightPx: number) {
  if (measuredDiffHeightCache.has(cacheKey)) {
    measuredDiffHeightCache.delete(cacheKey);
  }
  measuredDiffHeightCache.set(cacheKey, heightPx);
  if (measuredDiffHeightCache.size > DIFF_HEIGHT_CACHE_LIMIT) {
    const oldestKey = measuredDiffHeightCache.keys().next().value;
    if (oldestKey !== undefined) {
      measuredDiffHeightCache.delete(oldestKey);
    }
  }
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildDiffHeightCacheKey(
  filePath: string,
  oldString: string,
  newString: string,
  unifiedDiff: string | undefined,
): string {
  return [
    filePath,
    hashString(oldString).toString(36),
    hashString(newString).toString(36),
    hashString(unifiedDiff ?? "").toString(36),
  ].join(":");
}

function clampEditorHeight(heightPx: number): number {
  return Math.max(MIN_EDITOR_HEIGHT_PX, Math.min(MAX_EDITOR_HEIGHT_PX, Math.ceil(heightPx)));
}

function createDiffViewerInstanceId(): string {
  nextDiffViewerInstanceId += 1;
  return `diff-${nextDiffViewerInstanceId}`;
}

function buildDiffModelPath(filePath: string, instanceId: string, side: "original" | "modified"): string {
  return `inmemory://harnss-diff/${instanceId}/${side}/${encodeURIComponent(filePath || "untitled")}`;
}

function disposeMonacoModel(monaco: MonacoLike, modelPath: string) {
  try {
    monaco.editor.getModel(monaco.Uri.parse(modelPath))?.dispose();
  } catch {
    // Monaco may already have cleared the model during HMR or editor teardown.
  }
}

function setCachedFullFileContent(filePath: string, content: string | null) {
  if (fullFileContentCache.has(filePath)) {
    fullFileContentCache.delete(filePath);
  }
  fullFileContentCache.set(filePath, content);
  if (fullFileContentCache.size > FULL_FILE_CACHE_LIMIT) {
    const oldestKey = fullFileContentCache.keys().next().value;
    if (oldestKey !== undefined) {
      fullFileContentCache.delete(oldestKey);
    }
  }
}

async function loadFullFileContent(filePath: string): Promise<string | null> {
  if (fullFileContentCache.has(filePath)) {
    return fullFileContentCache.get(filePath) ?? null;
  }

  const pending = fullFileContentRequests.get(filePath);
  if (pending) return pending;

  const request = window.claude
    .readFile(filePath)
    .then((result) => {
      const content = result.content ?? null;
      setCachedFullFileContent(filePath, content);
      return content;
    })
    .catch(() => {
      setCachedFullFileContent(filePath, null);
      return null;
    })
    .finally(() => {
      fullFileContentRequests.delete(filePath);
    });

  fullFileContentRequests.set(filePath, request);
  return request;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function parseUnifiedDiffStats(diffText: string): DiffStats | null {
  if (!diffText) return null;

  const parsed = parseUnifiedDiffFromUnknown(diffText);
  if (!parsed) return null;

  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  let inHunk = false;
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      inHunk = false;
      continue;
    }
    if (line === "\\ No newline at end of file") continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }

  if (added === 0 && removed === 0) return null;
  return { added, removed };
}

function reconstructDocuments(
  fileContent: string,
  oldString: string,
  newString: string,
): DiffDocuments | null {
  if (!oldString && !newString) return null;

  const newIndex = newString ? fileContent.indexOf(newString) : -1;
  if (newIndex !== -1) {
    return {
      original: fileContent.slice(0, newIndex) + oldString + fileContent.slice(newIndex + newString.length),
      modified: fileContent,
    };
  }

  const oldIndex = oldString ? fileContent.indexOf(oldString) : -1;
  if (oldIndex !== -1) {
    return {
      original: fileContent,
      modified: fileContent.slice(0, oldIndex) + newString + fileContent.slice(oldIndex + oldString.length),
    };
  }

  return null;
}

function resolveDiffDocuments(
  oldString: string,
  newString: string,
  unifiedDiff: string | undefined,
  fullFileContent: string | null,
): DiffDocuments {
  if (unifiedDiff) {
    const parsed = parseUnifiedDiffFromUnknown(unifiedDiff);
    if (parsed) {
      return {
        original: parsed.oldString,
        modified: parsed.newString,
      };
    }
  }

  if (fullFileContent !== null) {
    const reconstructed = reconstructDocuments(fullFileContent, oldString, newString);
    if (reconstructed) return reconstructed;
  }

  return {
    original: oldString,
    modified: newString,
  };
}

function deriveStats(
  unifiedDiff: string | undefined,
  documents: DiffDocuments,
): DiffStats | null {
  const fromUnifiedDiff = unifiedDiff ? parseUnifiedDiffStats(unifiedDiff) : null;
  if (fromUnifiedDiff) return fromUnifiedDiff;
  if (!documents.original && documents.modified) {
    return { added: countLines(documents.modified), removed: 0 };
  }
  if (documents.original && !documents.modified) {
    return { added: 0, removed: countLines(documents.original) };
  }
  return null;
}

function estimateEditorHeight(
  documents: DiffDocuments,
  stats: DiffStats | null,
  fillHeight?: boolean,
): number | null {
  if (fillHeight) return null;

  const lineCount = stats
    ? Math.max(5, Math.min(36, stats.added + stats.removed + 4))
    : Math.max(5, Math.min(40, Math.max(countLines(documents.original), countLines(documents.modified))));

  return clampEditorHeight(lineCount * 19 + 28);
}

function measureEditorHeight(editor: MonacoDiffEditorLike): number {
  // In inline diff mode the original editor is hidden — its getContentHeight()
  // returns the full uncollapsed document height, ignoring hideUnchangedRegions.
  // Only the modified editor reflects the actual rendered (collapsed) height.
  return clampEditorHeight(editor.getModifiedEditor().getContentHeight());
}

function DiffBodyPlaceholder({
  heightPx,
  fillHeight,
  label,
}: {
  heightPx: number | null;
  fillHeight?: boolean;
  label: string;
}) {
  const style = fillHeight
    ? undefined
    : { height: `${heightPx ?? MIN_EDITOR_HEIGHT_PX}px` };

  return (
    <div
      className={fillHeight ? "flex h-full min-h-0 flex-col" : "flex flex-col"}
      style={style}
    >
      <div className="flex flex-1 items-center justify-center px-3 py-6 text-[11px] text-foreground/35">
        <span>{label}</span>
      </div>
    </div>
  );
}

// Monaco's diff computation is debounced (~200ms) and hideUnchangedRegions
// applies hidden areas asynchronously after the diff completes.  A single rAF
// measurement almost always fires before hidden regions are in place, producing
// the full-document height.  Schedule a short burst of re-measurements so the
// final rAF captures the correct collapsed height.
const MEASURE_SETTLE_DELAYS_MS = [50, 150, 350] as const;

export const DiffViewer = memo(function DiffViewer({
  oldString,
  newString,
  filePath,
  unifiedDiff,
  fillHeight,
}: DiffViewerProps) {
  const isChatScrolling = useChatIsScrolling();
  const [hydrated, setHydrated] = useState(() => !isChatScrolling);
  const [fullFileContent, setFullFileContent] = useState<string | null>(() =>
    !filePath || unifiedDiff
      ? null
      : (fullFileContentCache.get(filePath) ?? null),
  );
  const [copied, setCopied] = useState(false);
  const resolvedTheme = useResolvedThemeClass();
  const editorRef = useRef<MonacoDiffEditorLike | null>(null);
  const monacoRef = useRef<MonacoLike | null>(null);
  const measureFrameRef = useRef<number | null>(null);
  const settleTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const editorSubscriptionsRef = useRef<MonacoDisposableLike[]>([]);
  const instanceIdRef = useRef<string>(createDiffViewerInstanceId());

  const fileName = filePath.split("/").pop() ?? filePath;
  const monacoLanguage = getMonacoLanguageFromPath(filePath);
  const diffHeightCacheKey = useMemo(
    () => buildDiffHeightCacheKey(filePath, oldString, newString, unifiedDiff),
    [filePath, newString, oldString, unifiedDiff],
  );
  const modelPaths = useMemo(() => ({
    original: buildDiffModelPath(filePath, instanceIdRef.current, "original"),
    modified: buildDiffModelPath(filePath, instanceIdRef.current, "modified"),
  }), [filePath]);

  useEffect(() => {
    if (hydrated || isChatScrolling) return;
    const frame = window.requestAnimationFrame(() => {
      startTransition(() => {
        setHydrated(true);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hydrated, isChatScrolling]);

  useEffect(() => {
    if (!filePath || unifiedDiff) {
      setFullFileContent(null);
      return;
    }

    setFullFileContent(fullFileContentCache.get(filePath) ?? null);
  }, [filePath, unifiedDiff]);

  useEffect(() => {
    if (!hydrated) return;
    if (!filePath || unifiedDiff) return;
    if (fullFileContentCache.has(filePath)) return;

    let cancelled = false;
    loadFullFileContent(filePath)
      .then((result) => {
        if (!cancelled) {
          setFullFileContent(result);
        }
      })
      .catch(() => {
        // loadFullFileContent caches failures as null
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, hydrated, unifiedDiff]);

  const documents = useMemo(
    () => resolveDiffDocuments(oldString, newString, unifiedDiff, fullFileContent),
    [fullFileContent, newString, oldString, unifiedDiff],
  );
  const stats = useMemo(
    () => deriveStats(unifiedDiff, documents),
    [documents, unifiedDiff],
  );
  const estimatedEditorHeightPx = useMemo(
    () => estimateEditorHeight(documents, stats, fillHeight),
    [documents, fillHeight, stats],
  );
  const [editorHeightPx, setEditorHeightPx] = useState<number | null>(() =>
    fillHeight
      ? null
      : (measuredDiffHeightCache.get(diffHeightCacheKey) ?? estimatedEditorHeightPx),
  );

  useEffect(() => {
    if (fillHeight) {
      setEditorHeightPx(null);
      return;
    }

    const cachedHeight = measuredDiffHeightCache.get(diffHeightCacheKey);
    const nextHeight = cachedHeight ?? estimatedEditorHeightPx;
    setEditorHeightPx((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight);
  }, [diffHeightCacheKey, estimatedEditorHeightPx, fillHeight]);

  const commitMeasuredHeight = useCallback((nextHeight: number) => {
    if (fillHeight) return;
    const clampedHeight = clampEditorHeight(nextHeight);
    setCachedMeasuredDiffHeight(diffHeightCacheKey, clampedHeight);
    setEditorHeightPx((currentHeight) => currentHeight === clampedHeight ? currentHeight : clampedHeight);
  }, [diffHeightCacheKey, fillHeight]);

  // Cancel any pending rAF — the next scheduled one should always win so we
  // never measure stale intermediate state.
  const cancelPendingMeasure = useCallback(() => {
    if (measureFrameRef.current !== null) {
      window.cancelAnimationFrame(measureFrameRef.current);
      measureFrameRef.current = null;
    }
  }, []);

  const measureNow = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextHeight = measureEditorHeight(editor);
    commitMeasuredHeight(nextHeight);
  }, [commitMeasuredHeight]);

  // Schedule a measurement on the next animation frame.
  // Unlike the previous implementation that silently dropped requests when a
  // rAF was already pending, this always cancels-and-reschedules so the LAST
  // caller wins.  This is critical because Monaco fires onDidContentSizeChange
  // multiple times as hidden areas and view zones settle — only the final
  // measurement reflects the true collapsed height.
  const scheduleEditorMeasurement = useCallback(() => {
    if (fillHeight) return;
    cancelPendingMeasure();

    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = null;
      startTransition(() => {
        measureNow();
      });
    });
  }, [cancelPendingMeasure, fillHeight, measureNow]);

  const cancelSettleTimers = useCallback(() => {
    for (const timer of settleTimersRef.current) {
      clearTimeout(timer);
    }
    settleTimersRef.current = [];
  }, []);

  // Schedule a burst of delayed re-measurements to catch the correct height
  // after Monaco's debounced diff computation (~200ms) and subsequent
  // hideUnchangedRegions + view-zone settling.  Each delayed measurement only
  // commits if the height actually changed, so redundant measurements are
  // practically free (no React re-render).
  const scheduleSettleMeasurements = useCallback(() => {
    if (fillHeight) return;
    cancelSettleTimers();

    settleTimersRef.current = MEASURE_SETTLE_DELAYS_MS.map((delayMs) =>
      setTimeout(() => {
        startTransition(() => {
          measureNow();
        });
      }, delayMs),
    );
  }, [cancelSettleTimers, fillHeight, measureNow]);

  const handleEditorMount = useCallback((editor: MonacoDiffEditorLike, monaco: MonacoLike) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editorSubscriptionsRef.current.forEach((subscription) => subscription.dispose());
    editorSubscriptionsRef.current = [
      editor.getOriginalEditor().onDidContentSizeChange(scheduleEditorMeasurement),
      editor.getModifiedEditor().onDidContentSizeChange(scheduleEditorMeasurement),
      // When the diff result arrives, hideUnchangedRegions will apply hidden
      // areas asynchronously.  Schedule both an immediate rAF and a settle
      // burst to guarantee we capture the final collapsed height.
      editor.onDidUpdateDiff(() => {
        scheduleEditorMeasurement();
        scheduleSettleMeasurements();
      }),
    ];

    scheduleEditorMeasurement();
    // The initial diff computation is debounced; schedule settle measurements
    // to capture the height once hidden regions are applied.
    scheduleSettleMeasurements();
  }, [scheduleEditorMeasurement, scheduleSettleMeasurements]);

  useEffect(() => {
    if (!hydrated || fillHeight) return;
    scheduleEditorMeasurement();
    // Documents changed (e.g. full-file content loaded) — the models will be
    // updated via setValue which triggers a debounced re-diff.  Schedule settle
    // measurements to capture the post-diff collapsed height.
    scheduleSettleMeasurements();
  }, [documents, fillHeight, hydrated, scheduleEditorMeasurement, scheduleSettleMeasurements]);

  useEffect(() => () => {
    cancelPendingMeasure();
    cancelSettleTimers();
    editorSubscriptionsRef.current.forEach((subscription) => subscription.dispose());
    editorSubscriptionsRef.current = [];
    const monaco = monacoRef.current;
    const originalModelPath = modelPaths.original;
    const modifiedModelPath = modelPaths.modified;
    if (monaco) {
      window.setTimeout(() => {
        disposeMonacoModel(monaco, originalModelPath);
        disposeMonacoModel(monaco, modifiedModelPath);
      }, 0);
    }
    editorRef.current = null;
    monacoRef.current = null;
  }, [cancelPendingMeasure, cancelSettleTimers, modelPaths]);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(documents.modified);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [documents.modified]);

  return (
    <div className={`w-full min-w-0 overflow-hidden font-mono text-[12px] leading-[1.55] bg-muted/55 dark:bg-foreground/[0.06] ${
      fillHeight ? "flex h-full flex-col" : "rounded-lg border border-border/50"
    }`}>
      <div className="group/diff flex items-center gap-3 border-b border-border/40 bg-muted/70 px-3 py-1.5 dark:bg-foreground/[0.04] shrink-0">
        <span className="flex-1 truncate text-foreground/80">{fileName}</span>
        <OpenInEditorButton filePath={filePath} className="group-hover/diff:text-foreground/25" />

        {stats && (
          <div className="flex items-center gap-1.5 text-[11px] shrink-0 tabular-nums">
            {stats.added > 0 && (
              <span className="text-emerald-700 dark:text-emerald-400">+{stats.added}</span>
            )}
            {stats.removed > 0 && (
              <span className="text-red-700 dark:text-red-400">-{stats.removed}</span>
            )}
          </div>
        )}

        <button
          onClick={handleCopy}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-accent/30 hover:text-muted-foreground/80"
          title="Copy new content"
          type="button"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div className={fillHeight ? "min-h-0 flex-1 overflow-hidden" : "overflow-hidden"}>
        {!hydrated ? (
          <DiffBodyPlaceholder
            heightPx={editorHeightPx}
            fillHeight={fillHeight}
            label="Preparing diff"
          />
        ) : (
          <Suspense
            fallback={
              <DiffBodyPlaceholder
                heightPx={editorHeightPx}
                fillHeight={fillHeight}
                label="Loading Monaco diff"
              />
            }
          >
            <MonacoDiffEditor
              height={fillHeight ? "100%" : `${editorHeightPx ?? MIN_EDITOR_HEIGHT_PX}px`}
              language={monacoLanguage}
              original={documents.original}
              modified={documents.modified}
              originalModelPath={modelPaths.original}
              modifiedModelPath={modelPaths.modified}
              keepCurrentOriginalModel
              keepCurrentModifiedModel
              theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
              options={MONACO_DIFF_OPTIONS}
              onMount={handleEditorMount}
              loading={
                <DiffBodyPlaceholder
                  heightPx={editorHeightPx}
                  fillHeight={fillHeight}
                  label="Loading Monaco diff"
                />
              }
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}, (prev, next) =>
  prev.oldString === next.oldString
  && prev.newString === next.newString
  && prev.filePath === next.filePath
  && prev.unifiedDiff === next.unifiedDiff
  && prev.fillHeight === next.fillHeight,
);
