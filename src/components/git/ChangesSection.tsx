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
  staged: "bg-emerald-400",
  unstaged: "bg-amber-400",
  untracked: "bg-foreground/40",
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
    <div className="mt-px">
      <div className="group flex items-center gap-1.5 ps-3 pe-1.5 py-0.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-foreground/45" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-foreground/45" />
          )}
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${accentDot}`} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/55">{label}</span>
          <span className="rounded-full bg-foreground/[0.08] px-1.5 py-px text-[10px] font-semibold tabular-nums text-foreground/50">{count}</span>
        </button>
        <div className="flex items-center gap-0.5">
          {onStageAll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onStageAll} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/35 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-300 cursor-pointer transition-colors">
                  <Plus className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left"><p className="text-xs">Stage All</p></TooltipContent>
            </Tooltip>
          )}
          {onUnstageAll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onUnstageAll} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/35 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-300 cursor-pointer transition-colors">
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
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="h-3 w-3 animate-spin text-foreground/35" />
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
