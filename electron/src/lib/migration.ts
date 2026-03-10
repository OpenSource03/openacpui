/**
 * One-time data migration from "OpenACP UI" to "Harnss".
 *
 * When productName changed, Electron's app.getPath("userData") moved from
 * `~/Library/Application Support/OpenACP UI/` to `~/Library/Application Support/Harnss/`.
 * This module copies all user data (sessions, settings, agents, OAuth tokens, binaries)
 * from the old location so existing users don't lose anything after updating.
 *
 * Runs once on first launch — writes a `.harnss-migrated` flag to prevent re-runs.
 * Old data is NOT deleted (user can clean up manually).
 */

import path from "path";
import fs from "fs";
import { app } from "electron";
import { log } from "./logger";
import { reportError } from "./error-utils";

/** Construct the old "OpenACP UI" userData path for each platform. */
function getOldUserDataPath(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(app.getPath("appData"), "OpenACP UI");
    case "win32":
      return path.join(app.getPath("appData"), "OpenACP UI");
    case "linux":
      // Electron uses ~/.config/{productName} on Linux
      return path.join(app.getPath("home"), ".config", "OpenACP UI");
    default:
      return path.join(app.getPath("appData"), "OpenACP UI");
  }
}

/** Clean up orphaned updater cache from the old app name. */
function cleanOldUpdaterCache(): void {
  if (process.platform !== "darwin") return;

  const oldCacheDir = path.join(
    path.dirname(app.getPath("appData")),
    "Caches",
    "open-acp-ui-updater",
  );

  if (fs.existsSync(oldCacheDir)) {
    try {
      fs.rmSync(oldCacheDir, { recursive: true, force: true });
      log("MIGRATION", "Cleaned old updater cache: open-acp-ui-updater");
    } catch (err) {
      reportError("MIGRATION_WARN", err, { context: "clean-old-updater-cache" });
    }
  }
}

export function migrateFromOpenAcpUi(): void {
  const newUserData = app.getPath("userData");
  const flagPath = path.join(newUserData, ".harnss-migrated");

  // Already migrated — skip
  if (fs.existsSync(flagPath)) return;

  const oldUserData = getOldUserDataPath();
  const oldDataDir = path.join(oldUserData, "openacpui-data");

  if (!fs.existsSync(oldDataDir)) {
    log("MIGRATION", "No old OpenACP UI data found, skipping migration");
    // Still write the flag so we don't check every launch
    fs.mkdirSync(newUserData, { recursive: true });
    fs.writeFileSync(flagPath, new Date().toISOString());
    return;
  }

  log("MIGRATION", `Migrating from ${oldDataDir} → ${newUserData}`);

  const newDataDir = path.join(newUserData, "openacpui-data");
  fs.mkdirSync(newDataDir, { recursive: true });

  // Directories to copy recursively
  const dirs = ["sessions", "mcp-oauth", "bin"];
  for (const dir of dirs) {
    const src = path.join(oldDataDir, dir);
    const dst = path.join(newDataDir, dir);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try {
        fs.cpSync(src, dst, { recursive: true });
        log("MIGRATION", `Copied directory: ${dir}`);
      } catch (err) {
        reportError("MIGRATION_ERR", err, { context: "copy-directory", dir });
      }
    }
  }

  // Individual files to copy
  const files = ["settings.json", "agents.json", "spaces.json", "projects.json"];
  for (const file of files) {
    const src = path.join(oldDataDir, file);
    const dst = path.join(newDataDir, file);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try {
        fs.copyFileSync(src, dst);
        log("MIGRATION", `Copied file: ${file}`);
      } catch (err) {
        reportError("MIGRATION_ERR", err, { context: "copy-file", file });
      }
    }
  }

  // Copy old logs (non-critical, best-effort)
  const oldLogs = path.join(oldUserData, "logs");
  const newLogs = path.join(newUserData, "logs");
  if (fs.existsSync(oldLogs) && !fs.existsSync(newLogs)) {
    try {
      fs.cpSync(oldLogs, newLogs, { recursive: true });
      log("MIGRATION", "Copied logs directory");
    } catch {
      // Non-critical — logs are for debugging only
    }
  }

  // Clean up orphaned updater cache
  cleanOldUpdaterCache();

  // Write migration flag
  fs.writeFileSync(flagPath, new Date().toISOString());
  log("MIGRATION", "Migration complete");
}
