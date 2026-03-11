import { useCallback, useEffect, useRef, useState } from "react";
import type { GitRepoInfo, GitStatus, GitBranch, GitLogEntry } from "@/types";
import { reportError } from "@/lib/analytics";

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
}

interface UseGitStatusOptions {
  projectPath?: string;
}

const repoStatesCache = new Map<string, RepoState[]>();

export function useGitStatus({ projectPath }: UseGitStatusOptions) {
  const [repoStates, setRepoStates] = useState<RepoState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const repoStatesRef = useRef(repoStates);
  const projectPathRef = useRef(projectPath);
  const requestIdRef = useRef(0);
  repoStatesRef.current = repoStates;
  projectPathRef.current = projectPath;

  const isRequestCurrent = useCallback((requestId: number, scopePath?: string) => {
    return requestIdRef.current === requestId && projectPathRef.current === scopePath;
  }, []);

  const applyRepoStates = useCallback((nextStates: RepoState[], scopePath?: string) => {
    setRepoStates(nextStates);
    if (!scopePath) return;
    repoStatesCache.set(scopePath, nextStates);
  }, []);

  const loadRepoStates = useCallback(async (
    repos: GitRepoInfo[],
    requestId: number,
    scopePath?: string,
  ) => {
    const previousByPath = new Map(repoStatesRef.current.map((state) => [state.repo.path, state]));
    const updated = await Promise.all(
      repos.map(async (repo) => {
        const previous = previousByPath.get(repo.path);
        const [statusResult, branchesResult, logResult, diffStatResult] = await Promise.all([
          window.claude.git.status(repo.path),
          window.claude.git.branches(repo.path),
          window.claude.git.log(repo.path, 30),
          window.claude.git.diffStat(repo.path),
        ]);
        return {
          repo,
          status: (!("error" in statusResult) || !statusResult.error) ? statusResult as GitStatus : previous?.status ?? null,
          branches: Array.isArray(branchesResult) ? branchesResult : previous?.branches ?? [],
          log: Array.isArray(logResult) ? logResult : previous?.log ?? [],
          diffStat: diffStatResult ?? previous?.diffStat ?? { additions: 0, deletions: 0 },
        };
      }),
    );
    if (!isRequestCurrent(requestId, scopePath)) return;
    applyRepoStates(updated, scopePath);
  }, [applyRepoStates, isRequestCurrent]);

  const refreshKnownRepos = useCallback(async () => {
    const scopePath = projectPathRef.current;
    const repos = repoStatesRef.current.map((state) => state.repo);
    if (!scopePath || repos.length === 0) return;
    const requestId = ++requestIdRef.current;
    await loadRepoStates(repos, requestId, scopePath);
  }, [loadRepoStates]);

  const refreshAll = useCallback(async () => {
    const scopePath = projectPath?.trim() || undefined;
    const requestId = ++requestIdRef.current;

    if (!scopePath) {
      applyRepoStates([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const discovered = await window.claude.git.discoverRepos(scopePath);
      if (!isRequestCurrent(requestId, scopePath)) return;
      await loadRepoStates(discovered, requestId, scopePath);
    } catch (err) {
      if (isRequestCurrent(requestId, scopePath)) {
        reportError("GIT_DISCOVER_REPOS_ERR", err, { projectPath: scopePath });
      }
    } finally {
      if (isRequestCurrent(requestId, scopePath)) {
        setIsLoading(false);
      }
    }
  }, [applyRepoStates, isRequestCurrent, loadRepoStates, projectPath]);

  // Discover repos when projectPath changes
  useEffect(() => {
    requestIdRef.current += 1;
    const scopePath = projectPath?.trim() || undefined;
    if (!scopePath) {
      applyRepoStates([]);
      setIsLoading(false);
      return;
    }

    const cached = repoStatesCache.get(scopePath);
    applyRepoStates(cached ?? [], scopePath);
    void refreshAll();
  }, [applyRepoStates, projectPath, refreshAll]);

  const refreshRepo = useCallback(async (repoPath: string) => {
    const scopePath = projectPathRef.current;
    const states = repoStatesRef.current;
    const idx = states.findIndex((rs) => rs.repo.path === repoPath);
    if (idx === -1 || !scopePath) return;
    const requestId = ++requestIdRef.current;
    const rs = states[idx];
    const [statusResult, branchesResult, logResult, diffStatResult] = await Promise.all([
      window.claude.git.status(rs.repo.path),
      window.claude.git.branches(rs.repo.path),
      window.claude.git.log(rs.repo.path, 30),
      window.claude.git.diffStat(rs.repo.path),
    ]);
    if (!isRequestCurrent(requestId, scopePath)) return;
    setRepoStates((prev) => {
      const nextIdx = prev.findIndex((state) => state.repo.path === repoPath);
      if (nextIdx === -1) return prev;

      const next = [...prev];
      next[nextIdx] = {
        repo: rs.repo,
        status: (!("error" in statusResult) || !statusResult.error) ? statusResult as GitStatus : rs.status,
        branches: Array.isArray(branchesResult) ? branchesResult : rs.branches,
        log: Array.isArray(logResult) ? logResult : rs.log,
        diffStat: diffStatResult ?? rs.diffStat,
      };
      repoStatesCache.set(scopePath, next);
      return next;
    });
  }, [isRequestCurrent]);

  // Poll all repos every 3s
  useEffect(() => {
    if (!projectPath || repoStates.length === 0) return;
    void refreshKnownRepos();

    const interval = setInterval(() => {
      if (!document.hidden) void refreshKnownRepos();
    }, 3000);

    const onVisibilityChange = () => {
      if (!document.hidden) void refreshKnownRepos();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [projectPath, repoStates.length, refreshKnownRepos]);

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
