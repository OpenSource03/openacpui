import { memo } from "react";
import { Lock, Loader2, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { McpServerConfig, McpServerStatus } from "@/types";
import type { AuthStatusInfo } from "./mcp-utils";

// ── Shared sub-elements ──

interface AuthenticateButtonProps {
  serverName: string;
  serverUrl: string;
  authenticatingName: string | null;
  onAuthenticate: (serverName: string, serverUrl: string) => void;
  variant?: "outline" | "ghost";
  className?: string;
  label?: string;
}

/** Reusable authenticate / re-auth button used across multiple branches. */
function AuthenticateButton({
  serverName,
  serverUrl,
  authenticatingName,
  onAuthenticate,
  variant = "outline",
  className = "h-5 mt-1 text-[10px] px-2 gap-1",
  label,
}: AuthenticateButtonProps) {
  const isAuthenticating = authenticatingName === serverName;
  return (
    <Button
      variant={variant}
      size="sm"
      className={className}
      onClick={() => onAuthenticate(serverName, serverUrl)}
      disabled={isAuthenticating}
    >
      {isAuthenticating ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : (
        <Lock className="h-2.5 w-2.5" />
      )}
      {label ?? (isAuthenticating ? "Authenticating..." : "Authenticate")}
    </Button>
  );
}

interface ReconnectButtonProps {
  serverName: string;
  reconnectingName: string | null;
  onReconnect: (serverName: string) => void;
  label?: string;
  loadingLabel?: string;
}

/** Reusable reconnect / retry button. */
function ReconnectButton({
  serverName,
  reconnectingName,
  onReconnect,
  label = "Reconnect",
  loadingLabel = "Reconnecting...",
}: ReconnectButtonProps) {
  const isReconnecting = reconnectingName === serverName;
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-5 mt-1 text-[10px] px-2 gap-1"
      onClick={() => onReconnect(serverName)}
      disabled={isReconnecting}
    >
      <RefreshCw className={`h-2.5 w-2.5 ${isReconnecting ? "animate-spin" : ""}`} />
      {isReconnecting ? loadingLabel : label}
    </Button>
  );
}

// ── Auth status when runtime status is "needs-auth" ──

interface RuntimeNeedsAuthProps {
  server: McpServerConfig;
  authInfo: AuthStatusInfo | undefined;
  authenticatingName: string | null;
  reconnectingName: string | null;
  onAuthenticate: (serverName: string, serverUrl: string) => void;
  onReconnect?: (serverName: string) => void;
}

/** Auth controls shown when the runtime reports `needs-auth`. */
const RuntimeNeedsAuth = memo(function RuntimeNeedsAuth({
  server,
  authInfo,
  authenticatingName,
  reconnectingName,
  onAuthenticate,
  onReconnect,
}: RuntimeNeedsAuthProps) {
  // stdio servers can only retry — no OAuth flow
  if (server.transport === "stdio") {
    if (!onReconnect) return null;
    return (
      <ReconnectButton
        serverName={server.name}
        reconnectingName={reconnectingName}
        onReconnect={onReconnect}
        label="Retry auth"
        loadingLabel="Authenticating..."
      />
    );
  }

  // Non-stdio without a URL — nothing to do
  if (!server.url) return null;

  const hasValidToken = authInfo?.hasToken && (!authInfo.expiresAt || authInfo.expiresAt > Date.now());

  if (hasValidToken) {
    return (
      <div className="flex flex-col gap-1 mt-1">
        <div className="flex items-center gap-1">
          <ShieldCheck className="h-2.5 w-2.5 text-emerald-500" />
          <span className="text-[10px] text-emerald-500/70">Authenticated</span>
        </div>
        {onReconnect && (
          <ReconnectButton
            serverName={server.name}
            reconnectingName={reconnectingName}
            onReconnect={onReconnect}
            label="Reconnect to apply"
            loadingLabel="Reconnecting..."
          />
        )}
        <p className="text-[10px] text-muted-foreground/60">
          Or start a new session to use the token
        </p>
      </div>
    );
  }

  // No valid token — show authenticate button
  return (
    <AuthenticateButton
      serverName={server.name}
      serverUrl={server.url}
      authenticatingName={authenticatingName}
      onAuthenticate={onAuthenticate}
    />
  );
});

// ── Auth status when there is NO runtime status (pre-session) ──

interface PreSessionAuthProps {
  server: McpServerConfig;
  authInfo: AuthStatusInfo | undefined;
  authenticatingName: string | null;
  hasLiveSession: boolean;
  servers: McpServerConfig[];
  onAuthenticate: (serverName: string, serverUrl: string) => void;
  onRestartWithServers?: (servers: McpServerConfig[]) => Promise<void> | void;
}

/** Auth indicators shown before a session is started (no runtime status available). */
const PreSessionAuth = memo(function PreSessionAuth({
  server,
  authInfo,
  authenticatingName,
  hasLiveSession,
  servers,
  onAuthenticate,
  onRestartWithServers,
}: PreSessionAuthProps) {
  // Only applies to non-stdio servers with a URL
  if (server.transport === "stdio" || !server.url) return null;

  // No token — show authenticate button
  if (!authInfo?.hasToken) {
    return (
      <AuthenticateButton
        serverName={server.name}
        serverUrl={server.url}
        authenticatingName={authenticatingName}
        onAuthenticate={onAuthenticate}
      />
    );
  }

  // Token expired
  const isExpired = authInfo.expiresAt && authInfo.expiresAt < Date.now();
  if (isExpired) {
    return (
      <div className="flex items-center gap-1 mt-1">
        <ShieldAlert className="h-2.5 w-2.5 text-amber-500" />
        <span className="text-[10px] text-amber-500/80">Token expired</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-4 text-[10px] px-1 gap-0.5 text-amber-500/80 hover:text-amber-500"
          onClick={() => onAuthenticate(server.name, server.url!)}
          disabled={authenticatingName === server.name}
        >
          {authenticatingName === server.name ? (
            <Loader2 className="h-2 w-2 animate-spin" />
          ) : (
            "Re-auth"
          )}
        </Button>
      </div>
    );
  }

  // Valid token
  return (
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
});

// ── Public composite component ──

export interface McpAuthStatusProps {
  server: McpServerConfig;
  runtimeStatus: McpServerStatus | undefined;
  authInfo: AuthStatusInfo | undefined;
  authenticatingName: string | null;
  reconnectingName: string | null;
  hasLiveSession: boolean;
  servers: McpServerConfig[];
  onAuthenticate: (serverName: string, serverUrl: string) => void;
  onReconnect?: (serverName: string) => void;
  onRestartWithServers?: (servers: McpServerConfig[]) => Promise<void> | void;
}

/**
 * Renders the appropriate auth status UI for an MCP server.
 *
 * Handles two main contexts:
 * - Runtime `needs-auth`: the session reported the server needs authentication
 * - Pre-session: no runtime status, showing stored auth state
 */
export const McpAuthStatus = memo(function McpAuthStatus({
  server,
  runtimeStatus,
  authInfo,
  authenticatingName,
  reconnectingName,
  hasLiveSession,
  servers,
  onAuthenticate,
  onReconnect,
  onRestartWithServers,
}: McpAuthStatusProps) {
  return (
    <>
      {runtimeStatus?.status === "needs-auth" && (
        <RuntimeNeedsAuth
          server={server}
          authInfo={authInfo}
          authenticatingName={authenticatingName}
          reconnectingName={reconnectingName}
          onAuthenticate={onAuthenticate}
          onReconnect={onReconnect}
        />
      )}
      {!runtimeStatus && (
        <PreSessionAuth
          server={server}
          authInfo={authInfo}
          authenticatingName={authenticatingName}
          hasLiveSession={hasLiveSession}
          servers={servers}
          onAuthenticate={onAuthenticate}
          onRestartWithServers={onRestartWithServers}
        />
      )}
    </>
  );
});
