import { memo, useState, useCallback, useMemo, useEffect } from "react";
import { Plug, Plus, Trash2, Terminal, Globe, Network, RefreshCw, CircleCheck, CircleAlert, CircleDashed, Lock, CircleX, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useMcpServers } from "@/hooks/useMcpServers";
import type { McpTransport, McpServerConfig, McpServerStatus, McpServerStatusState } from "@/types";

const TRANSPORT_ICON: Record<McpTransport, typeof Terminal> = {
  stdio: Terminal,
  sse: Globe,
  http: Network,
};

const TRANSPORT_COLOR: Record<McpTransport, string> = {
  stdio: "text-amber-500",
  sse: "text-emerald-500",
  http: "text-blue-500",
};

const STATUS_CONFIG: Record<McpServerStatusState, { icon: typeof CircleCheck; color: string; label: string }> = {
  connected: { icon: CircleCheck, color: "text-emerald-500", label: "Connected" },
  pending: { icon: CircleDashed, color: "text-muted-foreground animate-spin", label: "Connecting..." },
  "needs-auth": { icon: Lock, color: "text-amber-500", label: "Needs authentication" },
  failed: { icon: CircleX, color: "text-destructive", label: "Connection failed" },
  disabled: { icon: CircleAlert, color: "text-muted-foreground/50", label: "Disabled" },
};

interface AuthStatusInfo {
  hasToken: boolean;
  expiresAt?: number;
}

interface McpPanelProps {
  projectId: string | null;
  runtimeStatuses?: McpServerStatus[];
  isPreliminary?: boolean;
  /** Whether there's a live (non-draft, connected) session — used to decide if config changes need a session restart */
  hasLiveSession?: boolean;
  onRefreshStatus?: () => void;
  onReconnect?: (name: string) => Promise<void> | void;
  onRestartWithServers?: (servers: McpServerConfig[]) => Promise<void> | void;
}

export const McpPanel = memo(function McpPanel({ projectId, runtimeStatuses, isPreliminary, hasLiveSession, onRefreshStatus, onReconnect, onRestartWithServers }: McpPanelProps) {
  const { servers, loading, addServer, removeServer } = useMcpServers(projectId);
  const [reconnectingName, setReconnectingName] = useState<string | null>(null);
  const [authenticatingName, setAuthenticatingName] = useState<string | null>(null);
  const [authStatuses, setAuthStatuses] = useState<Map<string, AuthStatusInfo>>(new Map());

  // Fetch auth status for all non-stdio servers
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

  const handleAuthenticate = useCallback(async (serverName: string, serverUrl: string) => {
    if (authenticatingName) return;
    setAuthenticatingName(serverName);
    try {
      const result = await window.claude.mcp.authenticate(serverName, serverUrl);
      if (result.ok) {
        // Refresh auth status after successful auth
        const status = await window.claude.mcp.authStatus(serverName);
        setAuthStatuses((prev) => {
          const next = new Map(prev);
          next.set(serverName, status);
          return next;
        });
        // Auto-restart session so the newly authenticated server is available immediately
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

  const statusMap = useMemo(() => {
    const map = new Map<string, McpServerStatus>();
    if (runtimeStatuses) {
      for (const s of runtimeStatuses) map.set(s.name, s);
    }
    return map;
  }, [runtimeStatuses]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removingName, setRemovingName] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [envText, setEnvText] = useState("");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");

  const resetForm = useCallback(() => {
    setName("");
    setTransport("stdio");
    setCommand("");
    setArgs("");
    setEnvText("");
    setUrl("");
    setHeadersText("");
  }, []);

  const parseKeyValuePairs = useCallback((text: string): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
    }
    return result;
  }, []);

  const handleAdd = useCallback(async () => {
    if (!name.trim()) return;

    const server: McpServerConfig = {
      name: name.trim(),
      transport,
    };

    if (transport === "stdio") {
      if (!command.trim()) return;
      server.command = command.trim();
      if (args.trim()) server.args = args.trim().split(/\s+/);
      const env = parseKeyValuePairs(envText);
      if (Object.keys(env).length > 0) server.env = env;
    } else {
      if (!url.trim()) return;
      server.url = url.trim();
      const headers = parseKeyValuePairs(headersText);
      if (Object.keys(headers).length > 0) server.headers = headers;
    }

    await addServer(server);
    resetForm();
    setDialogOpen(false);

    // Restart the live session with the updated server list so the new server is available immediately
    if (hasLiveSession && onRestartWithServers) {
      // Build the new list: existing servers + newly added server
      const updatedServers = [...servers.filter((s) => s.name !== server.name), server];
      await onRestartWithServers(updatedServers);
    }
  }, [name, transport, command, args, envText, url, headersText, addServer, resetForm, parseKeyValuePairs, hasLiveSession, onRestartWithServers, servers]);

  const handleRemove = useCallback(async (serverName: string) => {
    setRemovingName(serverName);
    await removeServer(serverName);

    // Restart the live session without the removed server
    if (hasLiveSession && onRestartWithServers) {
      const updatedServers = servers.filter((s) => s.name !== serverName);
      await onRestartWithServers(updatedServers);
    }

    setRemovingName(null);
  }, [removeServer, hasLiveSession, onRestartWithServers, servers]);

  if (!projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.03]">
          <Plug className="h-5 w-5 text-foreground/15" />
        </div>
        <p className="text-[11px] text-muted-foreground/45">Open a project to manage MCP servers</p>
      </div>
    );
  }

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
            {servers.map((server) => {
              const Icon = TRANSPORT_ICON[server.transport];
              const color = TRANSPORT_COLOR[server.transport];
              const isRemoving = removingName === server.name;
              const runtimeStatus = statusMap.get(server.name);
              const statusCfg = runtimeStatus ? STATUS_CONFIG[runtimeStatus.status] : null;
              const StatusIcon = statusCfg?.icon;
              return (
                <div
                  key={server.name}
                  className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
                >
                  <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${color}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{server.name}</span>
                      <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">
                        {server.transport}
                      </Badge>
                      {StatusIcon && (
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
                    <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                      {server.transport === "stdio" ? server.command : server.url}
                    </p>
                    {server.env && Object.keys(server.env).length > 0 && (
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {Object.keys(server.env).length} env var{Object.keys(server.env).length !== 1 ? "s" : ""}
                      </p>
                    )}
                    {runtimeStatus?.status === "needs-auth" && server.transport !== "stdio" && server.url && (() => {
                      const authInfo = authStatuses.get(server.name);
                      const hasValidToken = authInfo?.hasToken && (!authInfo.expiresAt || authInfo.expiresAt > Date.now());

                      if (hasValidToken) {
                        // Already authenticated — show success + reconnect hint
                        return (
                          <div className="flex flex-col gap-1 mt-1">
                            <div className="flex items-center gap-1">
                              <ShieldCheck className="h-2.5 w-2.5 text-emerald-500" />
                              <span className="text-[10px] text-emerald-500/70">Authenticated</span>
                            </div>
                            {onReconnect && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-5 text-[10px] px-2 gap-1 w-fit"
                                onClick={() => handleReconnect(server.name)}
                                disabled={reconnectingName === server.name}
                              >
                                <RefreshCw className={`h-2.5 w-2.5 ${reconnectingName === server.name ? "animate-spin" : ""}`} />
                                {reconnectingName === server.name ? "Reconnecting..." : "Reconnect to apply"}
                              </Button>
                            )}
                            <p className="text-[10px] text-muted-foreground/60">
                              Or start a new session to use the token
                            </p>
                          </div>
                        );
                      }

                      // No token — show authenticate button
                      return (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-5 mt-1 text-[10px] px-2 gap-1"
                          onClick={() => handleAuthenticate(server.name, server.url!)}
                          disabled={authenticatingName === server.name}
                        >
                          {authenticatingName === server.name ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <Lock className="h-2.5 w-2.5" />
                          )}
                          {authenticatingName === server.name ? "Authenticating..." : "Authenticate"}
                        </Button>
                      );
                    })()}
                    {runtimeStatus?.status === "needs-auth" && server.transport === "stdio" && onReconnect && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-5 mt-1 text-[10px] px-2 gap-1"
                        onClick={() => handleReconnect(server.name)}
                        disabled={reconnectingName === server.name}
                      >
                        <RefreshCw className={`h-2.5 w-2.5 ${reconnectingName === server.name ? "animate-spin" : ""}`} />
                        {reconnectingName === server.name ? "Authenticating..." : "Retry auth"}
                      </Button>
                    )}
                    {/* Auth status indicators for non-stdio servers (when no runtime status, i.e. before session start or newly added) */}
                    {server.transport !== "stdio" && server.url && !runtimeStatus && (() => {
                      const authInfo = authStatuses.get(server.name);

                      if (!authInfo?.hasToken) {
                        // No token at all — show Authenticate button
                        return (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-5 mt-1 text-[10px] px-2 gap-1"
                            onClick={() => handleAuthenticate(server.name, server.url!)}
                            disabled={authenticatingName === server.name}
                          >
                            {authenticatingName === server.name ? (
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            ) : (
                              <Lock className="h-2.5 w-2.5" />
                            )}
                            {authenticatingName === server.name ? "Authenticating..." : "Authenticate"}
                          </Button>
                        );
                      }

                      const isExpired = authInfo.expiresAt && authInfo.expiresAt < Date.now();
                      return isExpired ? (
                        <div className="flex items-center gap-1 mt-1">
                          <ShieldAlert className="h-2.5 w-2.5 text-amber-500" />
                          <span className="text-[10px] text-amber-500/80">Token expired</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-4 text-[10px] px-1 gap-0.5 text-amber-500/80 hover:text-amber-500"
                            onClick={() => handleAuthenticate(server.name, server.url!)}
                            disabled={authenticatingName === server.name}
                          >
                            {authenticatingName === server.name ? (
                              <Loader2 className="h-2 w-2 animate-spin" />
                            ) : "Re-auth"}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 mt-0.5">
                          <ShieldCheck className="h-2.5 w-2.5 text-emerald-500" />
                          <span className="text-[10px] text-emerald-500/70">Authenticated</span>
                          {hasLiveSession && onRestartWithServers && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-4 text-[10px] px-1 gap-0.5 text-emerald-500/80 hover:text-emerald-500"
                              onClick={() => onRestartWithServers(servers)}
                            >
                              <RefreshCw className="h-2 w-2" />
                              Restart to apply
                            </Button>
                          )}
                        </div>
                      );
                    })()}
                    {runtimeStatus?.status === "failed" && onReconnect && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-5 mt-1 text-[10px] px-2 gap-1"
                        onClick={() => handleReconnect(server.name)}
                        disabled={reconnectingName === server.name}
                      >
                        <RefreshCw className={`h-2.5 w-2.5 ${reconnectingName === server.name ? "animate-spin" : ""}`} />
                        {reconnectingName === server.name ? "Reconnecting..." : "Reconnect"}
                      </Button>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                    onClick={() => handleRemove(server.name)}
                    disabled={isRemoving}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Add Server Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Add MCP Server</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Name */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-server"
                className="h-8 text-xs"
              />
            </div>

            {/* Transport */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Transport</label>
              <div className="flex gap-1">
                {(["stdio", "sse", "http"] as McpTransport[]).map((t) => (
                  <Button
                    key={t}
                    variant={transport === t ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs flex-1"
                    onClick={() => setTransport(t)}
                  >
                    {t.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>

            {/* Conditional fields */}
            {transport === "stdio" ? (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Command</label>
                  <Input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="npx -y @modelcontextprotocol/server-github"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Arguments <span className="text-muted-foreground/60">(space-separated)</span>
                  </label>
                  <Input
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    placeholder="--config config.json"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Environment Variables <span className="text-muted-foreground/60">(KEY=value, one per line)</span>
                  </label>
                  <textarea
                    value={envText}
                    onChange={(e) => setEnvText(e.target.value)}
                    placeholder={"GITHUB_TOKEN=ghp_...\nAPI_KEY=sk-..."}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px] resize-y"
                    rows={3}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">URL</label>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://api.example.com/mcp"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Headers <span className="text-muted-foreground/60">(Name=Value, one per line)</span>
                  </label>
                  <textarea
                    value={headersText}
                    onChange={(e) => setHeadersText(e.target.value)}
                    placeholder={"Authorization=Bearer token123"}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px] resize-y"
                    rows={2}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                resetForm();
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleAdd}
              disabled={!name.trim() || (transport === "stdio" ? !command.trim() : !url.trim())}
            >
              Add Server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
