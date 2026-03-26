import type { InstalledAgent } from "@/types";
import type { EngineId } from "@shared/types/engine";

/** CDN icons for built-in engines; ACP agents use their own `icon` field */
export const ENGINE_ICONS: Record<string, string> = {
  claude: "https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg",
  codex: "https://cdn.agentclientprotocol.com/registry/v1/latest/codex-acp.svg",
  openclaw: "Lobster",
  ollama: "cpu",
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
  if (effectiveEngine !== "acp" && effectiveEngine !== "openclaw" && effectiveEngine !== "ollama") {
    return ENGINE_ICONS[effectiveEngine];
  }
  if (effectiveEngine === "openclaw") {
    return ENGINE_ICONS.openclaw;
  }
  if (effectiveEngine === "ollama") {
    return ENGINE_ICONS.ollama;
  }
  if (agentId && agents) {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) return getAgentIcon(agent);
  }
  return undefined;
}
