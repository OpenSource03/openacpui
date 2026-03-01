import type { RegistryAgent } from "@/types/registry";
import type { InstalledAgent } from "@/types/ui";

/**
 * Convert a registry agent's npx distribution to a local InstalledAgent.
 * Returns null if the agent has no npx distribution (binary-only).
 */
export function registryAgentToDefinition(
  agent: RegistryAgent,
): InstalledAgent | null {
  const npx = agent.distribution.npx;
  if (!npx) return null; // binary-only agents cannot be auto-installed

  return {
    id: agent.id,
    name: agent.name,
    engine: "acp",
    binary: "npx",
    args: [npx.package, ...(npx.args ?? [])],
    env: npx.env,
    icon: agent.icon,
    registryId: agent.id,
    registryVersion: agent.version,
    description: agent.description,
  };
}

/**
 * Check if a registry agent has a newer version than the installed agent.
 * Only meaningful for agents installed from the registry (have registryVersion).
 */
export function hasUpdate(
  installed: InstalledAgent,
  registry: RegistryAgent,
): boolean {
  if (!installed.registryVersion) return false;
  return installed.registryVersion !== registry.version;
}

/**
 * Check whether a registry agent supports one-click install (has npx distribution).
 */
export function isInstallable(agent: RegistryAgent): boolean {
  return agent.distribution.npx != null;
}
