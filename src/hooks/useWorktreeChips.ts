import { useCallback, useEffect, useRef, useState } from "react";
import { discoverReposCached } from "@/lib/git/discover-repos-cache";

export interface WorktreeChip {
  path: string;
  name: string;
  branch: string;
  isPrimary: boolean;
}

/** Path to the worktree setup config relative to the repo root */
export const WORKTREE_SETUP_PATH = ".harnss/worktree.json";

const worktreeCache = new Map<string, WorktreeChip[]>();

export function useWorktreeChips(projectPath: string | undefined) {
  const [worktrees, setWorktrees] = useState<WorktreeChip[]>([]);
  const [hasSetupFile, setHasSetupFile] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const projectPathRef = useRef(projectPath);
  projectPathRef.current = projectPath;

  const isRequestCurrent = useCallback(
    (requestId: number, scopePath?: string) =>
      requestIdRef.current === requestId && projectPathRef.current === scopePath,
    [],
  );

  const fetchWorktrees = useCallback(async (scopePath: string) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);

    try {
      const [repos, setupResult] = await Promise.all([
        discoverReposCached(scopePath),
        window.claude.readFile(`${scopePath}/${WORKTREE_SETUP_PATH}`),
      ]);

      if (!isRequestCurrent(requestId, scopePath)) return;

      // Check setup file existence
      setHasSetupFile(!setupResult.error && !!setupResult.content);

      // Top-level repos only (no sub-repo worktrees)
      const topLevelRepos = repos.filter((r) => !r.isSubRepo);
      if (topLevelRepos.length === 0) {
        setWorktrees([]);
        worktreeCache.delete(scopePath);
        setIsLoading(false);
        return;
      }

      // Check if there are any worktrees at all
      const hasWorktrees = topLevelRepos.some((r) => r.isWorktree);

      // If no worktrees exist, return just the primary repo
      const reposToShow = hasWorktrees
        ? topLevelRepos.filter((r) => r.isWorktree)
        : [topLevelRepos[0]];

      // Get current branch for each repo via git status
      const chips = await Promise.all(
        reposToShow.map(async (repo) => {
          try {
            const result = await window.claude.git.status(repo.path);
            const branch = "error" in result ? "HEAD" : result.branch;
            return {
              path: repo.path,
              name: repo.name,
              branch,
              isPrimary: hasWorktrees ? repo.isPrimaryWorktree : true,
            };
          } catch {
            return {
              path: repo.path,
              name: repo.name,
              branch: repo.name,
              isPrimary: hasWorktrees ? repo.isPrimaryWorktree : true,
            };
          }
        }),
      );

      if (!isRequestCurrent(requestId, scopePath)) return;

      // Sort: primary first, then alphabetical by branch
      chips.sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        return a.branch.localeCompare(b.branch);
      });

      setWorktrees(chips);
      worktreeCache.set(scopePath, chips);
    } catch {
      if (isRequestCurrent(requestId, scopePath)) {
        setWorktrees([]);
      }
    } finally {
      if (isRequestCurrent(requestId, scopePath)) {
        setIsLoading(false);
      }
    }
  }, [isRequestCurrent]);

  // Fetch on project path change
  useEffect(() => {
    const scopePath = projectPath?.trim() || undefined;
    requestIdRef.current += 1;

    if (!scopePath) {
      setWorktrees([]);
      setHasSetupFile(null);
      setIsLoading(false);
      return;
    }

    // Show cached results instantly
    const cached = worktreeCache.get(scopePath);
    if (cached) setWorktrees(cached);

    void fetchWorktrees(scopePath);
  }, [projectPath, fetchWorktrees]);

  const refresh = useCallback(() => {
    const scopePath = projectPath?.trim() || undefined;
    if (scopePath) void fetchWorktrees(scopePath);
  }, [projectPath, fetchWorktrees]);

  return { worktrees, hasSetupFile, isLoading, refresh };
}
