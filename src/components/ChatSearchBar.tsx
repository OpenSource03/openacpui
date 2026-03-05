import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import type { UIMessage } from "@/types";

interface ChatSearchBarProps {
  messages: UIMessage[];
  onNavigate: (messageId: string) => void;
  onClose: () => void;
}

export const ChatSearchBar = memo(function ChatSearchBar({
  messages,
  onNavigate,
  onClose,
}: ChatSearchBarProps) {
  const [query, setQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track the last navigated message ID to avoid re-scrolling to the same target
  // (e.g. when messages array updates during streaming but the match hasn't changed)
  const lastNavigatedRef = useRef<string | null>(null);

  // Auto-focus the input on mount
  useEffect(() => {
    const timer = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(timer);
  }, []);

  // Find all matching message IDs
  const matchIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const ids: string[] = [];
    for (const msg of messages) {
      if (msg.role === "tool_result") continue;

      const text = (msg.displayContent ?? msg.content).toLowerCase();
      if (text.includes(q)) {
        ids.push(msg.id);
      }
    }
    return ids;
  }, [messages, query]);

  // Clamp currentIndex when matches change
  useEffect(() => {
    if (matchIds.length === 0) {
      setCurrentIndex(0);
    } else if (currentIndex >= matchIds.length) {
      setCurrentIndex(matchIds.length - 1);
    }
  }, [matchIds.length, currentIndex]);

  const navigateTo = useCallback(
    (messageId: string) => {
      lastNavigatedRef.current = messageId;
      onNavigate(messageId);
    },
    [onNavigate],
  );

  // Navigate to current match — only when the target message actually changes
  useEffect(() => {
    const targetId = matchIds[currentIndex];
    if (!targetId) return;
    if (targetId === lastNavigatedRef.current) return;
    navigateTo(targetId);
  }, [matchIds, currentIndex, navigateTo]);

  const goNext = useCallback(() => {
    if (matchIds.length === 0) return;
    const nextIndex = (currentIndex + 1) % matchIds.length;
    setCurrentIndex(nextIndex);
    // Force-navigate even if wrapping to same message (single match case)
    navigateTo(matchIds[nextIndex]);
  }, [matchIds, currentIndex, navigateTo]);

  const goPrev = useCallback(() => {
    if (matchIds.length === 0) return;
    const prevIndex = (currentIndex - 1 + matchIds.length) % matchIds.length;
    setCurrentIndex(prevIndex);
    navigateTo(matchIds[prevIndex]);
  }, [matchIds, currentIndex, navigateTo]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          goPrev();
        } else {
          goNext();
        }
      }
    },
    [onClose, goNext, goPrev],
  );

  // Reset tracking when query changes so the first match auto-navigates
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setCurrentIndex(0);
    lastNavigatedRef.current = null;
  }, []);

  const hasQuery = query.trim().length > 0;

  return (
    <div className="absolute end-3 top-10 z-20 animate-in fade-in slide-in-from-top-2 duration-150">
      <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-background/95 px-2 py-1 shadow-lg backdrop-blur-sm">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find in chat..."
          className="w-44 bg-transparent px-1.5 py-0.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
        />

        {/* Match count */}
        {hasQuery && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground/60">
            {matchIds.length === 0
              ? "0 results"
              : `${currentIndex + 1} of ${matchIds.length}`}
          </span>
        )}

        {/* Prev / Next */}
        <button
          onClick={goPrev}
          disabled={matchIds.length === 0}
          className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
          aria-label="Previous match"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={goNext}
          disabled={matchIds.length === 0}
          className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
          aria-label="Next match"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
          aria-label="Close search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});
