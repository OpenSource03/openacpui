import { memo, useCallback, useMemo, useState, useRef, useEffect, type KeyboardEvent } from "react";
import {
  GitBranch as GitBranchIcon,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Undo2,
  Check,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  FileText,
  History,
  Loader2,
  AlertCircle,
  X,
  Trash2,
  FolderGit2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGitStatus, type RepoState } from "@/hooks/useGitStatus";
import type { GitFileChange, GitFileGroup, GitBranch, GitRepoInfo, EngineId } from "@/types";

interface GitPanelProps {
  cwd?: string;
  collapsedRepos?: Set<string>;
  onToggleRepoCollapsed?: (path: string) => void;
  selectedWorktreePath?: string;
  onSelectWorktreePath?: (path: string | null) => void;
  /** Active session engine — used to route commit message generation */
  activeEngine?: EngineId;
  /** Active session ID — used for ACP utility prompts */
  activeSessionId?: string | null;
}

function formatWorktreeLabel(repo: GitRepoInfo): string {
  const tags: string[] = [];
  if (repo.isPrimaryWorktree) tags.push("main");
  else if (repo.isWorktree) tags.push("worktree");
  if (repo.isSubRepo) tags.push("sub");
  return tags.length > 0 ? repo.name + " (" + tags.join(", ") + ")" : repo.name;
}

interface SelectorOption {
  value: string;
  label: string;
}

function InlineSelector({
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectorOption[];
  disabled?: boolean;
  className?: string;
}) {
  const selected = options.find((opt) => opt.value === value) ?? options[0];
  const rootClass = [
    "flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-[11px] text-foreground/70 transition-colors hover:bg-foreground/[0.07] disabled:cursor-not-allowed disabled:opacity-40",
    className ?? "bg-foreground/[0.04]",
  ].join(" ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || options.length === 0}
          className={rootClass}
        >
          <span className="min-w-0 flex-1 truncate text-start">{selected?.label ?? "Select..."}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-foreground/25" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            className="cursor-pointer text-xs"
            onClick={() => onChange(opt.value)}
          >
            <span className="me-1.5 inline-flex w-3 items-center justify-center">
              {opt.value === selected?.value ? <Check className="h-3 w-3" /> : null}
            </span>
            <span className="truncate">{opt.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const GitPanel = memo(function GitPanel({
  cwd,
  collapsedRepos,
  onToggleRepoCollapsed,
  selectedWorktreePath,
  onSelectWorktreePath,
  activeEngine,
  activeSessionId,
}: GitPanelProps) {
  const git = useGitStatus({ projectPath: cwd });

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createSourcePath, setCreateSourcePath] = useState("");
  const [createWorktreePath, setCreateWorktreePath] = useState("");
  const [createBranchName, setCreateBranchName] = useState("");
  const [createFromRef, setCreateFromRef] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);

  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeSourcePath, setRemoveSourcePath] = useState("");
  const [removeTargetPath, setRemoveTargetPath] = useState("");
  const [removeForce, setRemoveForce] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [isRemovingWorktree, setIsRemovingWorktree] = useState(false);
  const [isPruningWorktrees, setIsPruningWorktrees] = useState(false);

  const selectableRepos = useMemo(() => git.repoStates.map((rs) => rs.repo), [git.repoStates]);
  const linkedWorktrees = useMemo(
    () => selectableRepos.filter((repo) => repo.isWorktree && !repo.isPrimaryWorktree),
    [selectableRepos],
  );
  const repoOptions = useMemo(
    () => selectableRepos.map((repo) => ({ value: repo.path, label: formatWorktreeLabel(repo) })),
    [selectableRepos],
  );
  const linkedWorktreeOptions = useMemo(
    () => linkedWorktrees.map((repo) => ({ value: repo.path, label: repo.path })),
    [linkedWorktrees],
  );

  const selectedCwdValue = useMemo(() => {
    if (selectableRepos.length === 0) return "";
    if (selectedWorktreePath && selectableRepos.some((repo) => repo.path === selectedWorktreePath)) {
      return selectedWorktreePath;
    }
    if (cwd && selectableRepos.some((repo) => repo.path === cwd)) return cwd;
    return selectableRepos[0].path;
  }, [selectableRepos, selectedWorktreePath, cwd]);

  const openCreateDialog = useCallback(() => {
    setCreateError(null);
    setCreateDialogOpen(true);
    setCreateSourcePath((prev) => prev || selectedCwdValue || selectableRepos[0]?.path || "");
  }, [selectedCwdValue, selectableRepos]);

  const openRemoveDialog = useCallback(() => {
    setRemoveError(null);
    setRemoveDialogOpen(true);
    const defaultSource = removeSourcePath || selectedCwdValue || selectableRepos[0]?.path || "";
    setRemoveSourcePath(defaultSource);
    setRemoveTargetPath((prev) => {
      if (prev && linkedWorktrees.some((repo) => repo.path === prev)) return prev;
      return linkedWorktrees[0]?.path || "";
    });
  }, [linkedWorktrees, removeSourcePath, selectedCwdValue, selectableRepos]);

  const handleRemoveWorktree = useCallback(async () => {
    if (!removeSourcePath || !removeTargetPath) return;
    setIsRemovingWorktree(true);
    setRemoveError(null);
    try {
      const result = await git.removeWorktree(removeSourcePath, removeTargetPath, removeForce);
      if (result?.error) {
        setRemoveError(result.error);
        return;
      }
      if (selectedWorktreePath === removeTargetPath) onSelectWorktreePath?.(null);
      setRemoveDialogOpen(false);
      setRemoveTargetPath("");
      setRemoveForce(false);
      setRemoveError(null);
    } finally {
      setIsRemovingWorktree(false);
    }
  }, [git, onSelectWorktreePath, removeForce, removeSourcePath, removeTargetPath, selectedWorktreePath]);

  const handlePruneWorktrees = useCallback(async () => {
    if (!removeSourcePath) return;
    setIsPruningWorktrees(true);
    try {
      const result = await git.pruneWorktrees(removeSourcePath);
      if (result?.error) setRemoveError(result.error);
    } finally {
      setIsPruningWorktrees(false);
    }
  }, [git, removeSourcePath]);

  const handleCreateWorktree = useCallback(async () => {
    if (!createSourcePath || !createWorktreePath.trim() || !createBranchName.trim()) return;

    setIsCreatingWorktree(true);
    setCreateError(null);
    try {
      const result = await git.createWorktree(
        createSourcePath,
        createWorktreePath.trim(),
        createBranchName.trim(),
        createFromRef.trim() || undefined,
      );
      if (result?.error) {
        setCreateError(result.error);
        return;
      }

      const nextPath = result?.path ?? createWorktreePath.trim();
      onSelectWorktreePath?.(nextPath);
      setCreateDialogOpen(false);
      setCreateWorktreePath("");
      setCreateBranchName("");
      setCreateFromRef("");
      setCreateError(null);
    } finally {
      setIsCreatingWorktree(false);
    }
  }, [createSourcePath, createWorktreePath, createBranchName, createFromRef, git, onSelectWorktreePath]);

  if (!cwd) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-foreground/30">No project open</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1.5 ps-1.5">
          <GitBranchIcon className="h-3.5 w-3.5 text-foreground/40" />
          <span className="text-xs font-medium text-foreground/50">Source Control</span>
        </div>
        <div className="min-w-0 flex-1" />
        {git.isLoading && <Loader2 className="h-3 w-3 animate-spin text-foreground/20" />}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-foreground/30 hover:text-foreground/60"
              onClick={openCreateDialog}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <p className="text-xs">Create Worktree</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-foreground/30 hover:text-foreground/60 disabled:opacity-30"
              onClick={openRemoveDialog}
              disabled={linkedWorktrees.length === 0}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <p className="text-xs">Remove Worktree</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-foreground/30 hover:text-foreground/60"
              onClick={() => git.refreshAll()}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <p className="text-xs">Refresh All</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {onSelectWorktreePath && repoOptions.length > 0 && (
        <div className="px-3 pb-2">
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-foreground/25">Agent Worktree</label>
          <InlineSelector
            value={selectedCwdValue}
            onChange={onSelectWorktreePath}
            options={repoOptions}
          />
        </div>
      )}

      <div className="border-t border-foreground/[0.06]" />

      {/* Scrollable list of all repos */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {git.repoStates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8">
            <FolderGit2 className="mb-2 h-5 w-5 text-foreground/15" />
            <p className="text-[11px] text-foreground/25">No git repos found</p>
          </div>
        )}

        {git.repoStates.map((rs, i) => (
          <div key={rs.repo.path}>
            {i > 0 && (
              <div className="mx-3 border-t border-foreground/[0.08]" />
            )}
            <RepoSection
              repoState={rs}
              git={git}
              collapsed={collapsedRepos?.has(rs.repo.path) ?? false}
              onToggleCollapsed={onToggleRepoCollapsed ? () => onToggleRepoCollapsed(rs.repo.path) : undefined}
              activeEngine={activeEngine}
              activeSessionId={activeSessionId}
            />
          </div>
        ))}
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Create Worktree</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Source Repository</label>
              <InlineSelector
                value={createSourcePath}
                onChange={setCreateSourcePath}
                options={repoOptions}
                className="h-8 border border-input bg-background"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Branch</label>
              <input
                type="text"
                value={createBranchName}
                onChange={(e) => setCreateBranchName(e.target.value)}
                placeholder="feature/my-work"
                className="h-8 w-full rounded border border-input bg-background px-2 text-xs text-foreground/80 outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Worktree Path</label>
              <input
                type="text"
                value={createWorktreePath}
                onChange={(e) => setCreateWorktreePath(e.target.value)}
                placeholder="../repo-feature-my-work"
                className="h-8 w-full rounded border border-input bg-background px-2 text-xs text-foreground/80 outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From Ref (optional)</label>
              <input
                type="text"
                value={createFromRef}
                onChange={(e) => setCreateFromRef(e.target.value)}
                placeholder="origin/main"
                className="h-8 w-full rounded border border-input bg-background px-2 text-xs text-foreground/80 outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {createError && (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300/90">
                {createError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleCreateWorktree}
              disabled={!createSourcePath || !createWorktreePath.trim() || !createBranchName.trim() || isCreatingWorktree}
            >
              {isCreatingWorktree ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Remove Worktree</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Repository</label>
              <InlineSelector
                value={removeSourcePath}
                onChange={setRemoveSourcePath}
                options={repoOptions}
                className="h-8 border border-input bg-background"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Worktree</label>
              <InlineSelector
                value={removeTargetPath}
                onChange={setRemoveTargetPath}
                options={linkedWorktreeOptions}
                disabled={linkedWorktreeOptions.length === 0}
                className="h-8 border border-input bg-background"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-foreground/70">
              <input
                type="checkbox"
                checked={removeForce}
                onChange={(e) => setRemoveForce(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Force remove
            </label>

            {removeError && (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300/90">
                {removeError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handlePruneWorktrees}
              disabled={!removeSourcePath || isPruningWorktrees}
            >
              {isPruningWorktrees ? "Pruning..." : "Prune"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setRemoveDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleRemoveWorktree}
              disabled={!removeSourcePath || !removeTargetPath || isRemovingWorktree}
            >
              {isRemovingWorktree ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

// ── Per-repo section ──

interface GitActions {
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

function RepoSection({ repoState, git, collapsed: collapsedProp, onToggleCollapsed, activeEngine, activeSessionId }: {
  repoState: RepoState;
  git: GitActions;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  activeEngine?: EngineId;
  activeSessionId?: string | null;
}) {
  const { repo, status, branches, log } = repoState;
  const cwd = repo.path;

  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = onToggleCollapsed ? (collapsedProp ?? false) : localCollapsed;
  const [commitMessage, setCommitMessage] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<GitFileGroup>>(
    new Set(["staged", "unstaged", "untracked"]),
  );
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const branchPickerRef = useRef<HTMLDivElement>(null);

  // Close branch picker on click outside
  useEffect(() => {
    if (!showBranchPicker) return;
    const handler = (e: MouseEvent) => {
      if (branchPickerRef.current && !branchPickerRef.current.contains(e.target as Node)) {
        setShowBranchPicker(false);
        setBranchFilter("");
        setShowNewBranch(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showBranchPicker]);

  const toggleSection = useCallback((group: GitFileGroup) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const stagedFiles = useMemo(
    () => status?.files.filter((f) => f.group === "staged") ?? [],
    [status?.files],
  );
  const unstagedFiles = useMemo(
    () => status?.files.filter((f) => f.group === "unstaged") ?? [],
    [status?.files],
  );
  const untrackedFiles = useMemo(
    () => status?.files.filter((f) => f.group === "untracked") ?? [],
    [status?.files],
  );

  const totalChanges = stagedFiles.length + unstagedFiles.length + untrackedFiles.length;

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || stagedFiles.length === 0) return;
    const result = await git.commit(cwd, commitMessage.trim());
    if (!result.error) {
      setCommitMessage("");
    } else {
      setSyncError(result.error);
    }
  }, [commitMessage, stagedFiles.length, git, cwd]);

  const handleCommitKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

  const handleGenerateMessage = useCallback(async () => {
    setGeneratingMessage(true);
    try {
      const result = await window.claude.git.generateCommitMessage(
        cwd,
        activeEngine,
        activeEngine === "acp" && activeSessionId ? activeSessionId : undefined,
      );
      if (result.message) {
        setCommitMessage(result.message);
      } else if (result.error) {
        setSyncError(result.error);
      }
    } finally {
      setGeneratingMessage(false);
    }
  }, [cwd, activeEngine, activeSessionId]);

  const handleViewDiff = useCallback(
    async (file: GitFileChange) => {
      const key = `${file.group}:${file.path}`;
      if (expandedDiff === key) {
        setExpandedDiff(null);
        setDiffContent(null);
        return;
      }
      setExpandedDiff(key);
      setDiffContent(null);
      const result = await git.getDiff(cwd, file.path, file.group === "staged");
      if (result && "diff" in result && result.diff) {
        setDiffContent(result.diff);
      } else {
        setDiffContent("(no diff available)");
      }
    },
    [expandedDiff, git, cwd],
  );

  const handleCheckout = useCallback(
    async (branch: string) => {
      setShowBranchPicker(false);
      setBranchFilter("");
      const result = await git.checkout(cwd, branch);
      if (result?.error) setSyncError(result.error);
    },
    [git, cwd],
  );

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return;
    const result = await git.createBranch(cwd, newBranchName.trim());
    if (result?.error) {
      setSyncError(result.error);
    } else {
      setNewBranchName("");
      setShowNewBranch(false);
      setShowBranchPicker(false);
    }
  }, [newBranchName, git, cwd]);

  const handleSync = useCallback(
    async (action: "push" | "pull" | "fetch") => {
      setSyncError(null);
      const fn = action === "push" ? git.push : action === "pull" ? git.pull : git.fetchRemote;
      const result = await fn(cwd);
      if (result.error) setSyncError(result.error);
    },
    [git, cwd],
  );

  const filteredBranches = useMemo(() => {
    if (!branchFilter) return branches;
    const q = branchFilter.toLowerCase();
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, branchFilter]);

  const localBranches = useMemo(
    () => filteredBranches.filter((b) => !b.isRemote),
    [filteredBranches],
  );
  const remoteBranches = useMemo(
    () => filteredBranches.filter((b) => b.isRemote),
    [filteredBranches],
  );

  return (
    <div className="py-2">
      {/* Repo name — collapsible header */}
      <button
        type="button"
        onClick={() => onToggleCollapsed ? onToggleCollapsed() : setLocalCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 px-3 pb-1.5 cursor-pointer"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-foreground/30" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-foreground/30" />
        )}
        <FolderGit2 className="h-3 w-3 shrink-0 text-foreground/30" />
        <span className="text-[11px] font-medium text-foreground/55">{repo.name}</span>
        {repo.isSubRepo && (
          <span className="rounded bg-foreground/[0.06] px-1 text-[9px] text-foreground/25">sub</span>
        )}
        {repo.isWorktree && !repo.isPrimaryWorktree && (
          <span className="rounded bg-foreground/[0.06] px-1 text-[9px] text-foreground/25">wt</span>
        )}
        {totalChanges > 0 && (
          <span className="rounded-full bg-foreground/[0.08] px-1.5 text-[10px] text-foreground/40">
            {totalChanges}
          </span>
        )}
        {collapsed && status?.branch && (
          <span className="ms-auto flex items-center gap-1 text-[10px] text-foreground/30">
            <GitBranchIcon className="h-2.5 w-2.5" />
            {status.branch}
          </span>
        )}
      </button>

      {collapsed ? null : <>
      {/* Branch selector */}
      <div className="relative px-3 pb-1" ref={branchPickerRef}>
        <button
          type="button"
          onClick={() => setShowBranchPicker(!showBranchPicker)}
          className="flex w-full items-center gap-1.5 rounded bg-foreground/[0.04] px-2 py-1.5 text-[11px] transition-colors hover:bg-foreground/[0.07] cursor-pointer"
        >
          <GitBranchIcon className="h-3 w-3 shrink-0 text-foreground/40" />
          <span className="truncate text-foreground/70">{status?.branch ?? "..."}</span>
          {(status?.ahead ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-400/70">
              <ArrowUp className="h-2.5 w-2.5" />{status?.ahead}
            </span>
          )}
          {(status?.behind ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-amber-400/70">
              <ArrowDown className="h-2.5 w-2.5" />{status?.behind}
            </span>
          )}
          <ChevronDown className="ms-auto h-3 w-3 shrink-0 text-foreground/25" />
        </button>

        {/* Branch dropdown */}
        {showBranchPicker && (
          <div className="absolute inset-x-3 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-foreground/[0.08] bg-[var(--background)] shadow-xl">
            <div className="sticky top-0 border-b border-foreground/[0.06] bg-[var(--background)] p-1.5">
              <input
                type="text"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                placeholder="Filter branches..."
                className="w-full rounded bg-foreground/[0.05] px-2 py-1 text-[11px] text-foreground/70 outline-none placeholder:text-foreground/20"
                autoFocus
              />
            </div>

            {showNewBranch ? (
              <div className="flex items-center gap-1 border-b border-foreground/[0.06] p-1.5">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateBranch();
                    if (e.key === "Escape") { setShowNewBranch(false); setNewBranchName(""); }
                  }}
                  placeholder="New branch name..."
                  className="min-w-0 flex-1 rounded bg-foreground/[0.05] px-2 py-1 text-[11px] text-foreground/70 outline-none placeholder:text-foreground/20"
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0 text-emerald-400/60 hover:text-emerald-400"
                  onClick={handleCreateBranch}
                  disabled={!newBranchName.trim()}
                >
                  <Check className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowNewBranch(true)}
                className="flex w-full items-center gap-1.5 border-b border-foreground/[0.06] px-3 py-1.5 text-[11px] text-foreground/40 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/60 cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                Create new branch
              </button>
            )}

            {localBranches.length > 0 && (
              <div>
                <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground/25">Local</div>
                {localBranches.map((b) => (
                  <BranchItem key={b.name} branch={b} onSelect={handleCheckout} />
                ))}
              </div>
            )}
            {remoteBranches.length > 0 && (
              <div>
                <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground/25">Remote</div>
                {remoteBranches.map((b) => (
                  <BranchItem key={b.name} branch={b} onSelect={handleCheckout} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sync buttons */}
      <div className="flex items-center gap-0.5 px-3 pb-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-foreground/30 hover:text-foreground/60" onClick={() => handleSync("fetch")}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p className="text-xs">Fetch</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-foreground/30 hover:text-foreground/60" onClick={() => handleSync("pull")}>
              <ArrowDown className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p className="text-xs">Pull</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-foreground/30 hover:text-foreground/60" onClick={() => handleSync("push")}>
              <ArrowUp className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p className="text-xs">Push</p></TooltipContent>
        </Tooltip>
        {(status?.ahead ?? 0) > 0 && (
          <span className="ms-1 text-[10px] text-emerald-400/50">{status?.ahead} to push</span>
        )}
        {(status?.behind ?? 0) > 0 && (
          <span className="ms-1 text-[10px] text-amber-400/50">{status?.behind} to pull</span>
        )}
      </div>

      {/* Sync error */}
      {syncError && (
        <div className="mx-3 mb-1 flex items-start gap-1.5 rounded bg-red-500/10 px-2 py-1.5">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-400/60" />
          <p className="min-w-0 flex-1 text-[10px] text-red-400/70 wrap-break-word">{syncError}</p>
          <button type="button" onClick={() => setSyncError(null)} className="shrink-0 text-red-400/40 hover:text-red-400/60 cursor-pointer">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Commit input */}
      <div className="px-3 pt-1 pb-1">
        <div className="relative">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={handleCommitKeyDown}
            placeholder="Commit message"
            rows={2}
            className="w-full resize-none rounded bg-foreground/[0.04] px-2 py-1.5 pe-14 text-[11px] text-foreground/70 outline-none transition-colors placeholder:text-foreground/20 focus:bg-foreground/[0.07] focus:ring-1 focus:ring-foreground/[0.08]"
          />
          <div className="absolute end-1.5 top-1.5 flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleGenerateMessage}
                  disabled={generatingMessage || totalChanges === 0}
                  className="flex h-5 w-5 items-center justify-center rounded text-foreground/30 transition-colors hover:text-foreground/60 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
                >
                  {generatingMessage ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={4}>
                <p className="text-xs">Generate commit message</p>
                <p className="text-[10px] text-background/60">Respects CLAUDE.md rules</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={!commitMessage.trim() || stagedFiles.length === 0}
                  className="flex h-5 w-5 items-center justify-center rounded text-foreground/30 transition-colors hover:text-foreground/60 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={4}>
                <p className="text-xs">
                  Commit {stagedFiles.length > 0 ? `(${stagedFiles.length} file${stagedFiles.length > 1 ? "s" : ""})` : ""}
                  <span className="ms-1 text-foreground/40">Cmd+Enter</span>
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Changes sections */}
      {stagedFiles.length > 0 && (
        <ChangesSection
          label="Staged Changes"
          count={stagedFiles.length}
          group="staged"
          files={stagedFiles}
          expanded={expandedSections.has("staged")}
          onToggle={() => toggleSection("staged")}
          onStageAll={undefined}
          onUnstageAll={() => git.unstageAll(cwd)}
          onStage={undefined}
          onUnstage={(f) => git.unstage(cwd, [f.path])}
          onDiscard={undefined}
          onViewDiff={handleViewDiff}
          expandedDiff={expandedDiff}
          diffContent={diffContent}
        />
      )}
      {unstagedFiles.length > 0 && (
        <ChangesSection
          label="Changes"
          count={unstagedFiles.length}
          group="unstaged"
          files={unstagedFiles}
          expanded={expandedSections.has("unstaged")}
          onToggle={() => toggleSection("unstaged")}
          onStageAll={() => git.stageAll(cwd)}
          onUnstageAll={undefined}
          onStage={(f) => git.stage(cwd, [f.path])}
          onUnstage={undefined}
          onDiscard={(f) => git.discard(cwd, [f.path])}
          onViewDiff={handleViewDiff}
          expandedDiff={expandedDiff}
          diffContent={diffContent}
        />
      )}
      {untrackedFiles.length > 0 && (
        <ChangesSection
          label="Untracked"
          count={untrackedFiles.length}
          group="untracked"
          files={untrackedFiles}
          expanded={expandedSections.has("untracked")}
          onToggle={() => toggleSection("untracked")}
          onStageAll={() => git.stage(cwd, untrackedFiles.map((f) => f.path))}
          onUnstageAll={undefined}
          onStage={(f) => git.stage(cwd, [f.path])}
          onUnstage={undefined}
          onDiscard={(f) => git.discard(cwd, [f.path])}
          onViewDiff={undefined}
          expandedDiff={expandedDiff}
          diffContent={diffContent}
        />
      )}

      {totalChanges === 0 && status && (
        <div className="flex flex-col items-center justify-center py-4">
          <Check className="mb-1 h-4 w-4 text-foreground/15" />
          <p className="text-[10px] text-foreground/25">No changes</p>
        </div>
      )}

      {/* Log section */}
      <div className="mt-0.5">
        <button
          type="button"
          onClick={() => setShowLog(!showLog)}
          className="flex w-full items-center gap-1.5 px-3 py-1 text-[11px] text-foreground/40 transition-colors hover:bg-foreground/[0.03] cursor-pointer"
        >
          {showLog ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <History className="h-3 w-3 shrink-0" />
          <span className="font-medium">Commits</span>
          <span className="ms-auto text-[10px] text-foreground/20">{log.length}</span>
        </button>
        {showLog && (
          <div className="pb-1">
            {log.map((entry) => (
              <div key={entry.hash} className="flex items-baseline gap-2 px-3 py-0.5 text-[10px] hover:bg-foreground/[0.03]">
                <span className="shrink-0 font-mono text-foreground/30">{entry.shortHash}</span>
                <span className="min-w-0 flex-1 truncate text-foreground/55">{entry.subject}</span>
                <span className="shrink-0 text-foreground/20">{formatRelativeDate(entry.date)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </>}
    </div>
  );
}

// ── Sub-components ──

function BranchItem({ branch, onSelect }: { branch: GitBranch; onSelect: (name: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(branch.name)}
      className={`flex w-full items-center gap-1.5 px-3 py-1 text-[11px] transition-colors hover:bg-foreground/[0.05] cursor-pointer ${
        branch.isCurrent ? "text-foreground/80" : "text-foreground/50"
      }`}
    >
      {branch.isCurrent && <Check className="h-2.5 w-2.5 shrink-0 text-emerald-400/60" />}
      <span className={`truncate ${branch.isCurrent ? "" : "ps-4"}`}>{branch.name}</span>
      {branch.ahead !== undefined && branch.ahead > 0 && (
        <span className="text-[9px] text-emerald-400/50">+{branch.ahead}</span>
      )}
      {branch.behind !== undefined && branch.behind > 0 && (
        <span className="text-[9px] text-amber-400/50">-{branch.behind}</span>
      )}
    </button>
  );
}

const STATUS_COLORS: Record<string, string> = {
  modified: "text-amber-400/70 bg-amber-400/10",
  added: "text-emerald-400/70 bg-emerald-400/10",
  deleted: "text-red-400/70 bg-red-400/10",
  renamed: "text-blue-400/70 bg-blue-400/10",
  copied: "text-blue-400/70 bg-blue-400/10",
  untracked: "text-foreground/35 bg-foreground/[0.06]",
  unmerged: "text-red-400/70 bg-red-400/10",
};

const STATUS_LETTERS: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "?",
  unmerged: "U",
};

interface ChangesSectionProps {
  label: string;
  count: number;
  group: GitFileGroup;
  files: GitFileChange[];
  expanded: boolean;
  onToggle: () => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onStage?: (file: GitFileChange) => void;
  onUnstage?: (file: GitFileChange) => void;
  onDiscard?: (file: GitFileChange) => void;
  onViewDiff?: (file: GitFileChange) => void;
  expandedDiff: string | null;
  diffContent: string | null;
}

function ChangesSection({
  label, count, group, files, expanded, onToggle,
  onStageAll, onUnstageAll, onStage, onUnstage, onDiscard, onViewDiff,
  expandedDiff, diffContent,
}: ChangesSectionProps) {
  return (
    <div>
      <div className="group flex items-center px-2 py-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-medium text-foreground/45 cursor-pointer"
        >
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span>{label}</span>
          <span className="ms-1 rounded-full bg-foreground/[0.06] px-1.5 text-[10px] text-foreground/30">{count}</span>
        </button>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {onStageAll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onStageAll} className="flex h-4 w-4 items-center justify-center rounded text-foreground/30 hover:text-foreground/60 cursor-pointer">
                  <Plus className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left"><p className="text-xs">Stage All</p></TooltipContent>
            </Tooltip>
          )}
          {onUnstageAll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onUnstageAll} className="flex h-4 w-4 items-center justify-center rounded text-foreground/30 hover:text-foreground/60 cursor-pointer">
                  <Minus className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left"><p className="text-xs">Unstage All</p></TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      {expanded && (
        <div className="pb-1">
          {files.map((file) => {
            const diffKey = `${group}:${file.path}`;
            const isExpanded = expandedDiff === diffKey;
            return (
              <div key={file.path}>
                <FileItem file={file} onStage={onStage} onUnstage={onUnstage} onDiscard={onDiscard} onViewDiff={onViewDiff} isExpanded={isExpanded} />
                {isExpanded && diffContent !== null && <InlineDiff diff={diffContent} />}
                {isExpanded && diffContent === null && (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="h-3 w-3 animate-spin text-foreground/20" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FileItem({
  file, onStage, onUnstage, onDiscard, onViewDiff, isExpanded,
}: {
  file: GitFileChange;
  onStage?: (f: GitFileChange) => void;
  onUnstage?: (f: GitFileChange) => void;
  onDiscard?: (f: GitFileChange) => void;
  onViewDiff?: (f: GitFileChange) => void;
  isExpanded: boolean;
}) {
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
  const statusColor = STATUS_COLORS[file.status] ?? "text-foreground/40 bg-foreground/[0.06]";
  const statusLetter = STATUS_LETTERS[file.status] ?? "?";

  return (
    <div className={`group flex items-center gap-1.5 px-3 py-[3px] text-[11px] transition-colors hover:bg-foreground/[0.04] ${isExpanded ? "bg-foreground/[0.03]" : ""}`}>
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold ${statusColor}`}>
        {statusLetter}
      </span>
      <button
        type="button"
        onClick={() => onViewDiff?.(file)}
        className="flex min-w-0 flex-1 items-baseline gap-1 truncate cursor-pointer"
        disabled={!onViewDiff}
      >
        <FileText className="h-3 w-3 shrink-0 self-center text-foreground/20" />
        <span className="truncate text-foreground/65">{fileName}</span>
        {dirPath && <span className="truncate text-[10px] text-foreground/25">{dirPath}</span>}
        {file.oldPath && (
          <span className="truncate text-[10px] text-foreground/25">&larr; {file.oldPath.split("/").pop()}</span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {onDiscard && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => onDiscard(file)} className="flex h-4 w-4 items-center justify-center rounded text-foreground/25 hover:text-red-400/60 cursor-pointer">
                <Undo2 className="h-2.5 w-2.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left"><p className="text-xs">Discard</p></TooltipContent>
          </Tooltip>
        )}
        {onStage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => onStage(file)} className="flex h-4 w-4 items-center justify-center rounded text-foreground/25 hover:text-emerald-400/60 cursor-pointer">
                <Plus className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left"><p className="text-xs">Stage</p></TooltipContent>
          </Tooltip>
        )}
        {onUnstage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => onUnstage(file)} className="flex h-4 w-4 items-center justify-center rounded text-foreground/25 hover:text-amber-400/60 cursor-pointer">
                <Minus className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left"><p className="text-xs">Unstage</p></TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function InlineDiff({ diff }: { diff: string }) {
  if (!diff || diff === "(no diff available)") {
    return (
      <div className="mx-3 mb-1 rounded bg-foreground/[0.03] px-2 py-1.5 text-[10px] text-foreground/25 italic">
        No diff available
      </div>
    );
  }
  const lines = diff.split("\n");
  const contentLines = lines.filter(
    (l) => !l.startsWith("diff ") && !l.startsWith("index ") && !l.startsWith("---") && !l.startsWith("+++") && !l.startsWith("\\"),
  );
  return (
    <div className="mx-3 mb-1 max-h-48 overflow-auto rounded bg-foreground/[0.03]">
      <pre className="px-2 py-1 font-mono text-[10px] leading-relaxed">
        {contentLines.map((line, i) => {
          let color = "text-foreground/35";
          if (line.startsWith("+")) color = "text-emerald-400/60";
          else if (line.startsWith("-")) color = "text-red-400/60";
          else if (line.startsWith("@@")) color = "text-blue-400/40";
          return (
            <div key={i} className={color}>{line || " "}</div>
          );
        })}
      </pre>
    </div>
  );
}

function formatRelativeDate(iso: string): string {
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
