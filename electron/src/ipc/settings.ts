import { ipcMain } from "electron";
import { getAppSettings, setAppSettings, type AppSettings } from "../lib/app-settings";
import { log } from "../lib/logger";

// Listeners notified when any setting changes (used by updater, etc.)
type SettingsListener = (settings: AppSettings) => void;
const listeners: SettingsListener[] = [];

export function onSettingsChanged(cb: SettingsListener): void {
  listeners.push(cb);
}

export function register(): void {
  ipcMain.handle("settings:get", () => {
    try {
      return getAppSettings();
    } catch (err) {
      log("SETTINGS:GET_ERR", (err as Error).message);
      return null;
    }
  });

  ipcMain.handle("settings:set", (_event, patch: Partial<AppSettings>) => {
    try {
      const next = setAppSettings(patch);
      // Notify in-process listeners (e.g. autoUpdater)
      for (const cb of listeners) cb(next);
      return { ok: true };
    } catch (err) {
      log("SETTINGS:SET_ERR", (err as Error).message);
      return { error: (err as Error).message };
    }
  });
}
