/** Types mirroring the ACP registry JSON at cdn.agentclientprotocol.com */

import type { ACPConfigOption } from "./acp";
import type { EngineId } from "./engine";

// ── Installed agent (shared between electron and renderer) ──

export interface InstalledAgent {
  id: string;
  name: string;
  engine: EngineId;
  binary?: string;
  args?: string[];
  env?: Record<string, string>;
  icon?: string;
  builtIn?: boolean;
  /** Matching id from the ACP registry (for update detection) */
  registryId?: string;
  /** Version from the registry at install time */
  registryVersion?: string;
  /** Description from the registry, shown in agent cards */
  description?: string;
  /** Cached config options from the last ACP session — shown before session starts */
  cachedConfigOptions?: ACPConfigOption[];
}

// ── Binary resolution result (shared between electron and renderer) ──

export interface BinaryCheckResult {
  path: string;
  args?: string[];
}

// ── ACP registry types ──

export interface RegistryNpxDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface RegistryBinaryTarget {
  archive: string;
  cmd: string;
  args?: string[];
}

export interface RegistryDistribution {
  npx?: RegistryNpxDistribution;
  /** Platform keys: "darwin-aarch64", "darwin-x86_64", "linux-aarch64", etc. */
  binary?: Record<string, RegistryBinaryTarget>;
}

export interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  repository?: string;
  authors: string[];
  license: string;
  icon?: string; // SVG URL from CDN
  distribution: RegistryDistribution;
}

export interface RegistryData {
  version: string;
  agents: RegistryAgent[];
}
