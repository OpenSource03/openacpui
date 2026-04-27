import type { InstalledAgent } from "@/types";
import type { EngineId } from "@shared/types/engine";

/**
 * Icons for built-in engines. Claude/Codex use registry CDN SVGs; CLI uses
 * a lucide name (Terminal) since it has no registry presence — `<AgentIcon>`
 * resolves the lucide string when no URL prefix is present.
 */
export const ENGINE_ICONS: Record<string, string> = {
  claude: "https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg",
  codex: "https://cdn.agentclientprotocol.com/registry/v1/latest/codex-acp.svg",
  cli: "Terminal",
};

/** Resolve the icon source for an agent — engine CDN icons override agent-level icons */
export function getAgentIcon(agent: InstalledAgent): string | undefined {
  return ENGINE_ICONS[agent.engine] ?? agent.icon;
}

/** Resolve the icon URL for a session based on its engine and optional agent ID */
export function getSessionEngineIcon(
  engine: EngineId | undefined,
  agentId: string | undefined,
  agents?: InstalledAgent[],
): string | undefined {
  const effectiveEngine = engine ?? "claude";
  if (effectiveEngine !== "acp") {
    return ENGINE_ICONS[effectiveEngine];
  }
  if (agentId && agents) {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) return getAgentIcon(agent);
  }
  return undefined;
}
