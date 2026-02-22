import { app, ipcMain, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo, ProgressInfo } from "electron-updater";
import { log } from "./logger";
import { getAppSetting } from "./app-settings";
import { onSettingsChanged } from "../ipc/settings";

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
  ipcMain.handle("updater:install", () => {
    installingUpdate = true;
    autoUpdater.quitAndInstall();
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
