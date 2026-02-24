import { app, ipcMain, BrowserWindow, shell } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo, ProgressInfo } from "electron-updater";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { log } from "./logger";
import { getAppSetting } from "./app-settings";
import { onSettingsChanged } from "../ipc/settings";

const execFileAsync = promisify(execFile);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing internal MacUpdater state for diagnostics
type MacUpdaterInternal = { squirrelDownloadedUpdate?: boolean };

// Track the latest downloaded update version for manual macOS install
let lastDownloadedVersion: string | null = null;

// Flag to prevent window-all-closed from calling app.quit() while quitAndInstall() is
// managing the quit lifecycle (Squirrel.Mac needs control of the process on macOS).
let installingUpdate = false;

export function getIsInstallingUpdate(): boolean {
  return installingUpdate;
}

export function initAutoUpdater(
  getMainWindow: () => BrowserWindow | null,
): void {
  if (!app.isPackaged) return;

  autoUpdater.logger = {
    info: (msg: unknown) => log("UPDATER", String(msg)),
    warn: (msg: unknown) => log("UPDATER_WARN", String(msg)),
    error: (msg: unknown) => log("UPDATER_ERR", String(msg)),
    debug: (msg: unknown) => log("UPDATER_DEBUG", String(msg)),
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Read persisted preference (defaults to true — all GitHub releases are pre-release/beta)
  autoUpdater.allowPrerelease = getAppSetting("allowPrereleaseUpdates");

  // React to setting changes at runtime (e.g. user toggles in Settings UI)
  onSettingsChanged((settings) => {
    autoUpdater.allowPrerelease = settings.allowPrereleaseUpdates;
    log("UPDATER", `allowPrerelease changed to ${settings.allowPrereleaseUpdates}`);
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    log("UPDATER", `Update available: ${info.version}`);
    const win = getMainWindow();
    win?.webContents.send("updater:update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("update-not-available", () => {
    log("UPDATER", "No update available");
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    const win = getMainWindow();
    win?.webContents.send("updater:download-progress", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred,
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    log("UPDATER", `Update downloaded: ${info.version}`);
    lastDownloadedVersion = info.version;
    const win = getMainWindow();
    win?.webContents.send("updater:update-downloaded", {
      version: info.version,
    });
  });

  autoUpdater.on("error", (err: Error) => {
    log("UPDATER_ERR", `Update error: ${err.message}`);
  });

  // IPC handlers for renderer
  ipcMain.handle("updater:download", () => autoUpdater.downloadUpdate());
  ipcMain.handle("updater:install", async () => {
    const squirrelReady = (autoUpdater as unknown as MacUpdaterInternal).squirrelDownloadedUpdate;
    log("UPDATER", `Install requested (squirrelReady=${squirrelReady})`);

    if (!squirrelReady && process.platform === "darwin") {
      // Squirrel.Mac requires code-signed apps — unsigned builds always fail verification.
      // Bypass Squirrel entirely: extract the downloaded ZIP and swap the .app bundle manually.
      log("UPDATER", "Squirrel.Mac unavailable (unsigned app), attempting manual install");
      try {
        await manualMacInstall(getMainWindow());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("UPDATER_ERR", `Manual install failed: ${msg}`);
        // Last resort: open the GitHub release page for manual download
        const releaseUrl = lastDownloadedVersion
          ? `https://github.com/OpenSource03/openacpui/releases/tag/v${lastDownloadedVersion}`
          : "https://github.com/OpenSource03/openacpui/releases/latest";
        shell.openExternal(releaseUrl);
        const win = getMainWindow();
        win?.webContents.send("updater:install-error", {
          message: "Automatic install failed. The download page has been opened — please install manually.",
        });
      }
      return;
    }

    if (!squirrelReady) {
      log("UPDATER_ERR", "Cannot install: Squirrel has not finished downloading the update");
      const win = getMainWindow();
      win?.webContents.send("updater:install-error", {
        message: "Update failed to verify. Try downloading the latest version manually.",
      });
      return;
    }

    installingUpdate = true;
    // Force-close all windows so Squirrel.Mac has clean control of the quit lifecycle.
    for (const win of BrowserWindow.getAllWindows()) {
      win.destroy(); // destroy() skips beforeunload/close events — immediate teardown
    }
    // Defer to next tick so window destruction propagates before Squirrel takes over
    setImmediate(() => {
      log("UPDATER", "Calling quitAndInstall()");
      autoUpdater.quitAndInstall();
    });
  });
  ipcMain.handle("updater:check", () => autoUpdater.checkForUpdates());
  ipcMain.handle("updater:current-version", () => app.getVersion());

  // Check 5s after startup, then every 4 hours
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      log("UPDATER_ERR", `Check failed: ${err.message}`);
    });
  }, 5000);

  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((err: Error) => {
        log("UPDATER_ERR", `Periodic check failed: ${err.message}`);
      });
    },
    4 * 60 * 60 * 1000,
  );
}

// ---------------------------------------------------------------------------
// Manual macOS install — bypasses Squirrel.Mac for unsigned apps.
//
// macOS doesn't lock running executables (unlike Windows), so we can safely
// swap the .app bundle while the process is alive. The OS keeps the old binary
// in memory via inode references until all file descriptors close.
//
// Flow: extract ZIP → rename old .app → copy new .app → strip quarantine → relaunch
// ---------------------------------------------------------------------------

/**
 * Find the downloaded update ZIP in electron-updater's cache directory.
 * Falls back to glob-matching if the exact version-based name isn't found.
 */
function findUpdateZip(): string | null {
  // electron-updater stores downloads in ~/Library/Caches/open-acp-ui-updater/pending/
  // app.getPath("appData") = ~/Library/Application Support, so go up one to ~/Library/
  const cacheDir = path.join(path.dirname(app.getPath("appData")), "Caches", "open-acp-ui-updater", "pending");
  if (!fs.existsSync(cacheDir)) return null;

  // Try exact match first (e.g. OpenACP-UI-0.6.1-arm64-mac.zip)
  if (lastDownloadedVersion) {
    const entries = fs.readdirSync(cacheDir);
    const match = entries.find(
      (e) => e.endsWith("-mac.zip") && e.includes(lastDownloadedVersion!),
    );
    if (match) return path.join(cacheDir, match);
  }

  // Fallback: pick the newest non-temp .zip
  const entries = fs.readdirSync(cacheDir)
    .filter((e) => e.endsWith("-mac.zip") && !e.startsWith("temp-"))
    .map((e) => ({ name: e, mtime: fs.statSync(path.join(cacheDir, e)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  return entries.length > 0 ? path.join(cacheDir, entries[0].name) : null;
}

async function manualMacInstall(mainWindow: BrowserWindow | null): Promise<void> {
  const zipPath = findUpdateZip();
  if (!zipPath) throw new Error("Downloaded update ZIP not found in cache");
  log("UPDATER", `Manual install: using ZIP at ${zipPath}`);

  // Resolve the current .app bundle path from the running executable
  // e.g. /Applications/OpenACP UI.app/Contents/MacOS/OpenACP UI → /Applications/OpenACP UI.app
  const exePath = app.getPath("exe");
  const appBundleMatch = exePath.match(/^(.+?\.app)\//);
  if (!appBundleMatch) throw new Error(`Cannot determine .app bundle from exe path: ${exePath}`);
  const appBundlePath = appBundleMatch[1];
  const appParentDir = path.dirname(appBundlePath);

  // Sanity check: make sure we can write to the app's parent directory
  try {
    fs.accessSync(appParentDir, fs.constants.W_OK);
  } catch {
    throw new Error(`No write permission to ${appParentDir} — install the app to a writable location`);
  }

  const tmpDir = path.join(app.getPath("temp"), `openacpui-update-${Date.now()}`);
  const backupPath = `${appBundlePath}.old`;

  try {
    // 1. Extract the ZIP using ditto (preserves macOS metadata, symlinks, xattrs)
    log("UPDATER", `Extracting ${path.basename(zipPath)} to ${tmpDir}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    await execFileAsync("ditto", ["-xk", zipPath, tmpDir]);

    // 2. Find the .app bundle inside the extracted directory
    const entries = fs.readdirSync(tmpDir);
    const appEntry = entries.find((e) => e.endsWith(".app"));
    if (!appEntry) throw new Error("No .app bundle found in update ZIP");
    const newAppPath = path.join(tmpDir, appEntry);

    // 3. Strip quarantine xattr so macOS doesn't block the unsigned app on first launch
    await execFileAsync("xattr", ["-cr", newAppPath]).catch(() => {
      /* non-fatal — xattr may not exist */
    });

    // 4. Atomic-ish swap: rename old .app → .old, copy new .app, delete .old
    //    If the copy fails, we roll back by renaming .old back.
    log("UPDATER", `Swapping ${appBundlePath}`);
    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }
    fs.renameSync(appBundlePath, backupPath);

    try {
      await execFileAsync("ditto", [newAppPath, appBundlePath]);
    } catch (copyErr) {
      // Rollback: restore the original app
      log("UPDATER_ERR", "Copy failed, rolling back");
      fs.renameSync(backupPath, appBundlePath);
      throw copyErr;
    }

    // Swap succeeded — clean up backup and temp files
    fs.rmSync(backupPath, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });

    log("UPDATER", "Manual install succeeded, relaunching");
    installingUpdate = true;

    // Close all windows then relaunch from the new binary
    for (const win of BrowserWindow.getAllWindows()) {
      win.destroy();
    }
    app.relaunch();
    app.exit(0);
  } catch (err) {
    // Clean up temp dir on failure
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
}
