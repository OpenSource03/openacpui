import type { RegistryAgent } from "@/types/registry";
import type { InstalledAgent } from "@/types/ui";
import type { BinaryCheckResult } from "@/lib/acp-agent-registry";

/**
 * Convert a registry agent to a local InstalledAgent.
 * Supports npx distribution (preferred) and binary distribution when a resolved system path is provided.
 */
export function registryAgentToDefinition(
  agent: RegistryAgent,
  binaryInfo?: BinaryCheckResult,
): InstalledAgent | null {
  // NPX distribution — preferred, uses npx to run the package on demand
  const npx = agent.distribution.npx;
  if (npx) {
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

  // Binary distribution — uses system-installed binary detected via `which`
  if (binaryInfo) {
    return {
      id: agent.id,
      name: agent.name,
      engine: "acp",
      binary: binaryInfo.path,
      args: binaryInfo.args,
      icon: agent.icon,
      registryId: agent.id,
      registryVersion: agent.version,
      description: agent.description,
    };
  }

  return null;
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
 * Check whether a registry agent can be one-click installed — either via npx
 * or because the binary was detected on the system PATH.
 */
export function isInstallable(
  agent: RegistryAgent,
  binaryPaths?: Record<string, BinaryCheckResult>,
): boolean {
  if (agent.distribution.npx != null) return true;
  if (binaryPaths && binaryPaths[agent.id]) return true;
  return false;
}
