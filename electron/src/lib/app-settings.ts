/**
 * Main-process settings store — JSON file in the app data directory.
 *
 * Unlike useSettings (renderer localStorage), this store is readable at
 * startup before any BrowserWindow exists. Use it for settings that the
 * main process needs synchronously (e.g. autoUpdater.allowPrerelease).
 *
 * File location: {userData}/openacpui-data/settings.json
 */

import path from "path";
import fs from "fs";
import { getDataDir } from "./data-dir";

// ── Schema ──

export type PreferredEditor = "auto" | "cursor" | "code" | "zed";

export interface AppSettings {
  /** Include pre-release versions when checking for updates (default: true) */
  allowPrereleaseUpdates: boolean;
  /** Number of recent chats to show per project in the sidebar (default: 10) */
  defaultChatLimit: number;
  /** Preferred code editor for "Open in Editor" actions (default: "auto" = try cursor → code → zed) */
  preferredEditor: PreferredEditor;
}

const DEFAULTS: AppSettings = {
  allowPrereleaseUpdates: true,
  defaultChatLimit: 10,
  preferredEditor: "auto",
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
    // Merge with defaults so newly added keys are always present
    cached = { ...DEFAULTS, ...parsed };
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
