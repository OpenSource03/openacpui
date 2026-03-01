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
  return (
    <div>
      <div className="group flex items-center px-2 py-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-medium text-foreground/45 cursor-pointer"
        >
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span>{label}</span>
          <span className="ms-1 rounded-full bg-foreground/[0.06] px-1.5 text-[10px] text-foreground/30">{count}</span>
        </button>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {onStageAll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onStageAll} className="flex h-4 w-4 items-center justify-center rounded text-foreground/30 hover:text-foreground/60 cursor-pointer">
                  <Plus className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left"><p className="text-xs">Stage All</p></TooltipContent>
            </Tooltip>
          )}
          {onUnstageAll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onUnstageAll} className="flex h-4 w-4 items-center justify-center rounded text-foreground/30 hover:text-foreground/60 cursor-pointer">
                  <Minus className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left"><p className="text-xs">Unstage All</p></TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      {expanded && (
        <div className="pb-1">
          {files.map((file) => {
            const diffKey = `${group}:${file.path}`;
            const isExpanded = expandedDiff === diffKey;
            return (
              <div key={file.path}>
                <FileItem file={file} onStage={onStage} onUnstage={onUnstage} onDiscard={onDiscard} onViewDiff={onViewDiff} isExpanded={isExpanded} />
                {isExpanded && diffContent !== null && <InlineDiff diff={diffContent} />}
                {isExpanded && diffContent === null && (
                  <div className="flex items-center justify-center py-2">
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
