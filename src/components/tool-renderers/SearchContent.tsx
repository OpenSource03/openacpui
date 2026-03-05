import { FileText } from "lucide-react";
import type { UIMessage } from "@/types";
import { formatResult } from "@/components/lib/tool-formatting";

/** Structured fields that the SDK's Grep/Glob tool can return. */
interface GrepResultFields {
  mode: string;
  filenames: string[];
  numFiles: number;
  numLines?: number;
}

function hasGrepFields(result: UIMessage["toolResult"]): result is NonNullable<UIMessage["toolResult"]> & GrepResultFields {
  return !!result && "mode" in result && typeof (result as GrepResultFields).mode === "string";
}

/** Shorten an absolute or deep relative path to its last 2-3 segments. */
function shortenPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 3) return filePath;
  return parts.slice(-3).join("/");
}

// ── Subcomponents ──

function FilesMatchList({ filenames }: { filenames: string[] }) {
  return (
    <div className="rounded-md border border-foreground/[0.06] overflow-hidden">
      {filenames.map((file, i) => (
        <div
          key={file}
          className={`flex items-center gap-2 px-3 py-1 text-[11px] ${
            i > 0 ? "border-t border-foreground/[0.06]" : ""
          }`}
        >
          <FileText className="h-3 w-3 shrink-0 text-foreground/20" />
          <span className="truncate text-foreground/50 font-mono" title={file}>
            {shortenPath(file)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ContentResult({ content, numLines }: { content: string; numLines?: number }) {
  if (!content) return null;

  // Parse lines to identify match lines (with :lineNum:) vs context (with -lineNum-)
  const lines = content.split("\n");

  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-foreground/[0.04] px-3 py-2 text-[11px] whitespace-pre-wrap wrap-break-word">
      {lines.map((line, i) => {
        // Separator between blocks
        if (line === "--") {
          return (
            <div key={i} className="text-foreground/15 my-0.5 border-t border-foreground/[0.06]" />
          );
        }
        // Match lines contain a : after the line number (e.g. "file.ts:42:  matched text")
        const isMatch = /^[^-]*:\d+:/.test(line) || /^\d+:/.test(line);
        return (
          <div key={i} className={isMatch ? "text-foreground/70" : "text-foreground/35"}>
            {line}
          </div>
        );
      })}
      {numLines != null && numLines > 0 && (
        <div className="mt-1 text-[10px] text-foreground/25">
          {numLines} line{numLines !== 1 ? "s" : ""}
        </div>
      )}
    </pre>
  );
}

// ── Main component ──

export function SearchContent({ message }: { message: UIMessage }) {
  const pattern = String(message.toolInput?.pattern ?? "");
  const glob = message.toolInput?.glob ? String(message.toolInput.glob) : "";
  const path = message.toolInput?.path ? String(message.toolInput.path) : "";
  const result = message.toolResult;

  // Header: pattern + scope
  const header = (
    <>
      {pattern && (
        <div className="font-mono text-[11px] text-foreground/50">
          {pattern}
          {glob && <span className="text-foreground/30 ms-1.5">in {glob}</span>}
          {!glob && path && <span className="text-foreground/30 ms-1.5">in {shortenPath(path)}</span>}
        </div>
      )}
    </>
  );

  // Structured Grep/Glob result (SDK engine)
  if (hasGrepFields(result)) {
    const { mode, filenames, numFiles } = result;
    const content = typeof result.content === "string" ? result.content : "";
    const numLines = "numLines" in result ? Number(result.numLines) : undefined;

    return (
      <div className="space-y-1.5 text-xs">
        {header}

        {/* Summary badge */}
        {mode === "files_with_matches" && numFiles > 0 && (
          <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium">
            {numFiles} file{numFiles !== 1 ? "s" : ""}
          </span>
        )}
        {mode === "content" && numLines != null && numLines > 0 && numFiles > 0 && (
          <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium">
            {numLines} line{numLines !== 1 ? "s" : ""} in {numFiles} file{numFiles !== 1 ? "s" : ""}
          </span>
        )}
        {mode === "content" && numLines != null && numLines > 0 && numFiles === 0 && (
          <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium">
            {numLines} line{numLines !== 1 ? "s" : ""}
          </span>
        )}
        {(mode === "files_with_matches" || mode === "content" || mode === "count") && numFiles === 0 && !content && (
          <span className="text-[10px] text-foreground/30 italic">No matches</span>
        )}

        {/* File list for files_with_matches mode */}
        {mode === "files_with_matches" && filenames.length > 0 && (
          <FilesMatchList filenames={filenames} />
        )}

        {/* Content output for content mode */}
        {mode === "content" && content && (
          <ContentResult content={content} />
        )}

        {/* Count mode — just show count text if we have content */}
        {mode === "count" && content && (
          <pre className="max-h-32 overflow-auto rounded-md bg-foreground/[0.04] px-3 py-2 text-[11px] text-foreground/50 whitespace-pre-wrap wrap-break-word">
            {content}
          </pre>
        )}
      </div>
    );
  }

  // Fallback: legacy stdout-based result (ACP or older SDK)
  const formattedResult = result ? formatResult(result) : "";

  return (
    <div className="space-y-1.5 text-xs">
      {header}
      {formattedResult && (
        <pre className="max-h-48 overflow-auto rounded-md bg-foreground/[0.04] px-3 py-2 text-[11px] text-foreground/50 whitespace-pre-wrap wrap-break-word">
          {formattedResult}
        </pre>
      )}
    </div>
  );
}
