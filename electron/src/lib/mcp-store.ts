import { JsonFileStore } from "./json-file-store";

export interface McpServerConfig {
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

const store = new JsonFileStore<McpServerConfig[]>({
  subDir: "mcp",
  label: "MCP_STORE",
});

export function loadMcpServers(projectId: string): McpServerConfig[] {
  return store.load(projectId) ?? [];
}

export function saveMcpServers(projectId: string, servers: McpServerConfig[]): void {
  store.save(projectId, servers);
}

export function addMcpServer(projectId: string, server: McpServerConfig): void {
  const servers = loadMcpServers(projectId);
  const idx = servers.findIndex((s) => s.name === server.name);
  if (idx >= 0) servers[idx] = server;
  else servers.push(server);
  saveMcpServers(projectId, servers);
}

export function removeMcpServer(projectId: string, name: string): void {
  const servers = loadMcpServers(projectId).filter((s) => s.name !== name);
  saveMcpServers(projectId, servers);
}
