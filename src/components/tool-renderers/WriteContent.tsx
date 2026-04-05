import { lazy, memo, Suspense } from "react";
import type { UIMessage } from "@/types";
import { useResolvedTheme } from "@/hooks/useTheme";
import { getMonacoLanguageFromPath, disableMonacoDiagnostics } from "@/lib/monaco";
import { parseUnifiedDiff } from "@/lib/diff/unified-diff";
import { UnifiedPatchViewer } from "@/components/UnifiedPatchViewer";
import { OpenInEditorButton } from "@/components/OpenInEditorButton";
import {
  getStructuredPatches,
  getPatchPath,
  filterValidPatches,
  isMultiFileStructuredPatch,
  type StructuredPatchEntry,
} from "@/lib/diff/patch-utils";
import { GenericContent } from "./GenericContent";

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((mod) => ({ default: mod.default })),
);

const MIN_EDITOR_HEIGHT_PX = 96;
const MAX_EDITOR_HEIGHT_PX = 512;
const LINE_HEIGHT_PX = 19;
const EDITOR_PADDING_PX = 0;

const MONACO_WRITE_OPTIONS = {
  readOnly: true,
  domReadOnly: true,
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  lineNumbers: "on" as const,
  wordWrap: "on" as const,
  renderLineHighlight: "none" as const,
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 14,
  lineNumbersMinChars: 3,
  links: false,
  contextmenu: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
    alwaysConsumeMouseWheel: false,
  },
  padding: { top: 0, bottom: 0 },
} satisfies Record<string, unknown>;

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function estimateHeight(content: string): number {
  const lines = countLines(content);
  const raw = lines * LINE_HEIGHT_PX + EDITOR_PADDING_PX;
  return Math.max(MIN_EDITOR_HEIGHT_PX, Math.min(MAX_EDITOR_HEIGHT_PX, raw));
}

// ── Multi-file rendering (Codex fileChange where all changes are "add") ──

const PatchEntryWrite = memo(function PatchEntryWrite({ patch }: { patch: StructuredPatchEntry }) {
  const filePath = getPatchPath(patch);

  if (patch.diff) {
    return <UnifiedPatchViewer diffText={patch.diff} filePath={filePath} />;
  }

  if (patch.newString) {
    return <UnifiedPatchViewer diffText={patch.newString} filePath={filePath} />;
  }

  return null;
});

// ── Main component ──

export function WriteContent({ message }: { message: UIMessage }) {
  const resolvedTheme = useResolvedTheme();
  const structuredPatch = getStructuredPatches(message.toolResult);

  // Multi-file Codex fileChange: render each new file separately
  if (isMultiFileStructuredPatch(structuredPatch)) {
    const validPatches = filterValidPatches(structuredPatch);
    if (validPatches.length === 0) return <GenericContent message={message} />;
    return (
      <div className="space-y-2">
        {validPatches.map((patch, i) => (
          <PatchEntryWrite
            key={`${getPatchPath(patch)}-${i}`}
            patch={patch}
          />
        ))}
      </div>
    );
  }

  // Single-file
  const filePath = String(
    message.toolInput?.file_path
      ?? message.toolResult?.filePath
      ?? "",
  );
  const patchDiff = structuredPatch.length > 0 && structuredPatch[0].diff
    ? structuredPatch[0].diff
    : null;
  const hasUnifiedDiff = patchDiff ? parseUnifiedDiff(patchDiff) !== null : false;

  if (hasUnifiedDiff && patchDiff) {
    return <UnifiedPatchViewer diffText={patchDiff} filePath={filePath} />;
  }

  const content = String(
    message.toolInput?.content
      ?? (typeof message.toolResult?.content === "string" ? message.toolResult.content : "")
      ?? "",
  );

  if (!content) return <GenericContent message={message} />;

  const monacoLanguage = getMonacoLanguageFromPath(filePath);
  const lineCount = countLines(content);
  const heightPx = estimateHeight(content);

  return (
    <div className="rounded-lg border border-foreground/[0.06] overflow-hidden font-mono text-[12px] leading-[1.55] bg-muted/55 dark:bg-foreground/[0.06]">
      {/* Header */}
      <div className="group/write flex items-center gap-3 px-3 py-1.5 bg-muted/70 dark:bg-foreground/[0.04]">
        <span className="text-foreground/80 truncate flex-1">{filePath}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-emerald-400/70">+{lineCount}</span>
        <OpenInEditorButton filePath={filePath} className="group-hover/write:text-foreground/25" />
      </div>
      <Suspense
        fallback={
          <div className="flex items-center justify-center text-[11px] text-foreground/35" style={{ height: `${heightPx}px` }}>
            Loading editor
          </div>
        }
      >
        <MonacoEditor
          height={`${heightPx}px`}
          language={monacoLanguage}
          value={content}
          theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
          options={MONACO_WRITE_OPTIONS}
          beforeMount={disableMonacoDiagnostics}
        />
      </Suspense>
    </div>
  );
}
