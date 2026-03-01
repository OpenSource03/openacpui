import { useState, useCallback, type KeyboardEvent } from "react";
import {
  Check,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EngineId } from "@/types";

export interface CommitInputProps {
  cwd: string;
  stagedCount: number;
  totalChanges: number;
  activeEngine?: EngineId;
  activeSessionId?: string | null;
  onSyncError: (error: string) => void;
  onCommit: (message: string) => Promise<void>;
}

export function CommitInput({
  cwd,
  stagedCount,
  totalChanges,
  activeEngine,
  activeSessionId,
  onSyncError,
  onCommit,
}: CommitInputProps) {
  const [commitMessage, setCommitMessage] = useState("");
  const [generatingMessage, setGeneratingMessage] = useState(false);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || stagedCount === 0) return;
    await onCommit(commitMessage.trim());
    setCommitMessage("");
  }, [commitMessage, stagedCount, onCommit]);

  const handleCommitKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

  const handleGenerateMessage = useCallback(async () => {
    setGeneratingMessage(true);
    try {
      const result = await window.claude.git.generateCommitMessage(
        cwd,
        activeEngine,
        activeEngine === "acp" && activeSessionId ? activeSessionId : undefined,
      );
      if (result.message) {
        setCommitMessage(result.message);
      } else if (result.error) {
        onSyncError(result.error);
      }
    } finally {
      setGeneratingMessage(false);
    }
  }, [cwd, activeEngine, activeSessionId, onSyncError]);

  return (
    <div className="px-3 pt-1 pb-1">
      <div className="relative">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleCommitKeyDown}
          placeholder="Commit message"
          rows={2}
          className="w-full resize-none rounded bg-foreground/[0.04] px-2 py-1.5 pe-14 text-[11px] text-foreground/70 outline-none transition-colors placeholder:text-foreground/20 focus:bg-foreground/[0.07] focus:ring-1 focus:ring-foreground/[0.08]"
        />
        <div className="absolute end-1.5 top-1.5 flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleGenerateMessage}
                disabled={generatingMessage || totalChanges === 0}
                className="flex h-5 w-5 items-center justify-center rounded text-foreground/30 transition-colors hover:text-foreground/60 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
              >
                {generatingMessage ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={4}>
              <p className="text-xs">Generate commit message</p>
              <p className="text-[10px] text-background/60">Respects CLAUDE.md rules</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleCommit}
                disabled={!commitMessage.trim() || stagedCount === 0}
                className="flex h-5 w-5 items-center justify-center rounded text-foreground/30 transition-colors hover:text-foreground/60 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={4}>
              <p className="text-xs">
                Commit {stagedCount > 0 ? `(${stagedCount} file${stagedCount > 1 ? "s" : ""})` : ""}
                <span className="ms-1 text-foreground/40">Cmd+Enter</span>
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
