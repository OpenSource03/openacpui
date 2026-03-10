import { ipcMain } from "electron";
import { execFileSync } from "child_process";
import { loadMcpServers, addMcpServer, removeMcpServer } from "../lib/mcp-store";
import { authenticateMcpServer } from "../lib/mcp-oauth-flow";
import { loadOAuthData, deleteOAuthData } from "../lib/mcp-oauth-store";
import { log } from "../lib/logger";
import { captureEvent } from "../lib/posthog";
import { reportError } from "../lib/error-utils";
import type { McpServerConfig } from "../lib/mcp-store";

interface ProbeResult {
  name: string;
  status: "connected" | "needs-auth" | "failed";
  error?: string;
}

async function probeHttpServer(server: McpServerConfig): Promise<ProbeResult> {
  if (!server.url) return { name: server.name, status: "failed", error: "No URL configured" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...server.headers,
  };
  // Include OAuth token if available
  const oauthData = loadOAuthData(server.name);
  if (oauthData?.tokens?.access_token) {
    headers["Authorization"] = `Bearer ${oauthData.tokens.access_token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "probe-1",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "Harnss", version: "0.1.0" },
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.status === 401 || response.status === 403) {
      return { name: server.name, status: "needs-auth" };
    }
    if (response.status >= 500) {
      return { name: server.name, status: "failed", error: `HTTP ${response.status}` };
    }
    // Any other response (200, 4xx like 406 Not Acceptable, etc.) means the server
    // is reachable — it just may not like our probe request format. Treat as connected.
    return { name: server.name, status: "connected" };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) return { name: server.name, status: "failed", error: "Connection timed out" };
    return { name: server.name, status: "failed", error: msg };
  }
}

async function probeSseServer(server: McpServerConfig): Promise<ProbeResult> {
  if (!server.url) return { name: server.name, status: "failed", error: "No URL configured" };

  const headers: Record<string, string> = { ...server.headers };
  const oauthData = loadOAuthData(server.name);
  if (oauthData?.tokens?.access_token) {
    headers["Authorization"] = `Bearer ${oauthData.tokens.access_token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(server.url, {
      method: "GET",
      headers: { Accept: "text/event-stream", ...headers },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    // Close the SSE response body to avoid lingering connections
    await response.body?.cancel();

    if (response.status === 401 || response.status === 403) {
      return { name: server.name, status: "needs-auth" };
    }
    if (response.status >= 500) {
      return { name: server.name, status: "failed", error: `HTTP ${response.status}` };
    }
    return { name: server.name, status: "connected" };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) return { name: server.name, status: "failed", error: "Connection timed out" };
    return { name: server.name, status: "failed", error: msg };
  }
}

function probeStdioServer(server: McpServerConfig): ProbeResult {
  const cmd = server.command;
  if (!cmd) return { name: server.name, status: "failed", error: "No command configured" };

  try {
    execFileSync("/usr/bin/which", [cmd], { stdio: "ignore", timeout: 3000 });
    return { name: server.name, status: "connected" };
  } catch {
    // Binary not found on PATH — still might work if it's an npx/bunx invocation
    if (cmd === "npx" || cmd === "bunx" || cmd === "pnpx" || cmd === "node") {
      return { name: server.name, status: "connected" };
    }
    return { name: server.name, status: "failed", error: `Command '${cmd}' not found` };
  }
}

export function register(): void {
  ipcMain.handle("mcp:list", (_event, projectId: string) => {
    return loadMcpServers(projectId);
  });

  ipcMain.handle("mcp:add", (_event, { projectId, server }: { projectId: string; server: McpServerConfig }) => {
    try {
      addMcpServer(projectId, server);
      void captureEvent("mcp_server_added", { transport: server.transport });
      return { ok: true };
    } catch (err) {
      return { error: reportError("MCP_ADD_ERR", err) };
    }
  });

  ipcMain.handle("mcp:remove", (_event, { projectId, name }: { projectId: string; name: string }) => {
    try {
      removeMcpServer(projectId, name);
      // Clean up OAuth data when removing server
      deleteOAuthData(name);
      return { ok: true };
    } catch (err) {
      return { error: reportError("MCP_REMOVE_ERR", err) };
    }
  });

  ipcMain.handle("mcp:authenticate", async (_event, { serverName, serverUrl }: { serverName: string; serverUrl: string }) => {
    log("MCP_AUTH", `Authenticate requested for "${serverName}" at ${serverUrl}`);
    try {
      const result = await authenticateMcpServer(serverName, serverUrl);
      if ("error" in result) {
        log("MCP_AUTH", `Failed for "${serverName}": ${result.error}`);
        return { error: result.error };
      }
      log("MCP_AUTH", `Success for "${serverName}"`);
      return { ok: true };
    } catch (err) {
      const msg = reportError("MCP_AUTH_ERR", err, { serverName });
      return { error: msg };
    }
  });

  ipcMain.handle("mcp:auth-status", (_event, serverName: string) => {
    const data = loadOAuthData(serverName);
    if (!data?.tokens?.access_token) {
      return { hasToken: false };
    }

    let expiresAt: number | undefined;
    if (data.tokens.expires_in) {
      expiresAt = data.storedAt + data.tokens.expires_in * 1000;
    }

    return { hasToken: true, expiresAt };
  });

  ipcMain.handle("mcp:probe", async (_event, servers: McpServerConfig[]) => {
    log("MCP_PROBE", `Probing ${servers.length} server(s)`);
    const results = await Promise.all(
      servers.map(async (server) => {
        try {
          switch (server.transport) {
            case "http": return await probeHttpServer(server);
            case "sse": return await probeSseServer(server);
            case "stdio": return probeStdioServer(server);
            default: return { name: server.name, status: "failed" as const, error: `Unknown transport: ${server.transport}` };
          }
        } catch (err) {
          return { name: server.name, status: "failed" as const, error: String(err) };
        }
      }),
    );
    for (const r of results) {
      log("MCP_PROBE", `  ${r.name}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
    }
    return results;
  });
}
