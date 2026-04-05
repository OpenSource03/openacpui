import { memo } from "react";
import { Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { McpServerConfig, McpServerStatus } from "@/types";
import { TRANSPORT_ICON, TRANSPORT_COLOR, STATUS_CONFIG } from "./mcp-utils";
import type { AuthStatusInfo } from "./mcp-utils";
import { McpAuthStatus } from "./McpAuthStatus";

export interface McpServerRowProps {
  server: McpServerConfig;
  runtimeStatus: McpServerStatus | undefined;
  authInfo: AuthStatusInfo | undefined;
  isRemoving: boolean;
  authenticatingName: string | null;
  reconnectingName: string | null;
  hasLiveSession: boolean;
  servers: McpServerConfig[];
  onRemove: (serverName: string) => void;
  onAuthenticate: (serverName: string, serverUrl: string) => void;
  onReconnect?: (serverName: string) => void;
  onRestartWithServers?: (servers: McpServerConfig[]) => Promise<void> | void;
}

/** A single MCP server row with transport icon, status indicator, auth controls, and remove button. */
export const McpServerRow = memo(function McpServerRow({
  server,
  runtimeStatus,
  authInfo,
  isRemoving,
  authenticatingName,
  reconnectingName,
  hasLiveSession,
  servers,
  onRemove,
  onAuthenticate,
  onReconnect,
  onRestartWithServers,
}: McpServerRowProps) {
  const Icon = TRANSPORT_ICON[server.transport];
  const color = TRANSPORT_COLOR[server.transport];
  const statusCfg = runtimeStatus ? STATUS_CONFIG[runtimeStatus.status] : null;
  const StatusIcon = statusCfg?.icon;

  return (
    <div className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        {/* Name + transport badge + status icon */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate">{server.name}</span>
          <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">
            {server.transport}
          </Badge>
          {StatusIcon && statusCfg && (
            <Tooltip>
              <TooltipTrigger asChild>
                <StatusIcon className={`h-3 w-3 shrink-0 ${statusCfg.color}`} />
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">{statusCfg.label}</p>
                {runtimeStatus?.error && (
                  <p className="text-xs text-background/60 mt-0.5">{runtimeStatus.error}</p>
                )}
                {runtimeStatus?.tools && runtimeStatus.tools.length > 0 && (
                  <p className="text-xs text-background/60 mt-0.5">
                    {runtimeStatus.tools.length} tool{runtimeStatus.tools.length !== 1 ? "s" : ""}
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Connection detail (command or URL) */}
        <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
          {server.transport === "stdio" ? server.command : server.url}
        </p>

        {/* Environment variable count */}
        {server.env && Object.keys(server.env).length > 0 && (
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            {Object.keys(server.env).length} env var{Object.keys(server.env).length !== 1 ? "s" : ""}
          </p>
        )}

        {/* Auth status (runtime needs-auth or pre-session indicators) */}
        <McpAuthStatus
          server={server}
          runtimeStatus={runtimeStatus}
          authInfo={authInfo}
          authenticatingName={authenticatingName}
          reconnectingName={reconnectingName}
          hasLiveSession={hasLiveSession}
          servers={servers}
          onAuthenticate={onAuthenticate}
          onReconnect={onReconnect}
          onRestartWithServers={onRestartWithServers}
        />

        {/* Failed status reconnect */}
        {runtimeStatus?.status === "failed" && onReconnect && (
          <Button
            variant="outline"
            size="sm"
            className="h-5 mt-1 text-[10px] px-2 gap-1"
            onClick={() => onReconnect(server.name)}
            disabled={reconnectingName === server.name}
          >
            <RefreshCw className={`h-2.5 w-2.5 ${reconnectingName === server.name ? "animate-spin" : ""}`} />
            {reconnectingName === server.name ? "Reconnecting..." : "Reconnect"}
          </Button>
        )}
      </div>

      {/* Remove button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
        onClick={() => onRemove(server.name)}
        disabled={isRemoving}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
});
