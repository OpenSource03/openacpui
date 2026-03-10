import { useState, useEffect, useCallback } from "react";
import type { RegistryAgent } from "@/types";
import {
  fetchAgentRegistry,
  resolveRegistryBinaryPaths,
  type BinaryCheckResult,
} from "@/lib/acp-agent-registry";

/**
 * Fetches the ACP agent registry from the CDN.
 * Uses sessionStorage cache (15 min TTL) to avoid re-fetching on every settings open.
 * After registry loads, checks which binary-only agents are installed on the system PATH.
 */
export function useAgentStore() {
  const [registryAgents, setRegistryAgents] = useState<RegistryAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [binaryPaths, setBinaryPaths] = useState<Record<string, BinaryCheckResult>>({});

  const checkBinaries = useCallback(async (agents: RegistryAgent[]) => {
    const found = await resolveRegistryBinaryPaths(agents);
    setBinaryPaths(found);
  }, []);

  const fetchRegistry = useCallback(async (force?: boolean) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchAgentRegistry(force);
      setRegistryAgents(data.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch registry");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  // Run binary checks in the background after registry loads
  useEffect(() => {
    void checkBinaries(registryAgents);
  }, [registryAgents, checkBinaries]);

  return {
    registryAgents,
    isLoading,
    error,
    /** Map of agent id → resolved binary path + args for agents found on the system. */
    binaryPaths,
    /** Re-fetch registry, bypassing cache */
    refresh: useCallback(() => fetchRegistry(true), [fetchRegistry]),
  };
}
