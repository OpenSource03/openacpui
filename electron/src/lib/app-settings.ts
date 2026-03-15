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

export interface AppSettings {
  /** Include pre-release versions when checking for updates (default: true) */
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
  /** Default skills enabled for OpenClaw sessions */
  openclawDefaultSkills: string[];
}

const NOTIFICATION_DEFAULTS: NotificationSettings = {
  exitPlanMode: { osNotification: "unfocused", sound: "always" },
  permissions: { osNotification: "unfocused", sound: "unfocused" },
  askUserQuestion: { osNotification: "unfocused", sound: "always" },
  sessionComplete: { osNotification: "unfocused", sound: "always" },
};

const DEFAULTS: AppSettings = {
  allowPrereleaseUpdates: true,
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
    cached = {
      ...DEFAULTS,
      ...parsed,
      notifications: {
        exitPlanMode: { ...NOTIFICATION_DEFAULTS.exitPlanMode, ...parsedNotif?.exitPlanMode },
        permissions: { ...NOTIFICATION_DEFAULTS.permissions, ...parsedNotif?.permissions },
        askUserQuestion: { ...NOTIFICATION_DEFAULTS.askUserQuestion, ...parsedNotif?.askUserQuestion },
        sessionComplete: { ...NOTIFICATION_DEFAULTS.sessionComplete, ...parsedNotif?.sessionComplete },
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
