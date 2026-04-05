import { memo, useState, useCallback, useRef, useEffect } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { motion, AnimatePresence } from "motion/react";
import {
  GitBranch,
  Plus,
  X,
  Check,
  Loader2,
  AlertCircle,
  Sparkles,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorktreeChips, WORKTREE_SETUP_PATH } from "@/hooks/useWorktreeChips";
import { BOTTOM_CHAT_MAX_WIDTH_CLASS } from "@/lib/layout/constants";

const SETUP_PROMPT = `Analyze this project and generate a worktree setup configuration.

Your task:
1. Inspect the project structure to determine what a new worktree needs to be fully functional
2. Create the file \`.harnss/worktree.json\` with the appropriate setup commands

The configuration should reproduce the exact same working state as the original repo inside a new worktree.

Guidelines:
- Use only the \`"setup-worktree"\` key (cross-platform compatible)
- Detect the package manager by checking for lockfiles (bun.lockb, pnpm-lock.yaml, yarn.lock, package-lock.json) and install dependencies accordingly
- Copy every real environment file that exists (.env, .env.local, .env.development, .env.production, etc.) — skip example/template files
- Reference the original repo with \`$ROOT_WORKTREE_PATH\`
- Only include build steps if the project cannot function without them

Expected format for \`.harnss/worktree.json\`:
\`\`\`json
{
  "setup-worktree": [
    "pnpm install",
    "cp $ROOT_WORKTREE_PATH/.env .env",
    "cp $ROOT_WORKTREE_PATH/.env.local .env.local"
  ]
}
\`\`\`

Analyze this project now and create the \`.harnss/worktree.json\` file.`;

interface WorktreeBarProps {
  projectPath: string | undefined;
  selectedWorktreePath: string | null;
  onSelectWorktree: (path: string) => void;
  onSend?: (text: string) => void;
  isEmptySession: boolean;
}

export const WorktreeBar = memo(function WorktreeBar({
  projectPath,
  selectedWorktreePath,
  onSelectWorktree,
  onSend,
  isEmptySession,
}: WorktreeBarProps) {
  const { worktrees, hasSetupFile, refresh } = useWorktreeChips(projectPath);

  // Inline create form state
  const [showCreate, setShowCreate] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const isVisible = isEmptySession && !!projectPath && worktrees.length > 0;

  // Derive the worktree disk path from repo path + branch name
  const deriveWorktreePath = useCallback(
    (branch: string) => {
      const primaryWorktree = worktrees.find((w) => w.isPrimary);
      const repoPath = primaryWorktree?.path ?? projectPath ?? "";
      const lastSlash = repoPath.lastIndexOf("/");
      const parentDir = lastSlash > 0 ? repoPath.slice(0, lastSlash) : repoPath;
      const repoName = lastSlash > 0 ? repoPath.slice(lastSlash + 1) : repoPath;
      return `${parentDir}/${repoName}-${branch}`;
    },
    [worktrees, projectPath],
  );

  // Auto-focus input when create form opens
  useEffect(() => {
    if (showCreate) inputRef.current?.focus();
  }, [showCreate]);

  // Click-outside to close create form
  const closeCreateForm = useCallback(() => {
    setShowCreate(false);
    setBranchName("");
    setError(null);
  }, []);
  useClickOutside(formRef, closeCreateForm, showCreate);

  const handleCreate = useCallback(async () => {
    const trimmed = branchName.trim();
    if (!trimmed || !projectPath || isCreating) return;

    setIsCreating(true);
    setError(null);

    try {
      const primaryWorktree = worktrees.find((w) => w.isPrimary);
      const repoPath = primaryWorktree?.path ?? projectPath;
      const worktreePath = deriveWorktreePath(trimmed);

      const result = await window.claude.git.createWorktree(
        repoPath,
        worktreePath,
        trimmed,
      );

      if (result.error) {
        setError(result.error);
        return;
      }

      // Success — close form, refresh list, select the new worktree
      setShowCreate(false);
      setBranchName("");
      refresh();

      if (result.path) {
        onSelectWorktree(result.path);
      }

      // Show setup errors if any commands failed (worktree was still created)
      const failedSetup = result.setupResults?.filter((s) => !s.ok);
      if (failedSetup && failedSetup.length > 0) {
        setError(`Worktree created, but setup had errors:\n${failedSetup.map((s) => `• ${s.command}: ${s.error}`).join("\n")}`);
      } else {
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create worktree");
    } finally {
      setIsCreating(false);
    }
  }, [branchName, projectPath, worktrees, isCreating, refresh, onSelectWorktree, deriveWorktreePath]);

  const handleRemove = useCallback(async (worktreePath: string) => {
    if (!projectPath || removingPath) return;

    setRemovingPath(worktreePath);
    setError(null);

    try {
      const primaryWorktree = worktrees.find((w) => w.isPrimary);
      const repoPath = primaryWorktree?.path ?? projectPath;

      const result = await window.claude.git.removeWorktree(repoPath, worktreePath);

      if (result.error) {
        setError(result.error);
        return;
      }

      // If we removed the currently selected worktree, switch to primary
      if (worktreePath === selectedWorktreePath && primaryWorktree) {
        onSelectWorktree(primaryWorktree.path);
      }

      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove worktree");
    } finally {
      setRemovingPath(null);
    }
  }, [projectPath, worktrees, removingPath, selectedWorktreePath, onSelectWorktree, refresh]);

  const handleOpenSetupFile = useCallback(() => {
    if (!projectPath) return;
    window.claude.openInEditor(`${projectPath}/${WORKTREE_SETUP_PATH}`);
  }, [projectPath]);

  const handleFillWithAI = useCallback(() => {
    onSend?.(SETUP_PROMPT);
  }, [onSend]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className={`pointer-events-auto mx-auto w-full px-4 pb-2 ${BOTTOM_CHAT_MAX_WIDTH_CLASS}`}
        >
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
              {worktrees.map((wt) => {
                const isSelected = wt.path === selectedWorktreePath;
                const isRemoving = removingPath === wt.path;
                return (
                  <div key={wt.path} className="group/wt relative flex shrink-0 items-center">
                    <button
                      onClick={() => onSelectWorktree(wt.path)}
                      disabled={isRemoving}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                        isSelected
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border/30 bg-foreground/[0.04] text-foreground/55 hover:bg-foreground/[0.08] hover:text-foreground/75"
                      } ${isRemoving ? "opacity-50" : ""}`}
                    >
                      {isRemoving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <GitBranch className="h-3 w-3" />
                      )}
                      <span>{wt.branch}</span>
                    </button>
                    {/* Remove button — only for non-primary worktrees, on hover */}
                    {!wt.isPrimary && !isRemoving && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(wt.path);
                        }}
                        className="absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background/90 text-muted-foreground/60 opacity-0 shadow-sm transition-opacity hover:bg-background hover:text-destructive group-hover/wt:opacity-100"
                        title="Remove worktree"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Create worktree button */}
              {!showCreate && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border/30 px-2.5 py-1 text-xs font-medium text-foreground/35 transition-colors duration-150 hover:border-border/50 hover:bg-foreground/[0.04] hover:text-foreground/55"
                >
                  <Plus className="h-3 w-3" />
                  <span>Worktree</span>
                </button>
              )}
            </div>

            {/* Inline create form — shown below the chip row */}
            {showCreate && (
              <div
                ref={formRef}
                className="rounded-lg border border-border/40 bg-foreground/[0.03] px-3 py-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <GitBranch className="h-3 w-3 shrink-0 text-foreground/30" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={branchName}
                    onChange={(e) => {
                      setBranchName(e.target.value);
                      if (error) setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") {
                        setShowCreate(false);
                        setBranchName("");
                        setError(null);
                      }
                    }}
                    placeholder="Branch name for new worktree"
                    className="min-w-0 flex-1 bg-transparent text-xs text-foreground/75 outline-none placeholder:text-foreground/25"
                    disabled={isCreating}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 rounded-full text-emerald-600/80 hover:bg-emerald-500/15 hover:text-emerald-600 dark:text-emerald-300/80 dark:hover:text-emerald-300"
                    disabled={!branchName.trim() || isCreating}
                    onClick={handleCreate}
                  >
                    {isCreating ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 rounded-full text-muted-foreground/40 hover:text-foreground"
                    onClick={() => {
                      setShowCreate(false);
                      setBranchName("");
                      setError(null);
                    }}
                    disabled={isCreating}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                {/* Path preview — shown as the user types */}
                {branchName.trim() && (
                  <p className="mt-1.5 truncate text-[10px] font-mono text-foreground/25">
                    → {deriveWorktreePath(branchName.trim())}
                  </p>
                )}
              </div>
            )}

            {/* Setup file notification — persistent until .harnss/worktree.json exists */}
            {hasSetupFile === false && (
              <div className="flex items-center gap-3 rounded-lg border border-border/30 bg-foreground/[0.03] px-3 py-2.5">
                <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground/45">
                  Set up a worktree initialization script to auto-install dependencies and copy environment files.
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="xs"
                    className="h-7 rounded-md text-[11px]"
                    onClick={handleOpenSetupFile}
                  >
                    <Settings className="h-3 w-3" />
                    Settings
                  </Button>
                  <Button
                    size="xs"
                    className="h-7 rounded-md text-[11px]"
                    onClick={handleFillWithAI}
                    disabled={!onSend}
                  >
                    <Sparkles className="h-3 w-3" />
                    Generate with AI
                  </Button>
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-1.5 rounded-md border border-red-500/20 bg-red-500/[0.06] px-2 py-1.5">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-400/70" />
                <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-red-600/80 wrap-break-word dark:text-red-300/80">
                  {error}
                </p>
                <button
                  onClick={() => setError(null)}
                  className="shrink-0 text-red-400/50 hover:text-red-400"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
