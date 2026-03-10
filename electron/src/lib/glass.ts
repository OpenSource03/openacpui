import path from "path";
import os from "os";
import { log } from "./logger";
import { reportError } from "./error-utils";

interface LiquidGlass {
  addView: (handle: Buffer, opts?: object) => number;
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

    // Load the .node prebuild directly, bypassing node-gyp-build which
    // isn't available in ASAR builds (pnpm doesn't hoist transitive deps)
    const prebuildFile =
      process.arch === "arm64" ? "node.napi.armv8.node" : "node.napi.node";
    const prebuildPath = path.join(
      pkgDir, "prebuilds", `darwin-${process.arch}`, prebuildFile
    );

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require(prebuildPath);

    // Instantiate the native class directly (same as the library's JS wrapper does internally)
    const addon = new native.LiquidGlassNative();
    if (addon && typeof addon.addView === "function") {
      liquidGlass = addon;
      log("GLASS", `Native addon loaded from ${prebuildPath}`);
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
export { liquidGlass };
