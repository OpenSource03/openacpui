import type { GitRepoInfo } from "@/types";

/** How long a cached discoverRepos result stays valid (ms). */
const CACHE_TTL_MS = 5_000;

interface CacheEntry {
  result: GitRepoInfo[];
  timestamp: number;
}

/**
 * Per-path cache for discoverRepos results.
 *
 * Two layers of deduplication:
 * 1. **Result cache** — a resolved result is reused for `CACHE_TTL_MS` without
 *    hitting IPC again.
 * 2. **In-flight dedup** — if a second caller requests the same path while the
 *    first call is still pending, both await the same Promise instead of
 *    spawning a parallel IPC call.
 */
const resultCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<GitRepoInfo[]>>();

/**
 * Calls `window.claude.git.discoverRepos` with per-path caching and in-flight
 * request deduplication. Safe to call from multiple hooks in the same render
 * cycle — only one IPC round-trip will occur per path within the TTL window.
 */
export async function discoverReposCached(
  projectPath: string,
): Promise<GitRepoInfo[]> {
  // 1. Check result cache
  const cached = resultCache.get(projectPath);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  // 2. Deduplicate concurrent in-flight requests
  const inflight = inflightRequests.get(projectPath);
  if (inflight) {
    return inflight;
  }

  // 3. Fresh IPC call
  const request = window.claude.git
    .discoverRepos(projectPath)
    .then((result) => {
      resultCache.set(projectPath, { result, timestamp: Date.now() });
      return result;
    })
    .finally(() => {
      inflightRequests.delete(projectPath);
    });

  inflightRequests.set(projectPath, request);
  return request;
}

/** Evict a specific path from the result cache (e.g. after a worktree mutation). */
export function invalidateDiscoverReposCache(projectPath: string): void {
  resultCache.delete(projectPath);
}
