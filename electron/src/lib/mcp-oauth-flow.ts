import http from "http";
import net from "net";
import { URL } from "url";
import { log } from "./logger";
import { reportError } from "./error-utils";
import { ElectronOAuthClientProvider } from "./mcp-oauth-provider";
import { loadOAuthData } from "./mcp-oauth-store";

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => reject(new Error("Could not determine port")));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

export async function authenticateMcpServer(
  serverName: string,
  serverUrl: string,
): Promise<{ accessToken: string } | { error: string }> {
  // Dynamic import — @modelcontextprotocol/sdk is ESM-only
  const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");

  const port = await findFreePort();
  const provider = new ElectronOAuthClientProvider(serverName, serverUrl, port);

  log("MCP_OAUTH", `Starting OAuth flow for "${serverName}" at ${serverUrl} (callback port=${port})`);

  return new Promise((resolve) => {
    let resolved = false;
    let callbackServer: http.Server | null = null;

    const cleanup = () => {
      if (callbackServer) {
        callbackServer.close();
        callbackServer = null;
      }
    };

    // Timeout after 120 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        log("MCP_OAUTH", `Timeout waiting for OAuth callback for "${serverName}"`);
        resolve({ error: "Authentication timed out. Please try again." });
      }
    }, 120_000);

    // Start a temporary HTTP server to receive the OAuth callback
    callbackServer = http.createServer(async (req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>");
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          log("MCP_OAUTH", `OAuth error for "${serverName}": ${error}`);
          resolve({ error: `OAuth error: ${error}` });
        }
        return;
      }

      if (!code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Missing authorization code</h2><p>You can close this tab.</p></body></html>");
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          resolve({ error: "No authorization code received" });
        }
        return;
      }

      log("MCP_OAUTH", `Received auth code for "${serverName}", exchanging for tokens...`);

      try {
        // Call auth() again with the authorization code — it handles the token exchange
        const result = await auth(provider, {
          serverUrl,
          authorizationCode: code,
        });

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authentication successful!</h2><p>You can close this tab and return to Harnss.</p></body></html>");

        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          cleanup();

          const tokens = provider.tokens();
          if (tokens?.access_token) {
            log("MCP_OAUTH", `OAuth tokens obtained for "${serverName}" (result=${result})`);
            resolve({ accessToken: tokens.access_token });
          } else {
            log("MCP_OAUTH", `Token exchange completed but no access_token found (result=${result})`);
            resolve({ error: "Token exchange succeeded but no access token was returned" });
          }
        }
      } catch (err) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>");
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          const msg = reportError("MCP_OAUTH", err, { context: "token-exchange", serverName });
          resolve({ error: `Token exchange failed: ${msg}` });
        }
      }
    });

    callbackServer.listen(port, async () => {
      log("MCP_OAUTH", `Callback server listening on port ${port}`);

      try {
        // Start the OAuth flow — this discovers endpoints, registers client, and opens browser
        const result = await auth(provider, { serverUrl });

        // If auth() returns "AUTHORIZED", tokens are already available (e.g. from cache/refresh)
        if (result === "AUTHORIZED") {
          const tokens = provider.tokens();
          if (tokens?.access_token && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            cleanup();
            log("MCP_OAUTH", `Already authorized for "${serverName}" (had valid tokens)`);
            resolve({ accessToken: tokens.access_token });
          }
        }
        // If "REDIRECT", the browser was opened and we wait for the callback
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          const msg = reportError("MCP_OAUTH", err, { context: "flow-initiation", serverName });
          resolve({ error: `OAuth initiation failed: ${msg}` });
        }
      }
    });
  });
}

export async function getMcpAuthHeaders(
  serverName: string,
  serverUrl: string,
): Promise<Record<string, string> | null> {
  const data = loadOAuthData(serverName);
  if (!data?.tokens?.access_token) return null;

  // Check if token might be expired
  if (data.tokens.expires_in) {
    const tokenAge = (Date.now() - data.storedAt) / 1000;
    if (tokenAge >= data.tokens.expires_in - 60) {
      // Token expired or about to expire
      if (data.tokens.refresh_token) {
        const refreshed = await refreshMcpToken(serverName, serverUrl);
        if (refreshed) {
          return { Authorization: `Bearer ${refreshed}` };
        }
      }
      // No refresh token or refresh failed — token is expired, need re-auth
      return null;
    }
  }

  return { Authorization: `Bearer ${data.tokens.access_token}` };
}

async function refreshMcpToken(
  serverName: string,
  serverUrl: string,
): Promise<string | null> {
  try {
    const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");

    // Use port 0 — we won't need the callback for refresh
    const provider = new ElectronOAuthClientProvider(serverName, serverUrl, 0);

    const result = await auth(provider, { serverUrl });

    if (result === "AUTHORIZED") {
      const tokens = provider.tokens();
      if (tokens?.access_token) {
        log("MCP_OAUTH", `Token refreshed for "${serverName}"`);
        return tokens.access_token;
      }
    }

    log("MCP_OAUTH", `Token refresh for "${serverName}" returned ${result}, needs re-auth`);
    return null;
  } catch (err) {
    reportError("MCP_OAUTH", err, { context: "token-refresh", serverName });
    return null;
  }
}
