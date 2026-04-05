/**
 * Shared URL input with Tab-completion and history suggestions dropdown.
 * Used by both BrowserStartPage and BrowserNavBar, eliminating the
 * duplicated URL input pattern.
 */

import { useMemo, type FormEvent, type KeyboardEvent } from "react";
import { Globe, Lock, Search, ArrowUpRight } from "lucide-react";
import type { BrowserHistoryEntry } from "./browser-types";
import { filterHistory, findCompletion, extractHostname } from "./browser-utils";

// ── Variant styling ─────────────────────────────────────────────────────

interface UrlBarVariant {
  /** Outer wrapper classes for the input container. */
  container: string;
  /** Classes for the text input. */
  input: string;
  /** Placeholder text. */
  placeholder: string;
  /** Classes for the suggestion dropdown. */
  dropdown: string;
  /** Size of the leading icon. */
  iconSize: string;
}

const VARIANT_START_PAGE: UrlBarVariant = {
  container:
    "flex items-center gap-2 rounded-md border border-foreground/[0.08] bg-foreground/[0.03] px-2.5 py-1.5 transition-colors focus-within:border-foreground/[0.15] focus-within:bg-foreground/[0.05]",
  input:
    "w-full bg-transparent text-[12px] text-foreground/80 outline-none placeholder:text-foreground/25",
  placeholder: "Search or enter URL\u2026",
  dropdown:
    "absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-48 overflow-y-auto rounded-lg border border-foreground/[0.1] bg-[var(--background)] shadow-lg",
  iconSize: "h-3.5 w-3.5",
};

const VARIANT_NAV_BAR: UrlBarVariant = {
  container:
    "flex items-center gap-1.5 rounded-md bg-foreground/[0.05] px-2 py-1 transition-colors focus-within:bg-foreground/[0.08] focus-within:ring-1 focus-within:ring-foreground/[0.08]",
  input:
    "min-w-0 flex-1 bg-transparent text-[11px] text-foreground/70 outline-none placeholder:text-foreground/20",
  placeholder: "Search or enter URL",
  dropdown:
    "absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-52 overflow-y-auto rounded-md border border-foreground/[0.08] bg-background py-1 shadow-lg",
  iconSize: "h-3 w-3",
};

// ── Props ───────────────────────────────────────────────────────────────

interface BrowserUrlBarProps {
  /** Current text in the input. */
  value: string;
  /** Called on every keystroke. */
  onChange: (value: string) => void;
  /** Whether the suggestions dropdown is visible. */
  showSuggestions: boolean;
  /** Toggle suggestions visibility. */
  onShowSuggestionsChange: (show: boolean) => void;
  /** Full history list (filtering is handled internally). */
  history: BrowserHistoryEntry[];
  /** Called when the user submits a URL (press Enter or click a suggestion). */
  onSubmit: (value: string) => void;
  /** Visual variant: "start-page" for the centered new-tab page, "nav-bar" for the inline toolbar. */
  variant: "start-page" | "nav-bar";
  /** Whether the current URL is HTTPS (nav-bar variant only — shows Lock icon). */
  isSecure?: boolean;
  /** Auto-focus the input on mount. */
  autoFocus?: boolean;
  /** Called when Escape is pressed. If not provided, defaults to blurring. */
  onEscape?: (currentValue: string) => void;
}

// ── Component ───────────────────────────────────────────────────────────

export function BrowserUrlBar({
  value,
  onChange,
  showSuggestions,
  onShowSuggestionsChange,
  history,
  onSubmit,
  variant,
  isSecure,
  autoFocus,
  onEscape,
}: BrowserUrlBarProps) {
  const style = variant === "start-page" ? VARIANT_START_PAGE : VARIANT_NAV_BAR;

  const filteredHistory = useMemo(() => filterHistory(history, value), [history, value]);
  const completion = useMemo(() => findCompletion(history, value), [history, value]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onShowSuggestionsChange(false);
    const form = e.currentTarget;
    const active = document.activeElement;
    if (active instanceof HTMLElement && form.contains(active)) {
      active.blur();
    }
    onSubmit(value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onShowSuggestionsChange(false);
      if (onEscape) {
        onEscape(value);
      }
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key === "Tab" && completion) {
      e.preventDefault();
      onChange(completion);
    }
  };

  // ── Leading icon ────────────────────────────────────────────────────

  const leadingIcon =
    variant === "nav-bar" && isSecure ? (
      <Lock className={`${style.iconSize} shrink-0 text-emerald-500/60`} />
    ) : variant === "start-page" ? (
      <Search className={`${style.iconSize} shrink-0 text-foreground/25`} />
    ) : (
      <Globe className={`${style.iconSize} shrink-0 text-foreground/25`} />
    );

  // ── Suggestion rows ─────────────────────────────────────────────────

  const renderSuggestionRow = (entry: BrowserHistoryEntry) => {
    if (variant === "start-page") {
      const hostname = extractHostname(entry.url);
      return (
        <button
          key={entry.url}
          type="button"
          className="flex w-full items-center gap-2 px-2.5 py-1 text-start transition-colors hover:bg-foreground/[0.04]"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange(entry.url);
            onShowSuggestionsChange(false);
            onSubmit(entry.url);
          }}
        >
          <Globe className="h-3 w-3 shrink-0 text-foreground/20" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/65">{entry.title}</span>
          <span className="max-w-32 shrink-0 truncate text-[10px] text-foreground/20">{hostname}</span>
        </button>
      );
    }

    // nav-bar variant
    return (
      <button
        key={entry.url}
        type="button"
        className="block w-full px-2.5 py-1.5 text-start hover:bg-foreground/[0.05]"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onChange(entry.url);
          onShowSuggestionsChange(false);
          onSubmit(entry.url);
        }}
      >
        <div className="truncate text-xs text-foreground/80">{entry.title}</div>
        <div className="truncate text-[11px] text-muted-foreground">{entry.url}</div>
      </button>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="relative min-w-0 flex-1">
      <div className={style.container}>
        {leadingIcon}

        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              onShowSuggestionsChange(true);
            }}
            onMouseDown={(e) => {
              if (document.activeElement === e.currentTarget) {
                onShowSuggestionsChange(true);
              }
            }}
            onFocus={(e) => {
              if (variant === "nav-bar") {
                e.target.select();
                onShowSuggestionsChange(true);
              }
            }}
            onBlur={() => {
              window.setTimeout(() => onShowSuggestionsChange(false), 120);
            }}
            onKeyDown={handleKeyDown}
            className={style.input}
            placeholder={style.placeholder}
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
          />
          {/* Ghost text completion overlay (start-page variant only) */}
          {variant === "start-page" && completion && value.trim() && (
            <div className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-[12px]">
              <span className="invisible whitespace-pre">{value}</span>
              <span className="text-foreground/[0.12]">{completion.slice(value.length)}</span>
            </div>
          )}
        </div>

        {/* Tab hint badge (start-page variant only) */}
        {variant === "start-page" && completion && value.trim() && (
          <kbd className="shrink-0 rounded border border-foreground/[0.06] bg-foreground/[0.03] px-1 py-px text-[9px] font-medium text-foreground/20">
            Tab
          </kbd>
        )}

        {/* Submit arrow (start-page variant only) */}
        {variant === "start-page" && value.trim() && (
          <button
            type="submit"
            className="shrink-0 rounded p-1 text-foreground/30 transition-colors hover:bg-foreground/[0.08] hover:text-foreground/60"
          >
            <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && filteredHistory.length > 0 && (
        <div className={style.dropdown}>
          {filteredHistory.map(renderSuggestionRow)}
        </div>
      )}
    </form>
  );
}
