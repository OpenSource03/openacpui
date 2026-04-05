/** Shared types and constants for the Browser panel system. */

// ── Electron webview element ────────────────────────────────────────────

interface DevToolsOpenOptions {
  mode?: "detach";
  activate?: boolean;
}

/** Typed interface for Electron's `<webview>` DOM element with navigation methods. */
export interface ElectronWebviewElement extends HTMLElement {
  src: string;
  getURL(): string;
  getTitle(): string;
  getWebContentsId(): number;
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
  openDevTools(options?: DevToolsOpenOptions): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
}

// ── Webview event types (replacing inline `as` casts) ───────────────────

/** Fired by `page-title-updated` on the webview element. */
export interface WebviewTitleEvent extends Event {
  title: string;
}

/** Fired by `console-message` on the webview element. */
export interface WebviewConsoleEvent extends Event {
  message: string;
  level: number;
}

// ── Domain types ────────────────────────────────────────────────────────

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  label: string;
  isLoading: boolean;
  colorScheme: BrowserColorScheme;
  isStartPage?: boolean;
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
}

export type BrowserColorScheme = "light" | "dark";

export interface PersistedBrowserSession {
  tabs: BrowserTab[];
  activeTabId: string | null;
}

// ── Storage constants ───────────────────────────────────────────────────

export const BROWSER_HISTORY_KEY = "harnss-browser-history";
export const BROWSER_SESSION_KEY_PREFIX = "harnss-browser-session:";
export const MAX_BROWSER_HISTORY = 100;
