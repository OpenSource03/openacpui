import { McpClient, type McpTool } from "./mcp-client";
import { loadMcpServers, type McpServerConfig } from "./mcp-store";
import { loadOAuthData } from "./mcp-oauth-store";
import { log } from "./logger";

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface McpBridgeState {
  clients: Map<string, McpClient>;
  toolMap: Map<string, { serverName: string; originalName: string }>;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function mcpToolToOllama(serverName: string, tool: McpTool): OllamaTool {
  const ollamaName = `mcp_${sanitizeName(serverName)}_${sanitizeName(tool.name)}`;
  return {
    type: "function",
    function: {
      name: ollamaName,
      description: tool.description || tool.name,
      parameters: {
        type: "object",
        properties: tool.inputSchema?.properties ?? {},
        ...(tool.inputSchema?.required?.length ? { required: tool.inputSchema.required } : {}),
      },
    },
  };
}

function applyOAuthHeaders(config: McpServerConfig): McpServerConfig {
  if (config.transport === "stdio") return config;

  const oauthData = loadOAuthData(config.name);
  if (!oauthData?.tokens?.access_token) return config;

  return {
    ...config,
    headers: {
      ...config.headers,
      Authorization: `Bearer ${oauthData.tokens.access_token}`,
    },
  };
}

export async function getMcpToolsForOllama(projectId: string): Promise<{ tools: OllamaTool[]; state: McpBridgeState }> {
  const servers = loadMcpServers(projectId);
  const state: McpBridgeState = {
    clients: new Map(),
    toolMap: new Map(),
  };

  if (servers.length === 0) {
    return { tools: [], state };
  }

  const allTools: OllamaTool[] = [];

  const results = await Promise.allSettled(
    servers.map(async (serverConfig) => {
      const config = applyOAuthHeaders(serverConfig);
      const client = new McpClient(config);

      try {
        await client.connect();
        const tools = await client.listTools();
        state.clients.set(config.name, client);

        log("MCP_BRIDGE", `${config.name}: ${tools.length} tool(s) available`);

        for (const tool of tools) {
          const ollamaTool = mcpToolToOllama(config.name, tool);
          allTools.push(ollamaTool);
          state.toolMap.set(ollamaTool.function.name, {
            serverName: config.name,
            originalName: tool.name,
          });
        }
      } catch (err) {
        log("MCP_BRIDGE", `failed to connect to ${config.name}: ${(err as Error).message}`);
        client.disconnect();
      }
    }),
  );

  const connected = state.clients.size;
  const failed = results.filter((r) => r.status === "rejected").length;
  log("MCP_BRIDGE", `${connected} server(s) connected, ${failed} failed, ${allTools.length} total tool(s)`);

  return { tools: allTools, state };
}

export async function executeMcpTool(
  bridgeState: McpBridgeState,
  ollamaToolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const mapping = bridgeState.toolMap.get(ollamaToolName);
  if (!mapping) {
    throw new Error(`Unknown MCP tool: ${ollamaToolName}`);
  }

  const client = bridgeState.clients.get(mapping.serverName);
  if (!client?.isConnected) {
    throw new Error(`MCP server ${mapping.serverName} is not connected`);
  }

  log("MCP_BRIDGE", `calling ${mapping.serverName}/${mapping.originalName}`);
  const result = await client.callTool(mapping.originalName, args);
  log("MCP_BRIDGE", `${mapping.serverName}/${mapping.originalName} returned ${result.length} chars`);
  return result;
}

export function disconnectMcpBridge(bridgeState: McpBridgeState): void {
  for (const [name, client] of bridgeState.clients) {
    log("MCP_BRIDGE", `disconnecting ${name}`);
    client.disconnect();
  }
  bridgeState.clients.clear();
  bridgeState.toolMap.clear();
}
