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
  modified: "text-amber-400/70 bg-amber-400/10",
  added: "text-emerald-400/70 bg-emerald-400/10",
  deleted: "text-red-400/70 bg-red-400/10",
  renamed: "text-blue-400/70 bg-blue-400/10",
  copied: "text-blue-400/70 bg-blue-400/10",
  untracked: "text-foreground/35 bg-foreground/[0.06]",
  unmerged: "text-red-400/70 bg-red-400/10",
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

export function formatWorktreeLabel(repo: { name: string; isPrimaryWorktree?: boolean; isWorktree?: boolean; isSubRepo?: boolean }): string {
  const tags: string[] = [];
  if (repo.isPrimaryWorktree) tags.push("main");
  else if (repo.isWorktree) tags.push("worktree");
  if (repo.isSubRepo) tags.push("sub");
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
