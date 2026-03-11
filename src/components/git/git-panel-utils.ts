export function formatRelativeDate(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

export const STATUS_COLORS: Record<string, string> = {
  modified: "text-amber-600 dark:text-amber-300 bg-amber-500/10 dark:bg-amber-400/15",
  added: "text-emerald-600 dark:text-emerald-300 bg-emerald-500/10 dark:bg-emerald-400/15",
  deleted: "text-red-600 dark:text-red-300 bg-red-500/10 dark:bg-red-400/15",
  renamed: "text-blue-600 dark:text-blue-300 bg-blue-500/10 dark:bg-blue-400/15",
  copied: "text-blue-600 dark:text-blue-300 bg-blue-500/10 dark:bg-blue-400/15",
  untracked: "text-foreground/50 bg-foreground/[0.08]",
  unmerged: "text-red-600 dark:text-red-300 bg-red-500/10 dark:bg-red-400/15",
};

export const STATUS_LETTERS: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "?",
  unmerged: "U",
};

export function formatWorktreeLabel(
  repo: { name: string; isPrimaryWorktree?: boolean; isWorktree?: boolean; isSubRepo?: boolean },
  options?: { showRoot?: boolean },
): string {
  const tags: string[] = [];

  if (repo.isSubRepo) {
    tags.push("sub");
    // Only tag linked worktrees within sub-repos (isPrimaryWorktree is true for
    // both root and sub-repos — it just means "not a linked worktree").
    if (repo.isWorktree && !repo.isPrimaryWorktree) tags.push("worktree");
  } else {
    // Root / non-sub repo
    if (options?.showRoot) tags.push("root");
    if (repo.isWorktree && !repo.isPrimaryWorktree) tags.push("worktree");
  }

  return tags.length > 0 ? repo.name + " (" + tags.join(", ") + ")" : repo.name;
}

export interface SelectorOption {
  value: string;
  label: string;
}

/** Shared interface for git actions passed from the hook to sub-components */
export interface GitActions {
  stage: (repoPath: string, files: string[]) => Promise<void>;
  unstage: (repoPath: string, files: string[]) => Promise<void>;
  stageAll: (repoPath: string) => Promise<void>;
  unstageAll: (repoPath: string) => Promise<void>;
  discard: (repoPath: string, files: string[]) => Promise<void>;
  commit: (repoPath: string, message: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
  checkout: (repoPath: string, branch: string) => Promise<{ ok?: boolean; error?: string } | undefined>;
  createBranch: (repoPath: string, name: string) => Promise<{ ok?: boolean; error?: string } | undefined>;
  createWorktree: (repoPath: string, worktreePath: string, branch: string, fromRef?: string) => Promise<{ ok?: boolean; path?: string; output?: string; error?: string } | undefined>;
  removeWorktree: (repoPath: string, worktreePath: string, force?: boolean) => Promise<{ ok?: boolean; output?: string; error?: string } | undefined>;
  pruneWorktrees: (repoPath: string) => Promise<{ ok?: boolean; output?: string; error?: string } | undefined>;
  push: (repoPath: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
  pull: (repoPath: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
  fetchRemote: (repoPath: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
  getDiff: (repoPath: string, file: string, staged: boolean) => Promise<{ diff?: string; error?: string } | null>;
}
