import { memo } from "react";
import { Loader2, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isMac } from "@/lib/utils";

const PERMISSION_MODE_LABELS: Record<string, string> = {
  plan: "Plan",
  default: "Ask Before Edits",
  acceptEdits: "Accept Edits",
  dontAsk: "Don't Ask",
  bypassPermissions: "Allow All",
};

interface ChatHeaderProps {
  sidebarOpen: boolean;
  isProcessing: boolean;
  model?: string;
  sessionId?: string;
  totalCost: number;
  title?: string;
  permissionMode?: string;
  onToggleSidebar: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  sidebarOpen,
  isProcessing,
  model,
  sessionId,
  totalCost,
  title,
  permissionMode,
  onToggleSidebar,
}: ChatHeaderProps) {
  const modeLabel = permissionMode ? PERMISSION_MODE_LABELS[permissionMode] : null;

  return (
    <div
      className={`pointer-events-auto drag-region flex h-8 items-center gap-3 px-3 ${
        !sidebarOpen && isMac ? "ps-[78px]" : ""
      }`}
    >
      {!sidebarOpen && (
        <Button
          variant="ghost"
          size="icon"
          className="no-drag h-7 w-7 text-muted-foreground/60 hover:text-foreground"
          onClick={onToggleSidebar}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}

      {title && title !== "New Chat" && (
        <span className="no-drag truncate text-sm font-medium text-foreground/80">
          {title}
        </span>
      )}

      {isProcessing && (
        <span className="no-drag flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Processing
        </span>
      )}

      {model && (
        <Badge variant="secondary" className="no-drag text-[11px] font-normal">
          {model}
        </Badge>
      )}

      {modeLabel && permissionMode !== "default" && (
        <Badge variant="outline" className="no-drag text-[11px] font-normal">
          {modeLabel}
        </Badge>
      )}

      <div className="ms-auto flex items-center gap-3">
        {totalCost > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            ${totalCost.toFixed(4)}
          </span>
        )}

        {sessionId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="no-drag cursor-default text-xs text-muted-foreground/60 tabular-nums">
                {sessionId.slice(0, 8)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-mono text-xs">{sessionId}</p>
            </TooltipContent>
          </Tooltip>
        )}

      </div>
    </div>
  );
});
