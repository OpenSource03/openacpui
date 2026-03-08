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
  onSelectWorktreePath?: (path: string | null) => Promise<{ ok?: boolean; error?: string } | void> | { ok?: boolean; error?: string } | void;
  confirmWorktreeRestart?: boolean;
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
  confirmWorktreeRestart = false,
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
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const [pendingWorktreePath, setPendingWorktreePath] = useState<string | null>(null);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [isApplyingWorktree, setIsApplyingWorktree] = useState(false);

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

  const applyWorktreeSelection = useCallback(async (nextPath: string | null) => {
    if (!onSelectWorktreePath) return true;

    setIsApplyingWorktree(true);
    setRestartError(null);
    try {
      const result = await onSelectWorktreePath(nextPath);
      if (result && "error" in result && result.error) {
        setRestartError(result.error);
        return false;
      }
      setRestartDialogOpen(false);
      setPendingWorktreePath(null);
      return true;
    } finally {
      setIsApplyingWorktree(false);
    }
  }, [onSelectWorktreePath]);

  const requestWorktreeSelection = useCallback((nextPath: string | null) => {
    const normalizedNext = nextPath?.trim() || null;
    const normalizedCurrent = selectedWorktreePath?.trim() || null;
    if (normalizedNext === normalizedCurrent) return;

    if (confirmWorktreeRestart && activeSessionId) {
      setPendingWorktreePath(normalizedNext);
      setRestartError(null);
      setRestartDialogOpen(true);
      return;
    }

    void applyWorktreeSelection(normalizedNext);
  }, [activeSessionId, applyWorktreeSelection, confirmWorktreeRestart, selectedWorktreePath]);

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
          <div className="mb-1 flex items-center gap-1">
            <label className="text-[10px] uppercase tracking-wider text-foreground/25">Agent Worktree</label>
            <div className="min-w-0 flex-1" />
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
          </div>
          <InlineSelector
            value={selectedCwdValue}
            onChange={requestWorktreeSelection}
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

      <Dialog
        open={restartDialogOpen}
        onOpenChange={(open) => {
          if (isApplyingWorktree) return;
          setRestartDialogOpen(open);
          if (!open) {
            setPendingWorktreePath(null);
            setRestartError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-sm">Restart Agent in Selected Worktree</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-foreground/75">
              The active session will restart so the agent runs in this worktree.
            </p>
            <div className="rounded border border-input bg-background px-2 py-1.5 font-mono text-xs text-foreground/80">
              {pendingWorktreePath ?? cwd ?? "Project root"}
            </div>
            <p className="text-xs text-muted-foreground">
              Conversation history is preserved. Any in-flight turn must finish first.
            </p>
            {restartError && (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300/90">
                {restartError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setRestartDialogOpen(false);
                setPendingWorktreePath(null);
                setRestartError(null);
              }}
              disabled={isApplyingWorktree}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                void applyWorktreeSelection(pendingWorktreePath);
              }}
              disabled={isApplyingWorktree}
            >
              {isApplyingWorktree ? "Restarting..." : "Restart Agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
