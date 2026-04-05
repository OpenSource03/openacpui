/** Pure utility functions for browser URL handling and session persistence. */

import type { BrowserColorScheme, BrowserHistoryEntry, BrowserTab, PersistedBrowserSession } from "./browser-types";
import {
  BROWSER_HISTORY_KEY,
  BROWSER_SESSION_KEY_PREFIX,
  MAX_BROWSER_HISTORY,
} from "./browser-types";

// ── URL normalization ───────────────────────────────────────────────────

/** Returns a normalized http(s) URL or null if the input is not valid. */
export function normalizeHistoryUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

/** Returns a trimmed title, falling back to the URL's hostname. */
export function normalizeHistoryTitle(raw: string | undefined, url: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > 0) return trimmed;
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Resolves a user-typed input string into a navigable URL.
 * - Bare domain-like strings (e.g. `github.com`) get `https://` prepended.
 * - Everything else is treated as a Google search query.
 */
export function resolveNavigationInput(input: string): string | null {
  let url = input.trim();
  if (!url) return null;

  if (/^[\w-]+(\.[\w-]+)+/.test(url) && !url.includes(" ")) {
    url = `https://${url}`;
  } else if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }

  return url;
}

// ── Tab reordering ──────────────────────────────────────────────────────

/** Returns a new array with `fromTabId` moved to the position of `toTabId`. */
export function reorderTabsById(tabs: BrowserTab[], fromTabId: string, toTabId: string): BrowserTab[] {
  const fromIndex = tabs.findIndex((tab) => tab.id === fromTabId);
  const toIndex = tabs.findIndex((tab) => tab.id === toTabId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return tabs;
  }

  const nextTabs = [...tabs];
  const [movedTab] = nextTabs.splice(fromIndex, 1);
  nextTabs.splice(toIndex, 0, movedTab);
  return nextTabs;
}

// ── Color scheme ────────────────────────────────────────────────────────

export function getDefaultBrowserColorScheme(): BrowserColorScheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// ── History filtering ───────────────────────────────────────────────────

/** Filters history entries by a query string, matching against URL and title. */
export function filterHistory(history: BrowserHistoryEntry[], query: string, limit = 8): BrowserHistoryEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return history.slice(0, limit);
  return history
    .filter((entry) =>
      entry.url.toLowerCase().includes(trimmed) || entry.title.toLowerCase().includes(trimmed),
    )
    .slice(0, limit);
}

/** Returns the first history URL that starts with the query, for Tab-completion. */
export function findCompletion(history: BrowserHistoryEntry[], query: string): string | undefined {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return undefined;
  return history.find((entry) => {
    const lower = entry.url.toLowerCase();
    return lower.startsWith(trimmed) && lower !== trimmed;
  })?.url;
}

/** Extracts the hostname from a URL, stripping `www.` prefix. Falls back to the raw URL. */
export function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ── Session persistence ─────────────────────────────────────────────────

function getBrowserSessionStorageKey(persistKey: string): string {
  return `${BROWSER_SESSION_KEY_PREFIX}${persistKey}`;
}

/** Reads a persisted browser session from localStorage. Returns empty defaults on failure. */
export function readBrowserSession(persistKey: string): PersistedBrowserSession {
  try {
    const raw = localStorage.getItem(getBrowserSessionStorageKey(persistKey));
    if (!raw) {
      return { tabs: [], activeTabId: null };
    }
    const parsed = JSON.parse(raw) as {
      tabs?: Array<Partial<BrowserTab>>;
      activeTabId?: unknown;
    };
    if (!Array.isArray(parsed.tabs)) {
      return { tabs: [], activeTabId: null };
    }

    const tabs: BrowserTab[] = parsed.tabs.flatMap((tab) => {
      if (!tab || typeof tab !== "object") return [];
      if (typeof tab.id !== "string" || tab.id.trim().length === 0) return [];
      if (typeof tab.url !== "string") return [];
      const title = typeof tab.title === "string" && tab.title.trim().length > 0 ? tab.title : "New Tab";
      return [{
        id: tab.id,
        url: tab.url,
        title,
        label: typeof tab.label === "string" && tab.label.trim().length > 0 ? tab.label : title,
        isLoading: Boolean(tab.isLoading),
        colorScheme: tab.colorScheme === "light" ? "light" : "dark",
        isStartPage: Boolean(tab.isStartPage),
      }];
    });

    const activeTabId = typeof parsed.activeTabId === "string" && tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs[0]?.id ?? null;

    return { tabs, activeTabId };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

/** Writes the current browser session state to localStorage. */
export function writeBrowserSession(persistKey: string, tabs: BrowserTab[], activeTabId: string | null): void {
  try {
    localStorage.setItem(getBrowserSessionStorageKey(persistKey), JSON.stringify({ tabs, activeTabId }));
  } catch {
    /* ignore localStorage errors */
  }
}

// ── History persistence ─────────────────────────────────────────────────

/** Reads browser history from localStorage with normalization. */
export function readBrowserHistory(): BrowserHistoryEntry[] {
  try {
    const raw = localStorage.getItem(BROWSER_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalized: BrowserHistoryEntry[] = [];
    for (const item of parsed) {
      if (typeof item === "string") {
        const url = normalizeHistoryUrl(item);
        if (!url) continue;
        normalized.push({ url, title: normalizeHistoryTitle(undefined, url) });
        continue;
      }
      if (item && typeof item === "object") {
        const rec = item as { url?: unknown; title?: unknown };
        const url = typeof rec.url === "string" ? normalizeHistoryUrl(rec.url) : null;
        if (!url) continue;
        const title = normalizeHistoryTitle(typeof rec.title === "string" ? rec.title : undefined, url);
        normalized.push({ url, title });
      }
    }
    return normalized.slice(0, MAX_BROWSER_HISTORY);
  } catch {
    return [];
  }
}

/** Writes browser history to localStorage. */
export function writeBrowserHistory(history: BrowserHistoryEntry[]): void {
  try {
    localStorage.setItem(BROWSER_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_BROWSER_HISTORY)));
  } catch {
    /* ignore localStorage errors */
  }
}
