import { memo } from "react";
import { Info, Loader2, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isMac } from "@/lib/utils";
import type { AcpPermissionBehavior } from "@/types";

const PERMISSION_MODE_LABELS: Record<string, string> = {
  plan: "Plan",
  default: "Ask Before Edits",
  acceptEdits: "Accept Edits",
  bypassPermissions: "Allow All",
};

const ACP_PERMISSION_BEHAVIOR_LABELS: Record<AcpPermissionBehavior, string> = {
  ask: "Ask",
  auto_accept: "Auto Accept",
  allow_all: "Allow All",
};

interface ChatHeaderProps {
  sidebarOpen: boolean;
  isProcessing: boolean;
  model?: string;
  sessionId?: string;
  totalCost: number;
  title?: string;
  planMode?: boolean;
  permissionMode?: string;
  acpPermissionBehavior?: AcpPermissionBehavior;
  onToggleSidebar: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  sidebarOpen,
  isProcessing,
  model,
  sessionId,
  totalCost,
  title,
  planMode,
  permissionMode,
  acpPermissionBehavior,
  onToggleSidebar,
}: ChatHeaderProps) {
  const modeLabel = permissionMode ? PERMISSION_MODE_LABELS[permissionMode] : null;
  const acpBehaviorLabel = acpPermissionBehavior
    ? ACP_PERMISSION_BEHAVIOR_LABELS[acpPermissionBehavior]
    : null;
  const permissionDisplay = acpBehaviorLabel ?? modeLabel;

  // Collect all session detail rows for the unified tooltip
  const detailRows: { label: string; value: string }[] = [];
  if (model) detailRows.push({ label: "Model", value: model });
  detailRows.push({ label: "Plan", value: planMode ? "On" : "Off" });
  if (permissionDisplay) detailRows.push({ label: "Permissions", value: permissionDisplay });
  if (totalCost > 0) detailRows.push({ label: "Cost", value: `$${totalCost.toFixed(4)}` });
  if (sessionId) detailRows.push({ label: "Session", value: sessionId });

  const hasDetails = detailRows.length > 0;

  return (
    <div
      className={`chat-header pointer-events-auto drag-region flex h-8 items-center gap-3 px-3 ${
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

      {/* Processing spinner — left of title, hover shows runtime model + permission mode */}
      {isProcessing && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="no-drag flex items-center justify-center">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </span>
          </TooltipTrigger>
          {(model || permissionDisplay) && (
            <TooltipContent side="bottom">
              <div className="space-y-0.5 text-xs">
                {model && (
                  <div className="flex justify-between gap-4">
                    <span className="opacity-70">Model</span>
                    <span className="font-mono">{model}</span>
                  </div>
                )}
                {permissionDisplay && (
                  <div className="flex justify-between gap-4">
                    <span className="opacity-70">Permissions</span>
                    <span className="font-mono">{permissionDisplay}</span>
                  </div>
                )}
              </div>
            </TooltipContent>
          )}
        </Tooltip>
      )}

      {title && title !== "New Chat" && (
        <span className="no-drag truncate text-sm font-medium text-foreground/80">
          {title}
        </span>
      )}

      {/* Session info — subtle icon, hover reveals model / permissions / cost / session ID */}
      {hasDetails && (
        <div className="ms-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="no-drag flex cursor-default items-center justify-center rounded-full p-0.5 text-muted-foreground/30 transition-colors hover:text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              <div className="space-y-1 text-xs">
                {detailRows.map((row) => (
                  <div key={row.label} className="flex justify-between gap-6">
                    <span className="opacity-70">{row.label}</span>
                    <span className="font-mono text-end">{row.value}</span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
});
