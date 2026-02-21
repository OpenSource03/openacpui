import { useState, useRef, useEffect, useCallback, memo } from "react";
import { Search, MessageSquare, Hash, X } from "lucide-react";
import type { SearchMessageResult, SearchSessionResult } from "@/types";

interface SidebarSearchProps {
  projectIds: string[];
  onNavigateToMessage: (sessionId: string, messageId: string) => void;
  onSelectSession: (sessionId: string) => void;
}

export const SidebarSearch = memo(function SidebarSearch({
  projectIds,
  onNavigateToMessage,
  onSelectSession,
}: SidebarSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [messageResults, setMessageResults] = useState<SearchMessageResult[]>([]);
  const [sessionResults, setSessionResults] = useState<SearchSessionResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim() || projectIds.length === 0) {
        setMessageResults([]);
        setSessionResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const results = await window.claude.sessions.search(projectIds, q.trim());
        setMessageResults(results.messageResults);
        setSessionResults(results.sessionResults);
      } catch {
        setMessageResults([]);
        setSessionResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [projectIds],
  );

  // Debounced search
  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!query.trim()) {
      setMessageResults([]);
      setSessionResults([]);
      return;
    }
    timerRef.current = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(timerRef.current);
  }, [query, doSearch]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close on Escape
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  const hasResults = messageResults.length > 0 || sessionResults.length > 0;
  const showDropdown = isOpen && query.trim().length > 0;

  const highlightMatch = (text: string, q: string) => {
    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    const idx = lowerText.indexOf(lowerQ);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-500/30 text-inherit rounded-sm px-0.5">
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div ref={containerRef} className="relative no-drag px-2 pb-1">
      <div className="glass-outline relative overflow-hidden rounded-lg" style={{ "--island-fill": "var(--sidebar)" } as React.CSSProperties}>
        <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/30" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search chats..."
          className="w-full rounded-lg bg-sidebar-accent/50 py-1.5 pe-7 ps-8 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/30 outline-none transition-colors focus:bg-sidebar-accent"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setIsOpen(false);
            }}
            className="absolute end-2 top-1/2 -translate-y-1/2 text-sidebar-foreground/40 hover:text-sidebar-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute inset-x-2 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-sidebar-border bg-popover p-1 shadow-lg">
          {isSearching && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">Searching...</p>
          )}

          {!isSearching && !hasResults && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No results found</p>
          )}

          {/* Session results */}
          {sessionResults.length > 0 && (
            <div className="mb-1">
              <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Chats
              </p>
              {sessionResults.map((r) => (
                <button
                  key={r.sessionId}
                  onClick={() => {
                    onSelectSession(r.sessionId);
                    setIsOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent"
                >
                  <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">
                    {highlightMatch(r.title, query)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Message results */}
          {messageResults.length > 0 && (
            <div>
              <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Messages
              </p>
              {messageResults.map((r, i) => (
                <button
                  key={`${r.sessionId}-${r.messageId}-${i}`}
                  onClick={() => {
                    onNavigateToMessage(r.sessionId, r.messageId);
                    setIsOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-start hover:bg-accent"
                >
                  <span className="text-sm wrap-break-word line-clamp-2">
                    {highlightMatch(r.snippet, query)}
                  </span>
                  <span className="text-[11px] text-muted-foreground truncate">
                    <MessageSquare className="me-1 inline h-3 w-3" />
                    {r.sessionTitle}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
