/**
 * Main-process settings store — JSON file in the app data directory.
 *
 * Unlike useSettings (renderer localStorage), this store is readable at
 * startup before any BrowserWindow exists. Use it for settings that the
 * main process needs synchronously (e.g. autoUpdater.allowPrerelease).
 *
 * File location: {userData}/openacpui-data/settings.json (kept as openacpui-data for backward compat)
 */

import path from "path";
import fs from "fs";
import { getDataDir } from "./data-dir";

// ── Schema ──

export type PreferredEditor = "auto" | "cursor" | "code" | "zed";
export type VoiceDictationMode = "native" | "whisper";
export type NotificationTrigger = "always" | "unfocused" | "never";
export type CodexBinarySource = "auto" | "managed" | "custom";
export type ClaudeBinarySource = "auto" | "managed" | "custom";

export interface NotificationEventSettings {
  osNotification: NotificationTrigger;
  sound: NotificationTrigger;
}

export interface NotificationSettings {
  exitPlanMode: NotificationEventSettings;
  permissions: NotificationEventSettings;
  askUserQuestion: NotificationEventSettings;
  sessionComplete: NotificationEventSettings;
}

export type WebSearchProvider = "searxng" | "ddg-html" | "ddg-api" | "brave" | "tavily" | "google-cse";

export interface WebSearchProviderConfig {
  id: WebSearchProvider;
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
}

export interface WebSearchSettings {
  providers: WebSearchProviderConfig[];
  maxResults: number;
  timeout: number;
}

export type CrawlerProviderId = "jina-reader" | "crawl4ai" | "firecrawl";

export interface CrawlerProviderConfig {
  id: CrawlerProviderId;
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
}

export interface CrawlerSettings {
  providers: CrawlerProviderConfig[];
  timeout: number;
}

export interface AppSettings {
  /** Include pre-release versions when checking for updates (default: false) */
  allowPrereleaseUpdates: boolean;
  /** Number of recent chats to show per project in the sidebar (default: 10) */
  defaultChatLimit: number;
  /** Preferred code editor for "Open in Editor" actions (default: "auto" = try cursor → code → zed) */
  preferredEditor: PreferredEditor;
  /** Voice dictation mode: "native" uses OS dictation, "whisper" uses local AI model (default: "native") */
  voiceDictation: VoiceDictationMode;
  /** Per-event notification and sound configuration */
  notifications: NotificationSettings;
  /** Custom client name sent to Codex servers during handshake (default: "Harnss") */
  codexClientName: string;
  /** Which Codex binary source to use: auto-detect, managed download, or custom path */
  codexBinarySource: CodexBinarySource;
  /** Absolute path used when codexBinarySource is "custom" */
  codexCustomBinaryPath: string;
  /** Which Claude binary source to use: auto-detect, managed native install, or custom path */
  claudeBinarySource: ClaudeBinarySource;
  /** Absolute path used when claudeBinarySource is "custom" */
  claudeCustomBinaryPath: string;
  /** Show developer-only "Dev Fill" button in chat title bar (local dev builds only) */
  showDevFillInChatTitleBar: boolean;
  /** Show the Jira board UI in the sidebar and main panel (developer preview, default: false) */
  showJiraBoard: boolean;
  /** Enable anonymous analytics to help improve the app (default: true) */
  analyticsEnabled: boolean;
  /** Anonymous user ID for analytics (auto-generated) */
  analyticsUserId?: string;
  /** Last date (YYYY-MM-DD) when daily_active_user was sent, to deduplicate across restarts */
  analyticsLastDailyActiveDate?: string;
  /** OpenClaw Gateway WebSocket URL (default: ws://127.0.0.1:18789) */
  openclawGatewayUrl: string;
  /** Default model for OpenClaw sessions */
  openclawDefaultModel: string;
  openclawDefaultSkills: string[];
  openclawGatewayToken: string;
  openclawDeviceToken: string;
  openclawDeviceId: string;
  openclawDefaultAgent: string;
  /** Ollama server base URL (default: http://localhost:11434) */
  ollamaBaseUrl: string;
  /** Default Ollama model to use for new sessions */
  ollamaDefaultModel: string;
  /** Web search provider configuration with priority ordering */
  webSearch: WebSearchSettings;
  /** Extra ignore patterns appended to .harnssignore defaults (user can override) */
  ignorePatterns: string[];
  /** Disable default ignore patterns (only use .harnssignore file + custom patterns) */
  ignoreDefaultsDisabled: boolean;
  /** Crawler provider configuration with priority ordering */
  crawler: CrawlerSettings;
}

const CRAWLER_DEFAULTS: CrawlerSettings = {
  providers: [
    { id: "jina-reader", enabled: true },
    { id: "crawl4ai", enabled: false, baseUrl: "http://localhost:11235" },
    { id: "firecrawl", enabled: false, baseUrl: "http://localhost:3002" },
  ],
  timeout: 15000,
};

const WEB_SEARCH_DEFAULTS: WebSearchSettings = {
  providers: [
    { id: "searxng", enabled: false, baseUrl: "http://localhost:8080" },
    { id: "ddg-html", enabled: true },
    { id: "brave", enabled: false, apiKey: "" },
    { id: "tavily", enabled: false, apiKey: "" },
    { id: "google-cse", enabled: false, apiKey: "" },
    { id: "ddg-api", enabled: true },
  ],
  maxResults: 6,
  timeout: 8000,
};

const NOTIFICATION_DEFAULTS: NotificationSettings = {
  exitPlanMode: { osNotification: "unfocused", sound: "always" },
  permissions: { osNotification: "unfocused", sound: "unfocused" },
  askUserQuestion: { osNotification: "unfocused", sound: "always" },
  sessionComplete: { osNotification: "unfocused", sound: "always" },
};

const DEFAULTS: AppSettings = {
  allowPrereleaseUpdates: false,
  defaultChatLimit: 10,
  preferredEditor: "auto",
  voiceDictation: "native",
  notifications: NOTIFICATION_DEFAULTS,
  codexClientName: "Harnss",
  codexBinarySource: "auto",
  codexCustomBinaryPath: "",
  claudeBinarySource: "auto",
  claudeCustomBinaryPath: "",
  showDevFillInChatTitleBar: false,
  showJiraBoard: false,
  analyticsEnabled: true,
  openclawGatewayUrl: "ws://127.0.0.1:18789",
  openclawDefaultModel: "",
  openclawDefaultSkills: [],
  openclawGatewayToken: "",
  openclawDeviceToken: "",
  openclawDeviceId: "",
  openclawDefaultAgent: "",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaDefaultModel: "llama3",
  webSearch: WEB_SEARCH_DEFAULTS,
  ignorePatterns: [],
  ignoreDefaultsDisabled: false,
  crawler: CRAWLER_DEFAULTS,
};

// ── Internal state ──

let cached: AppSettings | null = null;

function filePath(): string {
  return path.join(getDataDir(), "settings.json");
}

// ── Public API ──

/** Read the full settings object (cached after first read). */
export function getAppSettings(): AppSettings {
  if (cached) return cached;

  try {
    const raw = fs.readFileSync(filePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // Merge with defaults so newly added keys are always present.
    // Deep-merge `notifications` so upgrading users get defaults for each event type
    // even if their settings.json has a partial or missing notifications object.
    const parsedNotif = parsed.notifications as Partial<NotificationSettings> | undefined;
    const parsedWebSearch = parsed.webSearch as Partial<WebSearchSettings> | undefined;
    cached = {
      ...DEFAULTS,
      ...parsed,
      notifications: {
        exitPlanMode: { ...NOTIFICATION_DEFAULTS.exitPlanMode, ...parsedNotif?.exitPlanMode },
        permissions: { ...NOTIFICATION_DEFAULTS.permissions, ...parsedNotif?.permissions },
        askUserQuestion: { ...NOTIFICATION_DEFAULTS.askUserQuestion, ...parsedNotif?.askUserQuestion },
        sessionComplete: { ...NOTIFICATION_DEFAULTS.sessionComplete, ...parsedNotif?.sessionComplete },
      },
      webSearch: {
        ...WEB_SEARCH_DEFAULTS,
        ...parsedWebSearch,
        providers: parsedWebSearch?.providers ?? WEB_SEARCH_DEFAULTS.providers,
      },
    };
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached;
}

/** Read a single setting by key. */
export function getAppSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return getAppSettings()[key];
}

/** Update one or more settings and persist to disk. */
export function setAppSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getAppSettings();
  const next = { ...current, ...patch };
  cached = next;

  try {
    fs.writeFileSync(filePath(), JSON.stringify(next, null, 2), "utf-8");
  } catch {
    // Non-fatal — setting is still cached in memory for this session
  }
  return next;
}
