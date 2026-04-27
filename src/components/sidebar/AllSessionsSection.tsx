import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Globe, GitBranch, MessagesSquare, RefreshCw, Search } from "lucide-react";

interface AllSessionsEntry {
  sessionId: string;
  cwdHash: string;
  projectPath: string | null;
  firstPrompt: string | null;
  summary: string | null;
  messageCount: number | null;
  modified: number;
  created: number | null;
  gitBranch: string | null;
}

interface AllSessionsSectionProps {
  /**
   * Routes a discovered Claude Code session into Harnss: looks up cwd via
   * `cc-sessions:find-by-id`, creates/matches a project at that path, then
   * imports the JSONL transcript and switches to it. Wired in
   * `useAppSessionActions.handleImportSessionById`.
   */
  onImportSessionById: (
    sessionId: string,
  ) => Promise<{ ok: true; projectId: string } | { error: string }>;
}

const VISIBLE_PAGE_SIZE = 30;

/**
 * Format a `mtimeMs`-style millisecond timestamp as a relative-then-absolute
 * label ("3h ago", "Mon", "Jan 12"). Kept inline because the only other
 * date-relative util in the repo lives in a chat-specific component.
 */
function formatRelative(ms: number): string {
  const now = Date.now();
  const diff = now - ms;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.round(diff / min)}m ago`;
  if (diff < day) return `${Math.round(diff / hr)}h ago`;
  if (diff < 7 * day) return `${Math.round(diff / day)}d ago`;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Bottom-of-sidebar collapsible section that exposes every Claude Code
 * session the user has ever created — across every cwd — by reading CLI's own
 * `sessions-index.json` files. Clicking a row routes the session through
 * `onImportSessionById`, which auto-creates a Harnss project at the session's
 * cwd if one doesn't already exist.
 *
 * This is the global-session-browser increment: independent of whether the
 * user picks SDK-mode or CLI-mode for new sessions, it lets them pull any
 * past CLI session into Harnss with one click.
 */
export function AllSessionsSection({ onImportSessionById }: AllSessionsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<AllSessionsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(VISIBLE_PAGE_SIZE);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Lazy-load only when the user expands. Listing scans the entire
  // ~/.claude/projects tree, which can be a few hundred index files for
  // heavy CLI users — no point paying for that on every sidebar mount.
  // Refresh handler is exposed so the user can force a reload after creating
  // a new CLI session in another terminal without remounting the sidebar.
  const refresh = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const rows = await window.claude.ccSessions.listAll();
      setEntries(rows);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    if (!expanded || entries !== null) return;
    void refresh();
  }, [expanded, entries, refresh]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const hay = [
        e.firstPrompt ?? "",
        e.summary ?? "",
        e.projectPath ?? "",
        e.gitBranch ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query]);

  const totalCount = entries?.length ?? 0;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/40 transition-colors hover:text-sidebar-foreground/70"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Globe className="h-3 w-3" />
        <span>All CC Sessions</span>
        {entries !== null && (
          <span className="ms-auto rounded bg-sidebar-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-normal tabular-nums text-sidebar-foreground/60">
            {totalCount}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-1 space-y-1.5 px-1">
          <div className="flex items-center gap-1">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-2 top-1/2 h-3 w-3 -translate-y-1/2 text-sidebar-foreground/40" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setVisible(VISIBLE_PAGE_SIZE);
                }}
                placeholder="Search prompt, project, branch…"
                className="w-full rounded border border-sidebar-foreground/10 bg-sidebar-foreground/[0.03] py-1 pe-2 ps-7 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus:border-sidebar-foreground/30 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              title="Refresh"
              className="rounded p-1 text-sidebar-foreground/55 hover:bg-sidebar-foreground/[0.06] hover:text-sidebar-foreground/85 disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {loading && (
            <p className="px-2 py-2 text-[11px] text-sidebar-foreground/50">Loading…</p>
          )}

          {!loading && entries !== null && filtered.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-sidebar-foreground/50">
              {entries.length === 0 ? "No CC sessions found." : "No matches."}
            </p>
          )}

          {importError && (
            <p className="rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-400">
              {importError}
            </p>
          )}

          {filtered.slice(0, visible).map((entry) => {
            const label = entry.summary?.trim() || entry.firstPrompt?.trim() || entry.sessionId;
            const projectName = entry.projectPath
              ? entry.projectPath.split("/").filter(Boolean).pop() ?? entry.projectPath
              : "—";
            return (
              <button
                key={`${entry.cwdHash}/${entry.sessionId}`}
                type="button"
                disabled={importingId === entry.sessionId}
                onClick={async () => {
                  setImportingId(entry.sessionId);
                  setImportError(null);
                  try {
                    const result = await onImportSessionById(entry.sessionId);
                    if ("error" in result) setImportError(result.error);
                  } catch (err) {
                    // Don't leave the row in a permanently disabled state if
                    // the import threw (vs. returning an error object).
                    setImportError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setImportingId(null);
                  }
                }}
                className="group flex w-full flex-col gap-0.5 rounded border border-transparent px-2 py-1.5 text-start transition-colors hover:border-sidebar-foreground/10 hover:bg-sidebar-foreground/[0.04] disabled:opacity-50"
                title={entry.projectPath ?? entry.cwdHash}
              >
                <span className="line-clamp-2 text-xs text-sidebar-foreground/85">
                  {label}
                </span>
                <span className="flex items-center gap-2 text-[10px] text-sidebar-foreground/45">
                  <span className="truncate" title={entry.projectPath ?? undefined}>
                    {projectName}
                  </span>
                  {entry.gitBranch && (
                    <span className="flex items-center gap-0.5 truncate">
                      <GitBranch className="h-2.5 w-2.5" />
                      {entry.gitBranch}
                    </span>
                  )}
                  {typeof entry.messageCount === "number" && (
                    <span className="flex items-center gap-0.5">
                      <MessagesSquare className="h-2.5 w-2.5" />
                      {entry.messageCount}
                    </span>
                  )}
                  <span className="ms-auto whitespace-nowrap">
                    {formatRelative(entry.modified)}
                  </span>
                </span>
              </button>
            );
          })}

          {!loading && filtered.length > visible && (
            <button
              type="button"
              onClick={() => setVisible((v) => v + VISIBLE_PAGE_SIZE)}
              className="w-full rounded px-2 py-1 text-[11px] text-sidebar-foreground/55 hover:bg-sidebar-foreground/[0.04] hover:text-sidebar-foreground/80"
            >
              Show {Math.min(VISIBLE_PAGE_SIZE, filtered.length - visible)} more
              <span className="ms-1 text-sidebar-foreground/40">
                ({filtered.length - visible} hidden)
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
