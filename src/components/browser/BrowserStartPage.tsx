/**
 * Start page shown when no URL has been entered (new tab or empty browser).
 * Displays a centered URL bar with recent history links below.
 */

import { Globe } from "lucide-react";
import type { BrowserHistoryEntry } from "./browser-types";
import { extractHostname } from "./browser-utils";
import { BrowserUrlBar } from "./BrowserUrlBar";

// ── Props ───────────────────────────────────────────────────────────────

export interface BrowserStartPageProps {
  /** Current input text. */
  input: string;
  /** Called on every keystroke. */
  setInput: (value: string) => void;
  /** Whether the suggestions dropdown is visible. */
  showSuggestions: boolean;
  /** Toggle suggestions visibility. */
  setShowSuggestions: (show: boolean) => void;
  /** Full browsing history for autocomplete. */
  history: BrowserHistoryEntry[];
  /** Called when the user submits a URL. */
  onOpen: (value: string) => void;
  /** Recent history entries for the "Recent" section. */
  recentHistory: BrowserHistoryEntry[];
}

// ── Component ───────────────────────────────────────────────────────────

export function BrowserStartPage({
  input,
  setInput,
  showSuggestions,
  setShowSuggestions,
  history,
  onOpen,
  recentHistory,
}: BrowserStartPageProps) {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="flex min-h-full flex-col items-center justify-center px-4 py-6">
        <div className="w-full max-w-sm">
          {/* URL bar */}
          <BrowserUrlBar
            value={input}
            onChange={setInput}
            showSuggestions={showSuggestions}
            onShowSuggestionsChange={setShowSuggestions}
            history={history}
            onSubmit={onOpen}
            variant="start-page"
            autoFocus
          />

          {/* Recent history */}
          {recentHistory.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-foreground/25">
                Recent
              </div>
              <div className="space-y-px">
                {recentHistory.map((entry) => {
                  const hostname = extractHostname(entry.url);
                  return (
                    <button
                      key={`recent-${entry.url}`}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-start transition-colors hover:bg-foreground/[0.04]"
                      onClick={() => onOpen(entry.url)}
                    >
                      <Globe className="h-3 w-3 shrink-0 text-foreground/15" />
                      <span className="min-w-0 truncate text-[11px] text-foreground/60">{entry.title}</span>
                      <span className="ms-auto shrink-0 text-[10px] text-foreground/20">{hostname}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
