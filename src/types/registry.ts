/** Types mirroring the ACP registry JSON at cdn.agentclientprotocol.com */

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
