/**
 * Navigation toolbar for a browser webview tab.
 * Contains Back/Forward/Reload buttons, inspect/devtools/color-scheme toggles,
 * and the inline URL bar.
 */

import { useCallback } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X as XIcon,
  Crosshair,
  Bug,
  Sun,
  Moon,
} from "lucide-react";
import type { BrowserColorScheme, BrowserHistoryEntry } from "./browser-types";
import { BrowserUrlBar } from "./BrowserUrlBar";

// ── Props ───────────────────────────────────────────────────────────────

interface BrowserNavBarProps {
  /** Current URL text in the address bar. */
  urlInput: string;
  /** Called on every URL input keystroke. */
  onUrlInputChange: (value: string) => void;
  /** Whether the suggestions dropdown is open. */
  showSuggestions: boolean;
  /** Toggle suggestions dropdown. */
  onShowSuggestionsChange: (show: boolean) => void;
  /** Full browsing history for autocomplete. */
  history: BrowserHistoryEntry[];
  /** Submit a URL for navigation. */
  onNavigate: (url: string) => void;
  /** Whether the current page URL is HTTPS. */
  isSecure: boolean;
  /** Original tab URL (restored on Escape). */
  tabUrl: string;

  /** Whether back navigation is available. */
  canGoBack: boolean;
  /** Whether forward navigation is available. */
  canGoForward: boolean;
  /** Whether the page is currently loading. */
  isLoading: boolean;
  /** Whether navigation controls should be enabled. */
  canNavigate: boolean;

  /** Go back one page. */
  onGoBack: () => void;
  /** Go forward one page. */
  onGoForward: () => void;
  /** Reload or stop the current page. */
  onReloadOrStop: () => void;

  /** Whether element inspect mode is active. */
  inspectMode: boolean;
  /** Toggle element inspect mode. */
  onToggleInspect: () => void;

  /** Whether DevTools are open. */
  isDevToolsOpen: boolean;
  /** Toggle DevTools. */
  onToggleDevTools: () => void;

  /** Current color scheme being simulated. */
  colorScheme: BrowserColorScheme;
  /** Toggle between light/dark color scheme. */
  onToggleColorScheme: () => void;
}

// ── Component ───────────────────────────────────────────────────────────

export function BrowserNavBar({
  urlInput,
  onUrlInputChange,
  showSuggestions,
  onShowSuggestionsChange,
  history,
  onNavigate,
  isSecure,
  tabUrl,
  canGoBack,
  canGoForward,
  isLoading,
  canNavigate,
  onGoBack,
  onGoForward,
  onReloadOrStop,
  inspectMode,
  onToggleInspect,
  isDevToolsOpen,
  onToggleDevTools,
  colorScheme,
  onToggleColorScheme,
}: BrowserNavBarProps) {
  const handleEscape = useCallback(
    () => onUrlInputChange(tabUrl),
    [onUrlInputChange, tabUrl],
  );

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5">
      {/* Back / Forward / Reload group */}
      <div className="flex shrink-0 items-center rounded-md border border-foreground/[0.08] bg-foreground/[0.02]">
        <button
          type="button"
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-s-md text-foreground/35 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/65 disabled:cursor-not-allowed disabled:opacity-20"
          onClick={onGoBack}
          disabled={!canNavigate || !canGoBack}
          title="Back"
        >
          <ArrowLeft className="h-3 w-3" />
        </button>
        <div className="h-3.5 w-px bg-foreground/[0.08]" />
        <button
          type="button"
          className="flex h-6 w-6 cursor-pointer items-center justify-center text-foreground/35 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/65 disabled:cursor-not-allowed disabled:opacity-20"
          onClick={onGoForward}
          disabled={!canNavigate || !canGoForward}
          title="Forward"
        >
          <ArrowRight className="h-3 w-3" />
        </button>
        <div className="h-3.5 w-px bg-foreground/[0.08]" />
        <button
          type="button"
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-e-md text-foreground/35 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/65 disabled:cursor-not-allowed disabled:opacity-20"
          onClick={onReloadOrStop}
          disabled={!canNavigate}
          title={isLoading ? "Stop" : "Reload"}
        >
          {isLoading ? (
            <XIcon className="h-3 w-3" />
          ) : (
            <RotateCw className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Inspect button */}
      <button
        type="button"
        className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-20 ${
          inspectMode
            ? "border-blue-400/30 bg-blue-500/10 text-blue-400 hover:text-blue-300"
            : "border-foreground/[0.08] bg-foreground/[0.02] text-foreground/35 hover:bg-foreground/[0.06] hover:text-foreground/65"
        }`}
        onClick={onToggleInspect}
        disabled={!canNavigate}
        title={inspectMode ? "Cancel inspect" : "Grab element"}
      >
        <Crosshair className="h-3 w-3" />
      </button>

      {/* DevTools button */}
      <button
        type="button"
        className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-foreground/[0.08] bg-foreground/[0.02] transition-colors disabled:cursor-not-allowed disabled:opacity-20 ${
          isDevToolsOpen
            ? "bg-emerald-500/10 text-emerald-400 hover:text-emerald-300"
            : "text-foreground/35 hover:bg-foreground/[0.06] hover:text-foreground/65"
        }`}
        onClick={onToggleDevTools}
        disabled={!canNavigate}
        title={isDevToolsOpen ? "Close inspector" : "Open inspector"}
      >
        <Bug className="h-3 w-3" />
      </button>

      {/* Color scheme toggle */}
      <button
        type="button"
        className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-foreground/[0.08] transition-colors disabled:cursor-not-allowed disabled:opacity-20 ${
          colorScheme === "dark"
            ? "bg-slate-900 text-sky-100 hover:bg-slate-800"
            : "bg-amber-50 text-amber-700 hover:bg-amber-100"
        }`}
        onClick={onToggleColorScheme}
        disabled={!canNavigate}
        title={`Simulating ${colorScheme} mode`}
      >
        {colorScheme === "dark" ? (
          <Moon className="h-3 w-3" />
        ) : (
          <Sun className="h-3 w-3" />
        )}
      </button>

      {/* URL bar */}
      <BrowserUrlBar
        value={urlInput}
        onChange={onUrlInputChange}
        showSuggestions={showSuggestions}
        onShowSuggestionsChange={onShowSuggestionsChange}
        history={history}
        onSubmit={onNavigate}
        variant="nav-bar"
        isSecure={isSecure}
        onEscape={handleEscape}
      />
    </div>
  );
}
