import { useState, useEffect, useCallback } from "react";
import type { RegistryAgent, RegistryData } from "@/types";

const REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const CACHE_KEY = "openacpui-agent-store-cache";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry {
  data: RegistryData;
  timestamp: number;
}

/**
 * Fetches the ACP agent registry from the CDN.
 * Uses sessionStorage cache (15 min TTL) to avoid re-fetching on every settings open.
 */
export function useAgentStore() {
  const [registryAgents, setRegistryAgents] = useState<RegistryAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRegistry = useCallback(async (force?: boolean) => {
    // Check sessionStorage cache first (skip if force refresh)
    if (!force) {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const entry: CacheEntry = JSON.parse(cached);
          if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
            setRegistryAgents(entry.data.agents);
            setIsLoading(false);
            return;
          }
        }
      } catch {
        /* ignore cache parse errors */
      }
    }

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(REGISTRY_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: RegistryData = await res.json();
      setRegistryAgents(data.agents);
      // Persist to sessionStorage for cache
      try {
        sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ data, timestamp: Date.now() } satisfies CacheEntry),
        );
      } catch {
        /* sessionStorage might be full or disabled */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch registry");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  return {
    registryAgents,
    isLoading,
    error,
    /** Re-fetch registry, bypassing cache */
    refresh: useCallback(() => fetchRegistry(true), [fetchRegistry]),
  };
}
