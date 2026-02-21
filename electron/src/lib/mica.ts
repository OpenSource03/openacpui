import { BrowserWindow, nativeTheme } from "electron";
import fs from "fs";
import path from "path";
import { log } from "./logger";

// Raw native DWM functions loaded from mica-electron's native binary
type ExecuteDwmFn = (hwnd: number, params: number, value: number) => void;

let executeDwm: ExecuteDwmFn | null = null;
let isWindows11 = false;

// DWM parameter constants (from mica-electron)
const PARAMS = {
  BACKGROUND: { AUTO: 0, NONE: 1, MICA: 2, ACRYLIC: 3, TABBED_MICA: 4 },
  CORNER: 5,
  BORDER_COLOR: 6,
  CAPTION_COLOR: 7,
  TEXT_COLOR: 8,
  FRAME: 9,
  MARGIN: 10,
};

const THEME = { AUTO: 5, DARK: 1, LIGHT: 2 };

if (process.platform === "win32") {
  try {
    const modPath = require.resolve("mica-electron");
    const modDir = path.dirname(modPath);
    const nativeBinary = path.join(modDir, "src", `micaElectron_${process.arch}`);

    if (!fs.existsSync(nativeBinary + ".node")) {
      log("MICA", `Native binary not found for ${process.arch}, mica disabled`);
    } else {
      // Load ONLY the native binary — NOT the full mica-electron module.
      // require("mica-electron") has a module-level side effect that forces
      // enable-transparent-visuals globally, and MicaBrowserWindow forces
      // transparent: true which makes the window frame invisible.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const native = require(nativeBinary);
      executeDwm = native.executeDwm;

      // Detect Windows 11 by OS build number
      const version = require("os").release().split(".");
      isWindows11 = version.length === 3 && Number(version[2]) >= 22000;

      log("MICA", `Native DWM loaded directly (Windows 11: ${isWindows11})`);
    }
  } catch (err) {
    log("MICA", `Failed to load mica native module: ${(err as Error).message}`);
  }
}

export const micaEnabled = !!(executeDwm && process.platform === "win32");
export { isWindows11 };

/**
 * Apply mica/acrylic DWM effect to a regular BrowserWindow.
 * Does NOT require MicaBrowserWindow — calls the native DWM function directly,
 * avoiding the forced transparent: true that breaks the window frame.
 */
export function applyMicaEffect(win: BrowserWindow): void {
  if (!executeDwm) return;

  try {
    const hwnd = win.getNativeWindowHandle().readInt32LE(0);

    // Set dark theme
    nativeTheme.themeSource = "dark";
    if (isWindows11) {
      executeDwm(hwnd, PARAMS.BACKGROUND.AUTO, THEME.DARK);
    }

    // Apply acrylic (Win10+) or mica acrylic (Win11)
    if (isWindows11) {
      executeDwm(hwnd, PARAMS.BACKGROUND.ACRYLIC, THEME.DARK);
    }

    // Enable frame styling for resize/maximize
    executeDwm(hwnd, PARAMS.FRAME, 1);

    log("MICA", "DWM mica/acrylic effect applied");
  } catch (err) {
    log("MICA", `Failed to apply DWM effect: ${(err as Error).message}`);
  }
}
