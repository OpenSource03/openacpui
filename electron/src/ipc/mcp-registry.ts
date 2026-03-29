import { ipcMain } from "electron";
import { log } from "../lib/logger";

const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";

interface RegistryServer {
  name: string;
  description: string;
  version: string;
  websiteUrl?: string;
  repository?: { url: string; source: string };
  icons?: Array<{ src: string; mimeType?: string }>;
  packages?: Array<{
    registryType: string;
    identifier: string;
    version?: string;
    transport?: { type: string };
    environmentVariables?: Array<{ name: string; description: string; isRequired: boolean; isSecret?: boolean }>;
  }>;
  remotes?: Array<{ type: string; url: string }>;
}

interface RegistryResponse {
  servers: Array<{ server: RegistryServer; _meta?: { publishedAt?: string } }>;
  metadata?: { nextCursor?: string };
}

export function register(): void {
  ipcMain.handle("mcp-registry:search", async (_event, query?: string, cursor?: string) => {
    try {
      const url = new URL(REGISTRY_URL);
      if (query) url.searchParams.set("search", query);
      if (cursor) url.searchParams.set("cursor", cursor);
      url.searchParams.set("limit", "20");

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "application/json" },
      });

      if (!response.ok) return { ok: false, servers: [], error: `HTTP ${response.status}` };

      const data = (await response.json()) as RegistryResponse;

      const servers = data.servers.map(({ server, _meta }) => ({
        name: server.name,
        description: server.description ?? "",
        version: server.version ?? "",
        websiteUrl: server.websiteUrl,
        repoUrl: server.repository?.url,
        icon: server.icons?.[0]?.src,
        packages: server.packages?.map((p) => ({
          registry: p.registryType,
          identifier: p.identifier,
          version: p.version,
          transport: p.transport?.type ?? "stdio",
          envVars: p.environmentVariables ?? [],
        })) ?? [],
        remotes: server.remotes ?? [],
        publishedAt: _meta?.publishedAt,
      }));

      return {
        ok: true,
        servers,
        nextCursor: data.metadata?.nextCursor,
      };
    } catch (err) {
      log("MCP_REGISTRY", `search failed: ${(err as Error).message}`);
      return { ok: false, servers: [], error: (err as Error).message };
    }
  });
}
