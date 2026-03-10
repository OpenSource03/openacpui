import type { RegistryAgent, RegistryData } from "@/types";

const REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const CACHE_KEY = "harnss-agent-store-cache";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry {
  data: RegistryData;
  timestamp: number;
}

export interface BinaryCheckResult {
  path: string;
  args?: string[];
}

export async function fetchAgentRegistry(force = false): Promise<RegistryData> {
  if (!force) {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const entry: CacheEntry = JSON.parse(cached);
        if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
          return entry.data;
        }
      }
    } catch {
      /* ignore cache parse errors */
    }
  }

  const res = await fetch(REGISTRY_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data: RegistryData = await res.json();
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data, timestamp: Date.now() } satisfies CacheEntry),
    );
  } catch {
    /* sessionStorage might be full or disabled */
  }

  return data;
}

export async function resolveRegistryBinaryPaths(
  agents: RegistryAgent[],
): Promise<Record<string, BinaryCheckResult>> {
  const binaryAgents = agents
    .filter((agent) => !agent.distribution.npx && agent.distribution.binary)
    .map((agent) => ({ id: agent.id, binary: agent.distribution.binary! }));

  if (binaryAgents.length === 0) return {};

  try {
    const results = await window.claude.agents.checkBinaries(binaryAgents);
    const found: Record<string, BinaryCheckResult> = {};
    for (const [id, result] of Object.entries(results)) {
      if (result) found[id] = result;
    }
    return found;
  } catch {
    return {};
  }
}
