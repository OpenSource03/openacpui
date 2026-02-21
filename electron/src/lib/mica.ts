import { BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { log } from "./logger";

interface MicaBrowserWindowClass {
  new (options: Electron.BrowserWindowConstructorOptions): MicaWindow;
}

export interface MicaWindow extends BrowserWindow {
  setDarkTheme(): void;
  setLightTheme(): void;
  setAutoTheme(): void;
  setMicaEffect(): void;
  setMicaTabbedEffect(): void;
  setMicaAcrylicEffect(): void;
  setAcrylic(): void;
  setBlur(): void;
  setTransparent(): void;
  setRoundedCorner(): void;
  setSmallRoundedCorner(): void;
  setSquareCorner(): void;
  setBorderColor(color: string | null): void;
  setCaptionColor(color: string | null): void;
  setTitleTextColor(color: string | null): void;
}

let MicaBrowserWindow: MicaBrowserWindowClass | null = null;
let isWindows11 = false;

if (process.platform === "win32") {
  try {
    // Verify native binary exists BEFORE requiring the module —
    // require("mica-electron") has side effects (enables transparent visuals globally)
    // and its MicaBrowserWindow constructor forces transparent: true even when
    // the native .node addon is missing, making the window invisible.
    const modPath = require.resolve("mica-electron");
    const modDir = path.dirname(modPath);
    const nativeBinary = path.join(modDir, "src", `micaElectron_${process.arch}.node`);

    if (!fs.existsSync(nativeBinary)) {
      log("MICA", `Native binary not found for ${process.arch}, mica disabled`);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("mica-electron");
      MicaBrowserWindow = mod.MicaBrowserWindow;
      isWindows11 = !!mod.IS_WINDOWS_11;
      log("MICA", `mica-electron loaded (Windows 11: ${isWindows11})`);
    }
  } catch (err) {
    log("MICA", `Failed to load mica-electron: ${(err as Error).message}`);
  }
}

export const micaEnabled = !!(MicaBrowserWindow && process.platform === "win32");
export { MicaBrowserWindow, isWindows11 };
