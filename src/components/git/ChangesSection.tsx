import {
  Plus,
  Minus,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileItem } from "./FileItem";
import { InlineDiff } from "./InlineDiff";
import type { GitFileChange, GitFileGroup } from "@/types";

const SECTION_ACCENT: Record<GitFileGroup, string> = {
  staged: "bg-emerald-400/70",
  unstaged: "bg-amber-400/70",
  untracked: "bg-foreground/30",
};

export interface ChangesSectionProps {
  label: string;
  count: number;
  group: GitFileGroup;
  files: GitFileChange[];
  expanded: boolean;
  onToggle: () => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onStage?: (file: GitFileChange) => void;
  onUnstage?: (file: GitFileChange) => void;
  onDiscard?: (file: GitFileChange) => void;
  onViewDiff?: (file: GitFileChange) => void;
  expandedDiff: string | null;
  diffContent: string | null;
}

export function ChangesSection({
  label, count, group, files, expanded, onToggle,
  onStageAll, onUnstageAll, onStage, onUnstage, onDiscard, onViewDiff,
  expandedDiff, diffContent,
}: ChangesSectionProps) {
  const accentDot = SECTION_ACCENT[group] ?? "bg-foreground/30";

  return (
    <div className="mt-0.5">
      <div className="group flex items-center gap-1.5 px-3 py-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-foreground/30" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-foreground/30" />
          )}
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${accentDot}`} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/40">{label}</span>
          <span className="rounded-full bg-foreground/[0.06] px-1.5 py-px text-[10px] font-medium tabular-nums text-foreground/30">{count}</span>
        </button>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {onStageAll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onStageAll} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/25 hover:bg-foreground/[0.06] hover:text-emerald-400/70 cursor-pointer transition-colors">
                  <Plus className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left"><p className="text-xs">Stage All</p></TooltipContent>
            </Tooltip>
          )}
          {onUnstageAll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onUnstageAll} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/25 hover:bg-foreground/[0.06] hover:text-amber-400/70 cursor-pointer transition-colors">
                  <Minus className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left"><p className="text-xs">Unstage All</p></TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      {expanded && (
        <div className="pb-0.5">
          {files.map((file) => {
            const diffKey = `${group}:${file.path}`;
            const isExpanded = expandedDiff === diffKey;
            return (
              <div key={file.path}>
                <FileItem file={file} onStage={onStage} onUnstage={onUnstage} onDiscard={onDiscard} onViewDiff={onViewDiff} isExpanded={isExpanded} />
                {isExpanded && diffContent !== null && <InlineDiff diff={diffContent} />}
                {isExpanded && diffContent === null && (
                  <div className="flex items-center justify-center py-2.5">
                    <Loader2 className="h-3 w-3 animate-spin text-foreground/20" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
