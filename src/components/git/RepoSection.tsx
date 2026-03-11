import { useCallback, useMemo, useState } from "react";
import {
  GitBranch as GitBranchIcon,
  ChevronDown,
  ChevronRight,
  Check,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  History,
  AlertCircle,
  X,
  FolderGit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BranchPicker } from "./BranchPicker";
import { CommitInput } from "./CommitInput";
import { ChangesSection } from "./ChangesSection";
import { formatRelativeDate, type GitActions } from "./git-panel-utils";
import type { RepoState } from "@/hooks/useGitStatus";
import type { GitFileChange, GitFileGroup, EngineId } from "@/types";

export interface RepoSectionProps {
  repoState: RepoState;
  git: GitActions;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  activeEngine?: EngineId;
  activeSessionId?: string | null;
}

export function RepoSection({ repoState, git, collapsed: collapsedProp, onToggleCollapsed, activeEngine, activeSessionId }: RepoSectionProps) {
  const { repo, status, branches, log, diffStat } = repoState;
  const cwd = repo.path;

  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = onToggleCollapsed ? (collapsedProp ?? false) : localCollapsed;
  const [expandedSections, setExpandedSections] = useState<Set<GitFileGroup>>(
    new Set(["staged", "unstaged", "untracked"]),
  );
  const [showLog, setShowLog] = useState(false);
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

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

  const handleCommit = useCallback(async (message: string) => {
    const result = await git.commit(cwd, message);
    if (result.error) {
      setSyncError(result.error);
    }
  }, [git, cwd]);

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
      const result = await git.checkout(cwd, branch);
      if (result?.error) setSyncError(result.error);
    },
    [git, cwd],
  );

  const handleCreateBranch = useCallback(async (name: string) => {
    const result = await git.createBranch(cwd, name);
    if (result?.error) {
      setSyncError(result.error);
    }
  }, [git, cwd]);

  const handleSync = useCallback(
    async (action: "push" | "pull" | "fetch") => {
      setSyncError(null);
      const fn = action === "push" ? git.push : action === "pull" ? git.pull : git.fetchRemote;
      const result = await fn(cwd);
      if (result.error) setSyncError(result.error);
    },
    [git, cwd],
  );

  return (
    <div className="py-1">
      {/* Repo name — collapsible header */}
      <button
        type="button"
        onClick={() => onToggleCollapsed ? onToggleCollapsed() : setLocalCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 px-3 pt-0.5 pb-1.5 cursor-pointer hover:bg-foreground/[0.03] transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-foreground/45" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-foreground/45" />
        )}
        <div className="flex h-4 w-4 items-center justify-center rounded bg-foreground/[0.06]">
          <FolderGit2 className="h-2.5 w-2.5 shrink-0 text-foreground/50" />
        </div>
        <span className="min-w-0 truncate text-[11px] font-semibold text-foreground/75">{repo.name}</span>
        {repo.isSubRepo && (
          <span className="rounded-sm bg-foreground/[0.08] px-1 py-px text-[9px] font-medium text-foreground/45">sub</span>
        )}
        {repo.isWorktree && !repo.isPrimaryWorktree && (
          <span className="rounded-sm bg-blue-500/15 px-1 py-px text-[9px] font-semibold text-blue-600/80 dark:text-blue-300/80">wt</span>
        )}
        {totalChanges > 0 && (
          <span className="rounded-full bg-foreground/[0.08] px-1.5 py-px text-[10px] font-semibold tabular-nums text-foreground/60">
            {totalChanges}
          </span>
        )}
        {!collapsed && (diffStat.additions > 0 || diffStat.deletions > 0) && (
          <span className="ms-auto flex items-center gap-1 text-[10px] font-medium tabular-nums">
            {diffStat.additions > 0 && <span className="text-emerald-600 dark:text-emerald-300">+{diffStat.additions}</span>}
            {diffStat.deletions > 0 && <span className="text-red-600 dark:text-red-300">-{diffStat.deletions}</span>}
          </span>
        )}
        {collapsed && status?.branch && (
          <span className="ms-auto flex items-center gap-1 text-[10px] text-foreground/45">
            <GitBranchIcon className="h-2.5 w-2.5" />
            {status.branch}
          </span>
        )}
      </button>

      {collapsed ? null : <>
      {/* Branch selector + sync actions */}
      <div className="flex items-center gap-0.5 px-3 pb-1">
        <BranchPicker
          currentBranch={status?.branch}
          branches={branches}
          onCheckout={handleCheckout}
          onCreateBranch={handleCreateBranch}
          className="min-w-0 flex-1"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-foreground/40 hover:text-foreground/75 hover:bg-foreground/[0.07]" onClick={() => handleSync("fetch")}>
              <RefreshCw className="h-2.5 w-2.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p className="text-xs">Fetch</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-foreground/40 hover:text-foreground/75 hover:bg-foreground/[0.07]" onClick={() => handleSync("pull")}>
              <ArrowDown className="h-2.5 w-2.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p className="text-xs">Pull</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-foreground/40 hover:text-foreground/75 hover:bg-foreground/[0.07]" onClick={() => handleSync("push")}>
              <ArrowUp className="h-2.5 w-2.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p className="text-xs">Push</p></TooltipContent>
        </Tooltip>
        {(status?.ahead ?? 0) > 0 && (
          <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1 py-px text-[9px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-300">
            <ArrowUp className="h-2 w-2" />{status?.ahead}
          </span>
        )}
        {(status?.behind ?? 0) > 0 && (
          <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1 py-px text-[9px] font-semibold tabular-nums text-amber-600 dark:text-amber-300">
            <ArrowDown className="h-2 w-2" />{status?.behind}
          </span>
        )}
      </div>

      {/* Sync error */}
      {syncError && (
        <div className="mx-3 mb-1 flex items-start gap-1.5 rounded-md border border-red-500/25 bg-red-500/[0.08] px-2 py-1.5">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-400/80" />
          <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-red-600/90 dark:text-red-300/90 wrap-break-word">{syncError}</p>
          <button type="button" onClick={() => setSyncError(null)} className="shrink-0 text-red-400/50 hover:text-red-400/80 cursor-pointer">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Commit input */}
      <CommitInput
        cwd={cwd}
        stagedCount={stagedFiles.length}
        totalChanges={totalChanges}
        activeEngine={activeEngine}
        activeSessionId={activeSessionId}
        onSyncError={setSyncError}
        onCommit={handleCommit}
      />

      {/* Changes sections */}
      {stagedFiles.length > 0 && (
        <ChangesSection
          label="Staged"
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
        <div className="flex flex-col items-center justify-center gap-1 py-4">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/[0.12]">
            <Check className="h-2.5 w-2.5 text-emerald-600/70 dark:text-emerald-300/70" />
          </div>
          <p className="text-[10px] text-foreground/45">Working tree clean</p>
        </div>
      )}

      {/* Log section */}
      <div className="mt-0.5">
        <button
          type="button"
          onClick={() => setShowLog(!showLog)}
          className="flex w-full items-center gap-1.5 px-3 py-1 transition-colors hover:bg-foreground/[0.03] cursor-pointer"
        >
          {showLog ? <ChevronDown className="h-3 w-3 shrink-0 text-foreground/45" /> : <ChevronRight className="h-3 w-3 shrink-0 text-foreground/45" />}
          <History className="h-3 w-3 shrink-0 text-foreground/45" />
          <span className="text-[11px] font-semibold text-foreground/60">Commits</span>
          <span className="rounded-full bg-foreground/[0.07] px-1.5 py-px text-[10px] font-medium tabular-nums text-foreground/45">{log.length}</span>
        </button>
        {showLog && (
          <div className="pb-0.5">
            {log.map((entry) => (
              <div key={entry.hash} className="flex items-baseline gap-1.5 px-3 py-[3px] text-[10px] transition-colors hover:bg-foreground/[0.03]">
                <span className="shrink-0 rounded bg-foreground/[0.06] px-1 py-px font-mono text-[9px] text-foreground/50">{entry.shortHash}</span>
                <span className="min-w-0 flex-1 truncate text-foreground/70">{entry.subject}</span>
                <span className="shrink-0 tabular-nums text-foreground/35">{formatRelativeDate(entry.date)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
