import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, GitBranch, Terminal as TerminalIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ChatSession } from "@/types";
import { AgentIcon } from "@/components/AgentIcon";
import { getSessionEngineIcon } from "@/lib/engine-icons";

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

/**
 * Unified row shape for the picker. `source` distinguishes sessions that
 * already live in the Harnss sidebar (cheap switch via sessionId) from
 * sessions that only exist in `~/.claude/projects` (need a CLI resume to
 * bring them into the app).
 */
type PickerRow =
  | {
      source: "sidebar";
      session: ChatSession;
      title: string;
      sortKey: number;
    }
  | {
      source: "global";
      entry: AllSessionsEntry;
      title: string;
      sortKey: number;
    };

interface SessionPickerProps {
  open: boolean;
  onClose: () => void;
  /** Existing sidebar sessions. */
  sessions: ChatSession[];
  /** Switch to a session that's already in the sidebar. */
  onSelectSidebarSession: (sessionId: string) => void;
  /**
   * Resume a CC session that isn't yet in the sidebar — uses the CLI
   * engine resume path (spawns claude --resume + creates Harnss row).
   */
  onResumeCliSessionById: (
    sessionId: string,
  ) => Promise<{ ok: true; projectId: string; sessionId: string } | { error: string }>;
  /**
   * Fork an existing CC session — spawns `claude --resume <id> --fork-session`
   * which clones the transcript under a CLI-minted id. Triggered by
   * Cmd/Ctrl+Enter in the picker (Enter alone is reserved for the
   * primary "open" action so users don't accidentally fork).
   */
  onForkCliSessionById: (
    sessionId: string,
  ) => Promise<{ ok: true; provisionalSessionId: string } | { error: string }>;
}

/**
 * Cmd+P / Ctrl+P quick-switcher modal. Lists every session reachable from
 * the current Harnss instance — both the sidebar entries and the global
 * CC index — with fuzzy-ish filtering and keyboard navigation.
 *
 * Why a separate surface from the sidebar's "All CC Sessions" section: the
 * sidebar version is built for browsing (collapsible, paginated, slow
 * deliberate clicks), the picker is built for the "I know what I want,
 * just type a few chars" muscle memory pattern that any modern editor
 * has popularized.
 */
export function SessionPicker({
  open,
  onClose,
  sessions,
  onSelectSidebarSession,
  onResumeCliSessionById,
  onForkCliSessionById,
}: SessionPickerProps) {
  const [globalEntries, setGlobalEntries] = useState<AllSessionsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Refresh global entries every time the picker opens so newly-created
  // external CLI sessions show up. Stale-while-loading: if we already
  // have entries from a previous open, keep showing them while the new
  // fetch is in flight, swap in atomically when done.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setError(null);
    inputRef.current?.focus();
    let cancelled = false;
    setLoading(true);
    window.claude.ccSessions
      .listAll()
      .then((rows) => { if (!cancelled) setGlobalEntries(rows); })
      .catch(() => { if (!cancelled) setGlobalEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const rows = useMemo<PickerRow[]>(() => {
    const out: PickerRow[] = [];
    // De-dup against *all* sidebar sessions — including archived ones —
    // so that a global row whose id matches an archived sidebar entry
    // doesn't show up as "openable" and accidentally route through
    // createCliSession (which would either error on engine mismatch or
    // silently switch to a hidden archived row).
    const allSidebarIds = new Set<string>();
    for (const s of sessions) allSidebarIds.add(s.id);
    for (const s of sessions) {
      if (s.archivedAt) continue;
      out.push({
        source: "sidebar",
        session: s,
        title: s.title || "Untitled",
        sortKey: s.lastMessageAt ?? s.createdAt ?? 0,
      });
    }
    for (const e of globalEntries) {
      if (allSidebarIds.has(e.sessionId)) continue;
      const title = e.summary?.trim() || e.firstPrompt?.trim() || e.sessionId.slice(0, 8);
      out.push({
        source: "global",
        entry: e,
        title,
        sortKey: e.modified,
      });
    }
    out.sort((a, b) => b.sortKey - a.sortKey);
    return out;
  }, [sessions, globalEntries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows.slice(0, 80);
    return rows
      .filter((row) => {
        const haystack =
          row.source === "sidebar"
            ? `${row.title} ${row.session.id} ${row.session.branch ?? ""}`
            : `${row.title} ${row.entry.sessionId} ${row.entry.projectPath ?? ""} ${row.entry.gitBranch ?? ""}`;
        return haystack.toLowerCase().includes(q);
      })
      .slice(0, 80);
  }, [rows, query]);

  // Reset selection on filter change so an out-of-bounds index can't blow
  // up the keyboard handler.
  useEffect(() => {
    setActiveIndex((prev) => (prev >= filtered.length ? 0 : prev));
  }, [filtered.length]);

  const handleSelect = useCallback(
    async (row: PickerRow) => {
      if (busy) return;
      setError(null);
      if (row.source === "sidebar") {
        onSelectSidebarSession(row.session.id);
        onClose();
        return;
      }
      setBusy(true);
      try {
        const result = await onResumeCliSessionById(row.entry.sessionId);
        if ("error" in result) {
          setError(result.error);
        } else {
          onClose();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, onClose, onResumeCliSessionById, onSelectSidebarSession],
  );

  /**
   * Fork action — bound to Cmd/Ctrl+Enter. Only meaningful for global
   * (CC-on-disk) rows; sidebar rows fall through to the regular select
   * since the user already has a live row for them.
   */
  const handleFork = useCallback(
    async (row: PickerRow) => {
      if (busy) return;
      if (row.source !== "global") {
        // Only CLI sidebar sessions are fork-able — fork resolves
        // through findById which only knows about CC-on-disk
        // transcripts. SDK / ACP / Codex sidebar sessions don't have
        // a CC JSONL to fork from.
        if (row.session.engine !== "cli") {
          setError("Fork only works for CLI sessions.");
          return;
        }
        const sessionId = row.session.id;
        // Skip fork-pending rows; the underlying transcript doesn't
        // exist on disk yet so claude --resume would fail.
        if (sessionId.startsWith("fork-pending-")) {
          setError("This session hasn't been recorded yet — wait until first response.");
          return;
        }
        setBusy(true);
        try {
          const r = await onForkCliSessionById(sessionId);
          if ("error" in r) setError(r.error);
          else onClose();
        } finally {
          setBusy(false);
        }
        return;
      }
      setBusy(true);
      try {
        const r = await onForkCliSessionById(row.entry.sessionId);
        if ("error" in r) setError(r.error);
        else onClose();
      } finally {
        setBusy(false);
      }
    },
    [busy, onClose, onForkCliSessionById],
  );

  // Scroll the active row into view when it changes — without this, paging
  // through 80 entries with the arrow keys leaves the cursor invisible.
  useEffect(() => {
    if (!open) return;
    const container = listRef.current;
    if (!container) return;
    const child = container.children[activeIndex] as HTMLElement | undefined;
    if (!child) return;
    const cTop = container.scrollTop;
    const cBottom = cTop + container.clientHeight;
    const eTop = child.offsetTop;
    const eBottom = eTop + child.offsetHeight;
    if (eTop < cTop) container.scrollTop = eTop;
    else if (eBottom > cBottom) container.scrollTop = eBottom - container.clientHeight;
  }, [activeIndex, open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % Math.max(filtered.length, 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const row = filtered[activeIndex];
        if (!row) return;
        // Cmd/Ctrl+Enter → fork; plain Enter → resume/select. The
        // distinct modifier matches "open in new tab" muscle memory
        // from browsers (cmd-click).
        if (e.metaKey || e.ctrlKey) {
          void handleFork(row);
        } else {
          void handleSelect(row);
        }
        return;
      }
    },
    [activeIndex, filtered, handleSelect, handleFork, onClose],
  );

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/30" />
        <DialogPrimitive.Content
          aria-label="Quick switcher"
          className="fixed left-1/2 top-[14vh] z-[60] w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-xl border border-foreground/[0.08] bg-background shadow-2xl focus:outline-none"
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={(e) => {
            // Defer focus to our search input — Radix would otherwise
            // focus the panel itself first.
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Quick switcher</DialogPrimitive.Title>
        <div className="relative border-b border-foreground/[0.06]">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search session by title, branch, project…"
            className="w-full bg-transparent py-3 pe-3 ps-10 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
          />
        </div>

        {error && (
          <p className="border-b border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[11px] text-red-400">
            {error}
          </p>
        )}

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {loading && filtered.length === 0 && (
            <p className="px-3 py-4 text-xs text-foreground/40">Loading sessions…</p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="px-3 py-4 text-xs text-foreground/40">
              {rows.length === 0 ? "No sessions yet." : "No matches."}
            </p>
          )}
          {filtered.map((row, idx) => {
            const isActive = idx === activeIndex;
            const projectName =
              row.source === "sidebar"
                ? "" // sidebar sessions don't carry project name here; could enhance later
                : row.entry.projectPath
                  ? row.entry.projectPath.split("/").filter(Boolean).pop() ?? row.entry.projectPath
                  : "—";
            const branch =
              row.source === "sidebar" ? row.session.branch : row.entry.gitBranch;
            const engineIconSrc =
              row.source === "sidebar"
                ? getSessionEngineIcon(row.session.engine, row.session.agentId, undefined)
                : "Terminal"; // global rows are CC-on-disk → opening goes through CLI resume
            return (
              <button
                key={`${row.source}/${row.source === "sidebar" ? row.session.id : `${row.entry.cwdHash}/${row.entry.sessionId}`}`}
                type="button"
                onClick={() => void handleSelect(row)}
                onMouseEnter={() => setActiveIndex(idx)}
                disabled={busy}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-start transition-colors disabled:opacity-50 ${
                  isActive ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]"
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground/55">
                  <AgentIcon icon={engineIconSrc} size={14} />
                </span>
                <span className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                  <span className="truncate text-sm text-foreground/90">{row.title}</span>
                  <span className="flex items-center gap-2 text-[10px] text-foreground/45">
                    {row.source === "global" && row.entry.sessionId && (
                      <span className="rounded bg-foreground/[0.05] px-1.5 py-0.5 font-mono">
                        cli
                      </span>
                    )}
                    {projectName && (
                      <span className="truncate">{projectName}</span>
                    )}
                    {branch && (
                      <span className="flex items-center gap-0.5 truncate">
                        <GitBranch className="h-2.5 w-2.5" />
                        {branch}
                      </span>
                    )}
                  </span>
                </span>
                {row.source === "global" && (
                  <TerminalIcon className="h-3 w-3 shrink-0 text-foreground/30" aria-hidden />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-foreground/[0.06] px-3 py-1.5 text-[10px] text-foreground/40">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>⌘↵ fork</span>
          <span>esc close</span>
          <span className="ms-auto">{filtered.length}/{rows.length}</span>
        </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
