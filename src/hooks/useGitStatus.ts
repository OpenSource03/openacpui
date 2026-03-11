import { useCallback, useEffect, useRef, useState } from "react";
import type { GitRepoInfo, GitStatus, GitBranch, GitLogEntry } from "@/types";

export interface DiffStat {
  additions: number;
  deletions: number;
}

export interface RepoState {
  repo: GitRepoInfo;
  status: GitStatus | null;
  branches: GitBranch[];
  log: GitLogEntry[];
  diffStat: DiffStat;
  isLargeRepo?: boolean; // Track if repo is large (affects polling)
  lastRefreshDuration?: number; // Track how long refresh takes
}

interface UseGitStatusOptions {
  projectPath?: string;
}

export function useGitStatus({ projectPath }: UseGitStatusOptions) {
  const [repoStates, setRepoStates] = useState<RepoState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const repoStatesRef = useRef(repoStates);
  repoStatesRef.current = repoStates;

  // Discover repos when projectPath changes
  useEffect(() => {
    if (!projectPath) {
      setRepoStates([]);
      return;
    }
    (async () => {
      const discovered = await window.claude.git.discoverRepos(projectPath);

      // Check .git directory sizes to detect very large repos
      const statesWithSizeCheck = await Promise.all(
        discovered.map(async (repo) => {
          const { sizeBytes } = await window.claude.git.getGitDirSize(repo.path);
          const gitSizeGB = sizeBytes > 0 ? sizeBytes / (1024 * 1024 * 1024) : 0;
          const isVeryLarge = gitSizeGB > 10; // 10GB+ .git is very large

          // Log warning for very large repos
          if (isVeryLarge) {
            console.warn(
              `[useGitStatus] Detected very large .git directory (${gitSizeGB.toFixed(1)}GB) at ${repo.path}. ` +
              `Git operations may be slow. Consider using git worktrees or shallow clones to improve performance.`
            );
          }

          return {
            repo,
            status: null,
            branches: [],
            log: [],
            diffStat: { additions: 0, deletions: 0 },
            isLargeRepo: isVeryLarge,
            lastRefreshDuration: 0,
          };
        })
      );

      setRepoStates(statesWithSizeCheck);
    })();
  }, [projectPath]);

  const refreshAll = useCallback(async () => {
    const states = repoStatesRef.current;
    if (states.length === 0) return;
    setIsLoading(true);
    try {
      const updated = await Promise.all(
        states.map(async (rs) => {
          const startTime = performance.now();
          const [statusResult, branchesResult, logResult, diffStatResult] = await Promise.all([
            window.claude.git.status(rs.repo.path),
            window.claude.git.branches(rs.repo.path),
            window.claude.git.log(rs.repo.path, 30),
            window.claude.git.diffStat(rs.repo.path),
          ]);
          const duration = performance.now() - startTime;
          const isLargeRepo = duration > 5000; // Mark as large if refresh takes >5s
          return {
            repo: rs.repo,
            status: (!("error" in statusResult) || !statusResult.error) ? statusResult as GitStatus : rs.status,
            branches: Array.isArray(branchesResult) ? branchesResult : rs.branches,
            log: Array.isArray(logResult) ? logResult : rs.log,
            diffStat: diffStatResult ?? rs.diffStat,
            isLargeRepo,
            lastRefreshDuration: duration,
          };
        }),
      );
      setRepoStates(updated);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshRepo = useCallback(async (repoPath: string) => {
    const states = repoStatesRef.current;
    const idx = states.findIndex((rs) => rs.repo.path === repoPath);
    if (idx === -1) return;
    const rs = states[idx];
    const startTime = performance.now();
    const [statusResult, branchesResult, logResult, diffStatResult] = await Promise.all([
      window.claude.git.status(rs.repo.path),
      window.claude.git.branches(rs.repo.path),
      window.claude.git.log(rs.repo.path, 30),
      window.claude.git.diffStat(rs.repo.path),
    ]);
    const duration = performance.now() - startTime;
    const isLargeRepo = duration > 5000;
    setRepoStates((prev) => {
      const next = [...prev];
      next[idx] = {
        repo: rs.repo,
        status: (!("error" in statusResult) || !statusResult.error) ? statusResult as GitStatus : rs.status,
        branches: Array.isArray(branchesResult) ? branchesResult : rs.branches,
        log: Array.isArray(logResult) ? logResult : rs.log,
        diffStat: diffStatResult ?? rs.diffStat,
        isLargeRepo,
        lastRefreshDuration: duration,
      };
      return next;
    });
  }, []);

  // Poll repos with adaptive interval (3s for normal repos, 15s for large repos)
  useEffect(() => {
    if (repoStates.length === 0) return;
    refreshAll();

    // Determine polling interval based on whether we have any large repos
    const hasLargeRepo = repoStates.some((rs) => rs.isLargeRepo);
    const pollInterval = hasLargeRepo ? 15000 : 3000; // 15s for large repos, 3s for normal

    const interval = setInterval(() => {
      if (!document.hidden) refreshAll();
    }, pollInterval);

    const onVisibilityChange = () => {
      if (!document.hidden) refreshAll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [repoStates.length, refreshAll, repoStates.some((rs) => rs.isLargeRepo)]);

  // Per-repo action creators
  const stage = useCallback(
    async (repoPath: string, files: string[]) => {
      await window.claude.git.stage(repoPath, files);
      refreshRepo(repoPath);
    },
    [refreshRepo],
  );

  const unstage = useCallback(
    async (repoPath: string, files: string[]) => {
      await window.claude.git.unstage(repoPath, files);
      refreshRepo(repoPath);
    },
    [refreshRepo],
  );

  const stageAll = useCallback(
    async (repoPath: string) => {
      await window.claude.git.stageAll(repoPath);
      refreshRepo(repoPath);
    },
    [refreshRepo],
  );

  const unstageAll = useCallback(
    async (repoPath: string) => {
      await window.claude.git.unstageAll(repoPath);
      refreshRepo(repoPath);
    },
    [refreshRepo],
  );

  const discard = useCallback(
    async (repoPath: string, files: string[]) => {
      await window.claude.git.discard(repoPath, files);
      refreshRepo(repoPath);
    },
    [refreshRepo],
  );

  const commit = useCallback(
    async (repoPath: string, message: string) => {
      const result = await window.claude.git.commit(repoPath, message);
      refreshRepo(repoPath);
      return result;
    },
    [refreshRepo],
  );

  const checkout = useCallback(
    async (repoPath: string, branch: string) => {
      const result = await window.claude.git.checkout(repoPath, branch);
      if (!result.error) refreshRepo(repoPath);
      return result;
    },
    [refreshRepo],
  );

  const createBranch = useCallback(
    async (repoPath: string, name: string) => {
      const result = await window.claude.git.createBranch(repoPath, name);
      if (!result.error) refreshRepo(repoPath);
      return result;
    },
    [refreshRepo],
  );

  const createWorktree = useCallback(
    async (repoPath: string, worktreePath: string, branch: string, fromRef?: string) => {
      const result = await window.claude.git.createWorktree(repoPath, worktreePath, branch, fromRef);
      if (!result.error) await refreshAll();
      return result;
    },
    [refreshAll],
  );

  const removeWorktree = useCallback(
    async (repoPath: string, worktreePath: string, force?: boolean) => {
      const result = await window.claude.git.removeWorktree(repoPath, worktreePath, force);
      if (!result.error) await refreshAll();
      return result;
    },
    [refreshAll],
  );

  const pruneWorktrees = useCallback(
    async (repoPath: string) => {
      const result = await window.claude.git.pruneWorktrees(repoPath);
      if (!result.error) await refreshAll();
      return result;
    },
    [refreshAll],
  );

  const push = useCallback(
    async (repoPath: string) => {
      const result = await window.claude.git.push(repoPath);
      refreshRepo(repoPath);
      return result;
    },
    [refreshRepo],
  );

  const pull = useCallback(
    async (repoPath: string) => {
      const result = await window.claude.git.pull(repoPath);
      refreshRepo(repoPath);
      return result;
    },
    [refreshRepo],
  );

  const fetchRemote = useCallback(
    async (repoPath: string) => {
      const result = await window.claude.git.fetch(repoPath);
      refreshRepo(repoPath);
      return result;
    },
    [refreshRepo],
  );

  const getDiff = useCallback(
    async (repoPath: string, file: string, staged: boolean) => {
      return window.claude.git.diffFile(repoPath, file, staged);
    },
    [],
  );

  return {
    repoStates,
    isLoading,
    refreshAll,
    refreshRepo,
    stage,
    unstage,
    stageAll,
    unstageAll,
    discard,
    commit,
    checkout,
    createBranch,
    createWorktree,
    removeWorktree,
    pruneWorktrees,
    push,
    pull,
    fetchRemote,
    getDiff,
  };
}
