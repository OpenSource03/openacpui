import type { InstalledAgent, RegistryAgent } from "@/types";
import type { BinaryCheckResult } from "@/lib/acp-agent-registry";
import { hasUpdate, registryAgentToDefinition } from "@/lib/agent-store-utils";

export interface PlannedAcpAgentUpdate {
  current: InstalledAgent;
  registry: RegistryAgent;
  next: InstalledAgent;
}

export function mergeRegistryAgentUpdate(
  existing: InstalledAgent,
  next: InstalledAgent,
): InstalledAgent {
  return {
    ...next,
    id: existing.id,
    cachedConfigOptions: existing.cachedConfigOptions,
  };
}

export function planAcpAgentUpdates(
  installedAgents: InstalledAgent[],
  registryAgents: RegistryAgent[],
  binaryPaths: Record<string, BinaryCheckResult>,
): PlannedAcpAgentUpdate[] {
  const registryById = new Map(registryAgents.map((agent) => [agent.id, agent]));

  return installedAgents.flatMap((installedAgent) => {
    if (installedAgent.engine !== "acp" || !installedAgent.registryId) return [];

    const registryAgent = registryById.get(installedAgent.registryId);
    if (!registryAgent || !hasUpdate(installedAgent, registryAgent)) return [];

    const next = registryAgentToDefinition(
      registryAgent,
      binaryPaths[registryAgent.id],
    );
    if (!next) return [];

    return [{
      current: installedAgent,
      registry: registryAgent,
      next: mergeRegistryAgentUpdate(installedAgent, next),
    }];
  });
}
