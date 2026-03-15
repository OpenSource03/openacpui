/**
 * MCP server configuration builder shared between Electron and CLI.
 *
 * Electron passes a `getAuthHeaders` callback for OAuth support.
 * CLI passes undefined (no OAuth in CLI v1).
 */

export interface McpServerInput {
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface BuildMcpConfigOptions {
  getAuthHeaders?: (serverName: string, url: string) => Promise<Record<string, string>>;
}

/**
 * Build SDK-compatible MCP config from server configs.
 * Returns a record keyed by server name.
 */
export async function buildSdkMcpConfig(
  servers: McpServerInput[],
  options?: BuildMcpConfigOptions,
): Promise<Record<string, unknown>> {
  const sdkMcp: Record<string, unknown> = {};

  for (const s of servers) {
    if (s.transport === "stdio") {
      sdkMcp[s.name] = { command: s.command, args: s.args, env: s.env };
    } else if (s.url) {
      let headers = s.headers && Object.keys(s.headers).length > 0 ? { ...s.headers } : undefined;

      if (options?.getAuthHeaders) {
        try {
          const authHeaders = await options.getAuthHeaders(s.name, s.url);
          if (Object.keys(authHeaders).length > 0) {
            headers = { ...headers, ...authHeaders };
          }
        } catch {
          // OAuth not available — proceed without auth headers
        }
      }

      sdkMcp[s.name] = {
        type: s.transport,
        url: s.url,
        headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
      };
    }
  }
  return sdkMcp;
}

/**
 * Synchronous version for when no auth headers are needed (CLI).
 */
export function buildSdkMcpConfigSync(servers: McpServerInput[]): Record<string, unknown> {
  const sdkMcp: Record<string, unknown> = {};

  for (const s of servers) {
    if (s.transport === "stdio") {
      sdkMcp[s.name] = { command: s.command, args: s.args, env: s.env };
    } else if (s.url) {
      sdkMcp[s.name] = {
        type: s.transport,
        url: s.url,
        headers: s.headers && Object.keys(s.headers).length > 0 ? s.headers : undefined,
      };
    }
  }
  return sdkMcp;
}
