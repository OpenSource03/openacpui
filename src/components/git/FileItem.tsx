import {
  Plus,
  Minus,
  Undo2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STATUS_COLORS, STATUS_LETTERS } from "./git-panel-utils";
import type { GitFileChange } from "@/types";

export function FileItem({
  file, onStage, onUnstage, onDiscard, onViewDiff, isExpanded,
}: {
  file: GitFileChange;
  onStage?: (f: GitFileChange) => void;
  onUnstage?: (f: GitFileChange) => void;
  onDiscard?: (f: GitFileChange) => void;
  onViewDiff?: (f: GitFileChange) => void;
  isExpanded: boolean;
}) {
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
  const statusColor = STATUS_COLORS[file.status] ?? "text-foreground/40 bg-foreground/[0.06]";
  const statusLetter = STATUS_LETTERS[file.status] ?? "?";

  return (
    <div className={`group flex items-center gap-1.5 pe-2 ps-5 py-[3px] text-[11px] transition-colors hover:bg-foreground/[0.04] ${isExpanded ? "bg-foreground/[0.04]" : ""}`}>
      {/* File name + path — clickable for diff */}
      <button
        type="button"
        onClick={() => onViewDiff?.(file)}
        className="flex min-w-0 flex-1 items-center gap-1.5 truncate cursor-pointer"
        disabled={!onViewDiff}
      >
        <span className="min-w-0 truncate text-foreground/60">{fileName}</span>
        {dirPath && (
          <span className="min-w-0 shrink truncate text-[10px] text-foreground/20">{dirPath}</span>
        )}
        {file.oldPath && (
          <span className="shrink-0 text-[10px] text-foreground/20">← {file.oldPath.split("/").pop()}</span>
        )}
      </button>

      {/* Hover actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {onDiscard && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => onDiscard(file)} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/25 hover:bg-red-500/10 hover:text-red-400/70 cursor-pointer transition-colors">
                <Undo2 className="h-2.5 w-2.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left"><p className="text-xs">Discard</p></TooltipContent>
          </Tooltip>
        )}
        {onStage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => onStage(file)} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/25 hover:bg-emerald-500/10 hover:text-emerald-400/70 cursor-pointer transition-colors">
                <Plus className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left"><p className="text-xs">Stage</p></TooltipContent>
          </Tooltip>
        )}
        {onUnstage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => onUnstage(file)} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/25 hover:bg-amber-500/10 hover:text-amber-400/70 cursor-pointer transition-colors">
                <Minus className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left"><p className="text-xs">Unstage</p></TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Status badge — pinned right */}
      <span className={`flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-0.5 text-[9px] font-bold ${statusColor}`}>
        {statusLetter}
      </span>
    </div>
  );
}
