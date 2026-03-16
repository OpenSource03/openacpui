import { memo, useState, useMemo, useCallback } from "react";
import { FileDiff, Pencil, Plus, ChevronRight, ChevronDown } from "lucide-react";
import { DiffViewer } from "./DiffViewer";
import { OpenInEditorButton } from "./OpenInEditorButton";
import type { TurnSummary, FileChange } from "@/lib/turn-changes";

// ── Color/icon mapping (matches FilesPanel conventions) ──

const CHANGE_ICON = { modified: Pencil, created: Plus } as const;
const CHANGE_COLOR = { modified: "text-amber-400", created: "text-emerald-400" } as const;

// ── Inline file change viewer ──

/** Renders a single file change inline — diff for Edit, content preview for Write/NotebookEdit. */
const InlineFileChange = memo(function InlineFileChange({
  change,
  isExpanded,
  onToggle,
}: {
  change: FileChange;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const Icon = CHANGE_ICON[change.changeType];
  const color = CHANGE_COLOR[change.changeType];
  // Show directory path for context
  const dirParts = change.filePath.split("/");
  const dir = dirParts.length > 1 ? dirParts.slice(0, -1).join("/") + "/" : "";

  return (
    <div className="rounded-md border border-border/30 overflow-hidden">
      {/* File row — clickable to expand/collapse */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-xs transition-colors cursor-pointer hover:bg-foreground/[0.03] group"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
        )}
        <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} strokeWidth={2} />
        <span className="flex-1 min-w-0 truncate">
          <span className="font-medium text-foreground/80">{change.fileName}</span>
          {dir && (
            <span className="ms-1 text-muted-foreground/40 text-[10px]">{dir}</span>
          )}
        </span>
        <span className="text-muted-foreground/40 capitalize text-[10px] shrink-0">
          {change.changeType === "created" ? "new" : "modified"}
        </span>
        <OpenInEditorButton
          filePath={change.filePath}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        />
      </button>

      {/* Expanded: show diff or content */}
      {isExpanded && (
        <div className="border-t border-border/20">
          {change.toolName === "Edit" ? (
            <DiffViewer
              oldString={change.oldString ?? ""}
              newString={change.newString ?? ""}
              filePath={change.filePath}
              unifiedDiff={change.unifiedDiff}
            />
          ) : (
            /* Write / NotebookEdit — show content as added text */
            change.content ? (
              <DiffViewer
                oldString=""
                newString={change.content}
                filePath={change.filePath}
              />
            ) : (
              <div className="px-3 py-2 text-xs text-muted-foreground/50 italic">
                Empty file
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
});

// ── Main component ──

interface TurnChangesSummaryProps {
  summary: TurnSummary;
}

export const TurnChangesSummary = memo(function TurnChangesSummary({
  summary,
}: TurnChangesSummaryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => new Set());

  // Deduplicate files: keep highest-priority change type per path (created > modified),
  // but preserve the full FileChange data for rendering diffs
  const uniqueFiles = useMemo(() => {
    const map = new Map<string, FileChange>();
    for (const c of summary.changes) {
      const existing = map.get(c.filePath);
      if (!existing || (c.changeType === "created" && existing.changeType === "modified")) {
        map.set(c.filePath, c);
      }
    }
    return [...map.values()];
  }, [summary.changes]);

  // Compact file name list for collapsed view (truncate if > 3 files)
  const compactFileList = useMemo(() => {
    const names = uniqueFiles.map((f) => f.fileName);
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
  }, [uniqueFiles]);

  // Stats text: "2 modified · 1 new"
  const statsText = useMemo(() => {
    const parts: string[] = [];
    if (summary.modifiedCount > 0) parts.push(`${summary.modifiedCount} modified`);
    if (summary.createdCount > 0) parts.push(`${summary.createdCount} new`);
    return parts.join(" · ");
  }, [summary.modifiedCount, summary.createdCount]);

  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  return (
    <div className="flow-root mx-4 my-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
      {/* Collapsed header bar */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-start text-sm text-muted-foreground transition-colors hover:bg-muted/50 cursor-pointer"
      >
        <FileDiff className="h-4 w-4 shrink-0 text-muted-foreground/70" />

        <span className="flex-1 min-w-0 truncate">
          <span className="font-medium text-foreground/80">
            {summary.fileCount} file{summary.fileCount !== 1 ? "s" : ""} changed
          </span>
          <span className="ms-1.5 text-xs text-muted-foreground/60">
            {compactFileList}
          </span>
        </span>

        {/* Stats pill */}
        <span className="shrink-0 text-xs text-muted-foreground/50">
          {statsText}
        </span>

        <ChevronRight
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
        />
      </button>

      {/* Expanded: file list with inline diffs */}
      {isOpen && (
        <div className="mt-1 rounded-lg border border-border/30 bg-muted/20 p-2 animate-in fade-in slide-in-from-top-1 duration-200 flex flex-col gap-1.5">
          {uniqueFiles.map((change) => (
            <InlineFileChange
              key={`${change.filePath}::${change.messageId}`}
              change={change}
              isExpanded={expandedFiles.has(change.filePath)}
              onToggle={() => toggleFile(change.filePath)}
            />
          ))}
        </div>
      )}
    </div>
  );
});
