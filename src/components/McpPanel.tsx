import { memo, useState, useCallback, useMemo, useEffect } from "react";
import { Plug, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelHeader } from "@/components/PanelHeader";
import { useMcpServers } from "@/hooks/useMcpServers";
import { McpServerRow } from "@/components/mcp/McpServerRow";
import { AddServerDialog } from "@/components/mcp/AddServerDialog";
import type { AuthStatusInfo } from "@/components/mcp/mcp-utils";
import type { McpServerConfig, McpServerStatus } from "@/types";

interface McpPanelProps {
  projectId: string | null;
  runtimeStatuses?: McpServerStatus[];
  isPreliminary?: boolean;
  /** Whether there's a live (non-draft, connected) session -- used to decide if config changes need a session restart */
  hasLiveSession?: boolean;
  onRefreshStatus?: () => void;
  onReconnect?: (name: string) => Promise<void> | void;
  onRestartWithServers?: (servers: McpServerConfig[]) => Promise<void> | void;
  headerControls?: React.ReactNode;
}

export const McpPanel = memo(function McpPanel({
  projectId,
  runtimeStatuses,
  isPreliminary,
  hasLiveSession,
  onRefreshStatus,
  onReconnect,
  onRestartWithServers,
  headerControls,
}: McpPanelProps) {
  const { servers, loading, addServer, removeServer } = useMcpServers(projectId);
  const [reconnectingName, setReconnectingName] = useState<string | null>(null);
  const [authenticatingName, setAuthenticatingName] = useState<string | null>(null);
  const [authStatuses, setAuthStatuses] = useState<Map<string, AuthStatusInfo>>(new Map());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removingName, setRemovingName] = useState<string | null>(null);

  // ── Fetch auth status for all non-stdio servers ──

  useEffect(() => {
    const httpServers = servers.filter((s) => s.transport !== "stdio" && s.url);
    if (httpServers.length === 0) return;

    let cancelled = false;
    Promise.all(
      httpServers.map(async (s) => {
        const status = await window.claude.mcp.authStatus(s.name);
        return [s.name, status] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      setAuthStatuses(new Map(results));
    });

    return () => { cancelled = true; };
  }, [servers]);

  // ── Callbacks ──

  const handleAuthenticate = useCallback(async (serverName: string, serverUrl: string) => {
    if (authenticatingName) return;
    setAuthenticatingName(serverName);
    try {
      const result = await window.claude.mcp.authenticate(serverName, serverUrl);
      if (result.ok) {
        const status = await window.claude.mcp.authStatus(serverName);
        setAuthStatuses((prev) => {
          const next = new Map(prev);
          next.set(serverName, status);
          return next;
        });
        if (hasLiveSession && onRestartWithServers) {
          await onRestartWithServers(servers);
        }
      }
    } finally {
      setAuthenticatingName(null);
    }
  }, [authenticatingName, hasLiveSession, onRestartWithServers, servers]);

  const handleReconnect = useCallback(async (serverName: string) => {
    if (!onReconnect || reconnectingName) return;
    setReconnectingName(serverName);
    try {
      await onReconnect(serverName);
    } finally {
      setReconnectingName(null);
    }
  }, [onReconnect, reconnectingName]);

  const handleRemove = useCallback(async (serverName: string) => {
    setRemovingName(serverName);
    await removeServer(serverName);
    if (hasLiveSession && onRestartWithServers) {
      const updatedServers = servers.filter((s) => s.name !== serverName);
      await onRestartWithServers(updatedServers);
    }
    setRemovingName(null);
  }, [removeServer, hasLiveSession, onRestartWithServers, servers]);

  const handleAdd = useCallback(async (server: McpServerConfig) => {
    await addServer(server);
    setDialogOpen(false);
    if (hasLiveSession && onRestartWithServers) {
      const updatedServers = [...servers.filter((s) => s.name !== server.name), server];
      await onRestartWithServers(updatedServers);
    }
  }, [addServer, hasLiveSession, onRestartWithServers, servers]);

  // ── Derived data ──

  const statusMap = useMemo(() => {
    const map = new Map<string, McpServerStatus>();
    if (runtimeStatuses) {
      for (const s of runtimeStatuses) map.set(s.name, s);
    }
    return map;
  }, [runtimeStatuses]);

  // ── No project state ──

  if (!projectId) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader icon={Plug} label="MCP Servers" iconClass="text-violet-600/70 dark:text-violet-200/50">
          {headerControls}
        </PanelHeader>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.03]">
            <Plug className="h-5 w-5 text-foreground/15" />
          </div>
          <p className="text-[11px] text-muted-foreground/45">Open a project to manage MCP servers</p>
        </div>
      </div>
    );
  }

  // ── Main render ──

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-foreground/[0.04]">
            <Plug className="h-3 w-3 text-violet-600/70 dark:text-violet-200/50" />
          </div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground/80 uppercase">
            MCP Servers
          </span>
          {servers.length > 0 && (
            <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px] font-semibold tabular-nums">
              {servers.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {onRefreshStatus && runtimeStatuses && runtimeStatuses.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground/50 hover:text-muted-foreground"
                  onClick={onRefreshStatus}
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="text-xs">Refresh status</p>
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground/50 hover:text-muted-foreground"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          {headerControls}
        </div>
      </div>

      {/* Header separator */}
      <div className="mx-2">
        <div className="h-px bg-gradient-to-r from-foreground/[0.04] via-foreground/[0.08] to-foreground/[0.04]" />
      </div>

      {/* Preliminary status note */}
      {isPreliminary && runtimeStatuses && runtimeStatuses.length > 0 && (
        <div className="mx-3 mb-1 px-2 py-1 rounded bg-muted/50 text-[10px] text-muted-foreground leading-snug">
          Preliminary — actual status confirmed once session starts
        </div>
      )}

      {/* Server list */}
      <ScrollArea className="flex-1 px-2">
        {loading ? (
          <p className="px-2 py-4 text-xs text-muted-foreground text-center">Loading...</p>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4 gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.03]">
              <Plug className="h-5 w-5 text-foreground/15" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground/60">No MCP servers</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/40">
                Add servers to extend agent capabilities
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1 pb-2">
            {servers.map((server) => (
              <McpServerRow
                key={server.name}
                server={server}
                runtimeStatus={statusMap.get(server.name)}
                authInfo={authStatuses.get(server.name)}
                isRemoving={removingName === server.name}
                authenticatingName={authenticatingName}
                reconnectingName={reconnectingName}
                hasLiveSession={hasLiveSession ?? false}
                servers={servers}
                onRemove={handleRemove}
                onAuthenticate={handleAuthenticate}
                onReconnect={onReconnect ? handleReconnect : undefined}
                onRestartWithServers={onRestartWithServers}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Add Server Dialog */}
      <AddServerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdd={handleAdd}
      />
    </div>
  );
});
