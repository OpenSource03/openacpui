import path from "path";
import os from "os";
import { log } from "./logger";
import { reportError } from "./error-utils";

interface GlassOptions {
  tintColor?: string;
  cornerRadius?: number;
  opaque?: boolean;
}

interface LiquidGlass {
  addView: (handle: Buffer, opts?: GlassOptions) => number;
}

let liquidGlass: LiquidGlass | null = null;

if (process.platform === "darwin") {
  try {
    // Resolve the main entry, then walk up to package root.
    // Can't use require.resolve("…/package.json") — the package's "exports" field blocks it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mainEntry = require.resolve("electron-liquid-glass");
    // mainEntry = .../electron-liquid-glass/dist/index.cjs → go up past "dist/"
    const pkgDir = path.dirname(path.dirname(mainEntry));

    // Load the .node addon directly — try prebuild first, fall back to
    // electron-rebuild output (build/Release/).
    // Prebuilds aren't available for GitHub forks that lack CI-built binaries.
    const prebuildFile =
      process.arch === "arm64" ? "node.napi.armv8.node" : "node.napi.node";
    const prebuildPath = path.join(
      pkgDir, "prebuilds", `darwin-${process.arch}`, prebuildFile
    );
    const buildReleasePath = path.join(pkgDir, "build", "Release", "liquidglass.node");

    let addonPath: string;
    try {
      require("fs").accessSync(prebuildPath);
      addonPath = prebuildPath;
    } catch {
      addonPath = buildReleasePath;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require(addonPath);

    // Instantiate the native class directly (same as the library's JS wrapper does internally)
    const addon = new native.LiquidGlassNative();
    if (addon && typeof addon.addView === "function") {
      liquidGlass = addon;
      log("GLASS", `Native addon loaded from ${addonPath}`);
    } else {
      log("GLASS", "Native addon loaded but addView not found");
    }
  } catch (err) {
    reportError("GLASS", err, { context: "native-addon-load" });
  }
}

function isMacOSSequoiaOrLater(): boolean {
  if (process.platform !== "darwin") return false;
  // Darwin 25 = macOS 15 Sequoia (NSVisualEffectView fallback)
  // Darwin 26 = macOS 26 Tahoe (native NSGlassEffectView)
  const major = parseInt(os.release().split(".")[0], 10);
  return major >= 25;
}

export const glassEnabled = !!(liquidGlass && isMacOSSequoiaOrLater());

// ── Dynamic tint support ──
// Store the window handle so we can re-call addView() with updated tintColor.
// The C++ AddGlassEffectView auto-removes previous glass views before creating
// new ones in a single dispatch_sync block, so there is no visual gap.

let storedHandle: Buffer | null = null;

export function applyGlass(handle: Buffer, opts?: GlassOptions): number {
  if (!liquidGlass) return -1;
  storedHandle = handle;
  return liquidGlass.addView(handle, opts ?? {});
}

export function setGlassTint(tintColor: string | null): number {
  if (!liquidGlass || !storedHandle) return -1;
  return liquidGlass.addView(storedHandle, tintColor ? { tintColor } : {});
}
