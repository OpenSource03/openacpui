import { memo, useCallback, useMemo, useState } from "react";
import {
  GitBranch as GitBranchIcon,
  Plus,
  RefreshCw,
  Loader2,
  Trash2,
  FolderGit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PanelHeader } from "@/components/PanelHeader";
import { useGitStatus } from "@/hooks/useGitStatus";
import { RepoSection } from "./RepoSection";
import { InlineSelector } from "./InlineSelector";
import { formatWorktreeLabel } from "./git-panel-utils";
import type { EngineId } from "@/types";

interface GitPanelProps {
  cwd?: string;
  collapsedRepos?: Set<string>;
  onToggleRepoCollapsed?: (path: string) => void;
  selectedWorktreePath?: string | null;
  onSelectWorktreePath?: (path: string | null) => void;
  /** Active session engine — used to route commit message generation */
  activeEngine?: EngineId;
  /** Active session ID — used for ACP utility prompts */
  activeSessionId?: string | null;
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
  const hasSubRepos = useMemo(() => selectableRepos.some((r) => r.isSubRepo), [selectableRepos]);
  const linkedWorktrees = useMemo(
    () => selectableRepos.filter((repo) => repo.isWorktree && !repo.isPrimaryWorktree),
    [selectableRepos],
  );
  const repoOptions = useMemo(() => {
    const opts = selectableRepos.map((repo) => ({
      value: repo.path,
      label: formatWorktreeLabel(repo, { showRoot: hasSubRepos && !repo.isSubRepo }),
    }));

    // Always ensure the project root directory is available as an option.
    // When the root isn't a discovered git repo (e.g. a dir containing sub-repos),
    // we still need it so the user can point the agent at the root.
    if (cwd && !selectableRepos.some((r) => r.path === cwd)) {
      const rootName = cwd.split("/").pop() ?? cwd;
      opts.unshift({ value: cwd, label: `${rootName} (root)` });
    }

    return opts;
  }, [selectableRepos, hasSubRepos, cwd]);
  const linkedWorktreeOptions = useMemo(
    () => linkedWorktrees.map((repo) => ({ value: repo.path, label: repo.path })),
    [linkedWorktrees],
  );

  const selectedCwdValue = useMemo(() => {
    if (selectableRepos.length === 0 && !cwd) return "";
    if (selectedWorktreePath) {
      // Check discovered repos and the cwd itself
      if (selectedWorktreePath === cwd) return cwd;
      if (selectableRepos.some((repo) => repo.path === selectedWorktreePath)) return selectedWorktreePath;
    }
    // Default to project root
    return cwd ?? selectableRepos[0]?.path ?? "";
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

  const requestWorktreeSelection = useCallback((nextPath: string | null) => {
    const normalizedNext = nextPath?.trim() || null;
    const normalizedCurrent = selectedWorktreePath?.trim() || null;
    if (normalizedNext === normalizedCurrent) return;
    onSelectWorktreePath?.(normalizedNext);
  }, [onSelectWorktreePath, selectedWorktreePath]);

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
      if (selectedWorktreePath === removeTargetPath) {
        requestWorktreeSelection(null);
      }
      setRemoveDialogOpen(false);
      setRemoveTargetPath("");
      setRemoveForce(false);
      setRemoveError(null);
    } finally {
      setIsRemovingWorktree(false);
    }
  }, [git, removeForce, removeSourcePath, removeTargetPath, requestWorktreeSelection, selectedWorktreePath]);

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
      requestWorktreeSelection(nextPath);
      setCreateDialogOpen(false);
      setCreateWorktreePath("");
      setCreateBranchName("");
      setCreateFromRef("");
      setCreateError(null);
    } finally {
      setIsCreatingWorktree(false);
    }
  }, [createSourcePath, createWorktreePath, createBranchName, createFromRef, git, requestWorktreeSelection]);

  if (!cwd) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader icon={GitBranchIcon} label="Source Control" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.03]">
            <FolderGit2 className="h-4 w-4 text-foreground/15" />
          </div>
          <p className="text-[11px] text-foreground/30">No project open</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <PanelHeader icon={GitBranchIcon} label="Source Control">
        {git.isLoading && <Loader2 className="h-3 w-3 animate-spin text-foreground/25" />}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-foreground/35 hover:text-foreground/60"
              onClick={() => git.refreshAll()}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <p className="text-xs">Refresh All</p>
          </TooltipContent>
        </Tooltip>
      </PanelHeader>

      {onSelectWorktreePath && repoOptions.length > 0 && (
        <div className="px-3 pt-2 pb-2">
          <div className="mb-1.5 flex items-center gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-foreground/30">Agent Worktree</label>
            <div className="min-w-0 flex-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0 text-foreground/35 hover:text-foreground/60"
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
                  className="h-5 w-5 shrink-0 text-foreground/35 hover:text-foreground/60 disabled:opacity-30"
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
          </div>
          <InlineSelector
            value={selectedCwdValue}
            onChange={requestWorktreeSelection}
            options={repoOptions}
          />
        </div>
      )}

      {/* Scrollable list of all repos */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {git.repoStates.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.03]">
              <FolderGit2 className="h-4 w-4 text-foreground/15" />
            </div>
            <p className="text-[11px] text-foreground/30">No git repos found</p>
          </div>
        )}

        {git.repoStates.map((rs, i) => (
          <div key={rs.repo.path}>
            {i > 0 && (
              <div className="mx-3 my-1">
                <div className="h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
              </div>
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
