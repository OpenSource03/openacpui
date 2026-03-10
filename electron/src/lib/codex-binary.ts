/**
 * Codex binary resolution and auto-download.
 *
 * Search order:
 * 1. CODEX_CLI_PATH env var (explicit override)
 * 2. App data dir ({userData}/openacpui-data/bin/codex) — our managed copy (kept as openacpui-data for backward compat)
 * 3. System PATH (which codex)
 * 4. Known install locations (Homebrew, Codex Desktop app bundle)
 *
 * If not found anywhere, downloads via `npm pack @openai/codex` and extracts
 * the platform-specific binary to the app data dir.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { app } from "electron";
import { log } from "./logger";
import { reportError } from "./error-utils";
import { getAppSetting } from "./app-settings";

// Codex Desktop app bundle is prioritized because it ships a newer binary
// that supports features like collaborationMode (plan mode), while the
// homebrew/system CLI may be an older version.
const KNOWN_PATHS: string[] =
  process.platform === "darwin"
    ? [
        "/Applications/Codex.app/Contents/Resources/codex",
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
      ]
    : process.platform === "linux"
      ? ["/usr/local/bin/codex", "/usr/bin/codex"]
      : []; // Windows: rely on PATH

/** Where we store our managed copy of the codex binary. */
function getManagedBinDir(): string {
  const dir = path.join(app.getPath("userData"), "openacpui-data", "bin");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getManagedBinaryPath(): string {
  const name = process.platform === "win32" ? "codex.exe" : "codex";
  return path.join(getManagedBinDir(), name);
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Quick sync check — does a codex binary exist anywhere? */
export function isCodexInstalled(): boolean {
  try {
    resolveCodexPathSync();
    return true;
  } catch {
    return false;
  }
}

/** Resolve the codex binary path synchronously (no download). Throws if not found. */
function resolveCodexPathSync(): string {
  const source = getAppSetting("codexBinarySource");
  if (source === "custom") {
    const customPath = getAppSetting("codexCustomBinaryPath")?.trim();
    if (!customPath) throw new Error("Codex custom binary path is not set");
    if (!isExecutable(customPath)) throw new Error(`Configured Codex binary path is not executable: ${customPath}`);
    return customPath;
  }

  if (source === "managed") {
    const managedOnly = getManagedBinaryPath();
    if (isExecutable(managedOnly)) return managedOnly;
    throw new Error("Managed Codex binary not found");
  }

  // 1. Env override
  const envPath = process.env.CODEX_CLI_PATH;
  if (envPath && isExecutable(envPath)) return envPath;

  // 2. Managed copy
  const managed = getManagedBinaryPath();
  if (isExecutable(managed)) return managed;

  // 3. Known install locations — checked BEFORE system PATH because
  //    the Codex Desktop app bundle ships a newer binary that supports
  //    features like collaborationMode (plan mode), while the homebrew
  //    CLI may be an older version that silently ignores them.
  for (const known of KNOWN_PATHS) {
    if (isExecutable(known)) return known;
  }

  // 4. System PATH (fallback)
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const resolved = execFileSync(cmd, ["codex"], { encoding: "utf-8", timeout: 5000 }).trim();
    if (resolved && isExecutable(resolved)) return resolved;
  } catch {
    /* not in PATH */
  }

  throw new Error("Codex binary not found");
}

// Reset on each app launch so binary resolution picks up newly installed/updated binaries
let cachedPath: string | null = null;
let cachedSource: "auto" | "managed" | "custom" | null = null;
let downloadInFlight: Promise<string> | null = null;
const MANAGED_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

interface ManagedCodexMeta {
  packageVersion: string;
  platformTag: string;
  downloadedAt: number;
}

function getManagedMetaPath(): string {
  return path.join(getManagedBinDir(), "codex-meta.json");
}

function readManagedMeta(): ManagedCodexMeta | null {
  try {
    const raw = fs.readFileSync(getManagedMetaPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const meta = parsed as Partial<ManagedCodexMeta>;
    if (
      typeof meta.packageVersion !== "string" ||
      typeof meta.platformTag !== "string" ||
      typeof meta.downloadedAt !== "number"
    ) {
      return null;
    }
    return {
      packageVersion: meta.packageVersion,
      platformTag: meta.platformTag,
      downloadedAt: meta.downloadedAt,
    };
  } catch {
    return null;
  }
}

function writeManagedMeta(meta: ManagedCodexMeta): void {
  try {
    fs.writeFileSync(getManagedMetaPath(), JSON.stringify(meta, null, 2));
  } catch {
    // best effort
  }
}

function isManagedBinaryRefreshDue(): boolean {
  if (!isExecutable(getManagedBinaryPath())) return false;
  const meta = readManagedMeta();
  if (!meta) return true;
  if (meta.platformTag !== getPlatformTag()) return true;
  return Date.now() - meta.downloadedAt >= MANAGED_REFRESH_INTERVAL_MS;
}

/**
 * Resolve the codex binary path, downloading if necessary.
 * Returns the absolute path to the executable.
 */
export async function getCodexBinaryPath(): Promise<string> {
  const source = getAppSetting("codexBinarySource");
  if (cachedSource !== source) {
    cachedPath = null;
  }
  if (cachedPath && isExecutable(cachedPath)) return cachedPath;

  try {
    cachedPath = resolveCodexPathSync();
    cachedSource = source;
    log("codex-binary", `Found codex at: ${cachedPath}`);

    // Best-effort refresh for managed binary so bundled Codex keeps up with updates.
    if (cachedPath === getManagedBinaryPath() && isManagedBinaryRefreshDue()) {
      try {
        log("codex-binary", "Managed codex is stale; refreshing via npm...");
        cachedPath = await downloadCodexBinary();
        log("codex-binary", `Refreshed managed codex at: ${cachedPath}`);
      } catch (err) {
        reportError("codex-binary", err, { context: "managed-refresh" });
      }
    }
    return cachedPath;
  } catch (err) {
    if (source === "custom") {
      throw err;
    }
    // Not found — attempt auto-download
  }

  if (downloadInFlight) return downloadInFlight;

  log("codex-binary", "Codex not found locally, downloading via npm...");
  downloadInFlight = downloadCodexBinary()
    .then((binaryPath) => {
      cachedPath = binaryPath;
      cachedSource = source;
      return binaryPath;
    })
    .finally(() => {
      downloadInFlight = null;
    });
  cachedPath = await downloadInFlight;
  log("codex-binary", `Downloaded codex to: ${cachedPath}`);
  return cachedPath;
}

export function getCodexBinaryStatus(): {
  installed: boolean;
  downloading: boolean;
} {
  return {
    installed: isCodexInstalled(),
    downloading: downloadInFlight != null,
  };
}

/** Get the codex version string, or null if not available. */
export async function getCodexVersion(): Promise<string | null> {
  try {
    const binPath = await getCodexBinaryPath();
    const output = execFileSync(binPath, ["--version"], {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    return output;
  } catch {
    return null;
  }
}

/**
 * Platform dist-tag for @openai/codex npm package.
 * The package publishes platform-specific binaries under dist-tags like:
 *   darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-x64, win32-arm64
 */
function getPlatformTag(): string {
  const platform = process.platform; // darwin, linux, win32
  const arch = os.arch(); // arm64, x64
  return `${platform}-${arch}`;
}

function getNpmCommand(): string {
  // On Windows npm is exposed as npm.cmd for non-shell child process execution.
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runNpmPack(packageSpec: string, cwd: string): void {
  const args = ["pack", packageSpec, "--pack-destination", "."];
  const options = {
    cwd,
    encoding: "utf-8" as const,
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"] as const,
  };

  try {
    execFileSync(getNpmCommand(), args, options);
    return;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (process.platform === "win32" && err.code === "EINVAL") {
      const comSpec = process.env.ComSpec || "cmd.exe";
      log("codex-binary", `npm.cmd failed with EINVAL, retrying via ${comSpec}`);
      execFileSync(comSpec, ["/d", "/c", "npm", "pack", packageSpec, "--pack-destination", "."], options);
      return;
    }
    throw error;
  }
}

function listFilesRecursive(root: string, maxCount = 20): string {
  const out: string[] = [];
  const queue = [root];
  while (queue.length > 0 && out.length < maxCount) {
    const current = queue.shift()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= maxCount) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  return out.join("\n");
}

function getVendorTargetTriple(): string | null {
  const key = `${process.platform}-${os.arch()}`;
  switch (key) {
    case "win32-arm64":
      return "aarch64-pc-windows-msvc";
    case "win32-x64":
      return "x86_64-pc-windows-msvc";
    case "darwin-arm64":
      return "aarch64-apple-darwin";
    case "darwin-x64":
      return "x86_64-apple-darwin";
    case "linux-arm64":
      return "aarch64-unknown-linux-gnu";
    case "linux-x64":
      return "x86_64-unknown-linux-gnu";
    default:
      return null;
  }
}

function resolveBinaryFromPackageJson(packageRoot: string): string | null {
  try {
    const pkgPath = path.join(packageRoot, "package.json");
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const pkg = parsed as { bin?: string | Record<string, string> };
    const binEntry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.codex;
    if (!binEntry || typeof binEntry !== "string") return null;
    const resolved = path.resolve(packageRoot, binEntry);
    return fs.existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function readExtractedPackageVersion(packageRoot: string): string | null {
  try {
    const pkgPath = path.join(packageRoot, "package.json");
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const pkg = parsed as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function findBinaryInPackage(root: string, binaryName: string): string | null {
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === binaryName) {
        return fullPath;
      }
    }
  }
  return null;
}

/**
 * Download the codex binary via `npm pack @openai/codex@<platform-tag>`.
 * Extracts the binary and moves it to our managed bin directory.
 */
async function downloadCodexBinary(): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-download-"));

  try {
    const platformTag = getPlatformTag();
    const packageSpec = `@openai/codex@${platformTag}`;

    log("codex-binary", `npm pack ${packageSpec} in ${tmpDir}`);

    // npm pack downloads the tarball
    runNpmPack(packageSpec, tmpDir);

    // Find the downloaded .tgz
    const tgzFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tgz"));
    if (tgzFiles.length === 0) {
      throw new Error("npm pack produced no .tgz file");
    }
    const tgzPath = path.join(tmpDir, tgzFiles[0]);

    // Extract
    execFileSync("tar", ["xzf", tgzPath], { cwd: tmpDir, timeout: 30000 });

    const packageRoot = path.join(tmpDir, "package");
    // The binary is at package/bin/codex (or package/bin/codex.exe on Windows)
    const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
    const extractedBinary = path.join(packageRoot, "bin", binaryName);

    if (!fs.existsSync(extractedBinary)) {
      const vendorTriple = getVendorTargetTriple();
      const vendorBinary = vendorTriple
        ? path.join(packageRoot, "vendor", vendorTriple, "codex", binaryName)
        : null;

      // Fallback: alternate package layouts (root or vendor/<target>/codex/)
      const altPaths = [
        resolveBinaryFromPackageJson(packageRoot),
        vendorBinary,
        path.join(packageRoot, binaryName),
        path.join(packageRoot, "codex"),
        findBinaryInPackage(packageRoot, binaryName),
      ].filter((p): p is string => typeof p === "string");
      const found = altPaths.find((p) => fs.existsSync(p));
      if (!found) {
        // List what's in the package for debugging
        const contents = listFilesRecursive(packageRoot, 20);
        throw new Error(`Codex binary not found in package. Contents:\n${contents}`);
      }
      fs.copyFileSync(found, getManagedBinaryPath());
    } else {
      fs.copyFileSync(extractedBinary, getManagedBinaryPath());
    }

    // Ensure executable
    fs.chmodSync(getManagedBinaryPath(), 0o755);
    const packageVersion = readExtractedPackageVersion(packageRoot);
    if (packageVersion) {
      writeManagedMeta({
        packageVersion,
        platformTag,
        downloadedAt: Date.now(),
      });
    }

    return getManagedBinaryPath();
  } finally {
    // Clean up temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
