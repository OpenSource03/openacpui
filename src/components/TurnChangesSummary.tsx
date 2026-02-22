import { memo, useState, useMemo } from "react";
import { FileDiff, Pencil, Plus, ChevronRight, ArrowRight } from "lucide-react";
import type { TurnSummary } from "@/lib/turn-changes";

// ── Color/icon mapping (matches FilesPanel conventions) ──

const CHANGE_ICON = { modified: Pencil, created: Plus } as const;
const CHANGE_COLOR = { modified: "text-amber-400", created: "text-emerald-400" } as const;

interface TurnChangesSummaryProps {
  summary: TurnSummary;
  onViewInPanel?: (turnIndex: number) => void;
}

export const TurnChangesSummary = memo(function TurnChangesSummary({
  summary,
  onViewInPanel,
}: TurnChangesSummaryProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Deduplicate files: keep highest-priority change type per path (created > modified)
  const uniqueFiles = useMemo(() => {
    const map = new Map<string, { fileName: string; changeType: "modified" | "created" }>();
    for (const c of summary.changes) {
      const existing = map.get(c.filePath);
      if (!existing || (c.changeType === "created" && existing.changeType === "modified")) {
        map.set(c.filePath, { fileName: c.fileName, changeType: c.changeType });
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

  return (
    <div className="mx-4 my-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
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

      {/* Expanded: file list + view button */}
      {isOpen && (
        <div className="mt-1 rounded-lg border border-border/30 bg-muted/20 px-3 py-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex flex-col gap-1.5">
            {uniqueFiles.map((file) => {
              const Icon = CHANGE_ICON[file.changeType];
              const color = CHANGE_COLOR[file.changeType];
              return (
                <div key={file.fileName} className="flex items-center gap-2 text-xs">
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} strokeWidth={2} />
                  <span className="truncate text-foreground/70">{file.fileName}</span>
                  <span className="text-muted-foreground/40 capitalize text-[10px]">
                    {file.changeType === "created" ? "new" : "modified"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* "View changes" button */}
          {onViewInPanel && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onViewInPanel(summary.turnIndex);
              }}
              className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-foreground/80 cursor-pointer"
            >
              <span>View changes</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});
