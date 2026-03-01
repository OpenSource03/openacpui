import {
  Plus,
  Minus,
  Undo2,
  FileText,
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
    <div className={`group flex items-center gap-1.5 px-3 py-[3px] text-[11px] transition-colors hover:bg-foreground/[0.04] ${isExpanded ? "bg-foreground/[0.03]" : ""}`}>
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold ${statusColor}`}>
        {statusLetter}
      </span>
      <button
        type="button"
        onClick={() => onViewDiff?.(file)}
        className="flex min-w-0 flex-1 items-baseline gap-1 truncate cursor-pointer"
        disabled={!onViewDiff}
      >
        <FileText className="h-3 w-3 shrink-0 self-center text-foreground/20" />
        <span className="truncate text-foreground/65">{fileName}</span>
        {dirPath && <span className="truncate text-[10px] text-foreground/25">{dirPath}</span>}
        {file.oldPath && (
          <span className="truncate text-[10px] text-foreground/25">&larr; {file.oldPath.split("/").pop()}</span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {onDiscard && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => onDiscard(file)} className="flex h-4 w-4 items-center justify-center rounded text-foreground/25 hover:text-red-400/60 cursor-pointer">
                <Undo2 className="h-2.5 w-2.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left"><p className="text-xs">Discard</p></TooltipContent>
          </Tooltip>
        )}
        {onStage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => onStage(file)} className="flex h-4 w-4 items-center justify-center rounded text-foreground/25 hover:text-emerald-400/60 cursor-pointer">
                <Plus className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left"><p className="text-xs">Stage</p></TooltipContent>
          </Tooltip>
        )}
        {onUnstage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => onUnstage(file)} className="flex h-4 w-4 items-center justify-center rounded text-foreground/25 hover:text-amber-400/60 cursor-pointer">
                <Minus className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left"><p className="text-xs">Unstage</p></TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
