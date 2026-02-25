/**
 * Codex binary resolution and auto-download.
 *
 * Search order:
 * 1. CODEX_CLI_PATH env var (explicit override)
 * 2. App data dir ({userData}/openacpui-data/bin/codex) — our managed copy
 * 3. System PATH (which codex)
 * 4. Known install locations (Homebrew, Codex Desktop app bundle)
 *
 * If not found anywhere, downloads via `npm pack @openai/codex` and extracts
 * the platform-specific binary to the app data dir.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { execSync, execFileSync } from "child_process";
import { app } from "electron";
import { log } from "./logger";

const KNOWN_PATHS: string[] =
  process.platform === "darwin"
    ? [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        "/Applications/Codex.app/Contents/Resources/codex",
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
  // 1. Env override
  const envPath = process.env.CODEX_CLI_PATH;
  if (envPath && isExecutable(envPath)) return envPath;

  // 2. Managed copy
  const managed = getManagedBinaryPath();
  if (isExecutable(managed)) return managed;

  // 3. System PATH
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const resolved = execSync(`${cmd} codex`, { encoding: "utf-8", timeout: 5000 }).trim();
    if (resolved && isExecutable(resolved)) return resolved;
  } catch {
    /* not in PATH */
  }

  // 4. Known install locations
  for (const known of KNOWN_PATHS) {
    if (isExecutable(known)) return known;
  }

  throw new Error("Codex binary not found");
}

let cachedPath: string | null = null;

/**
 * Resolve the codex binary path, downloading if necessary.
 * Returns the absolute path to the executable.
 */
export async function getCodexBinaryPath(): Promise<string> {
  if (cachedPath && isExecutable(cachedPath)) return cachedPath;

  try {
    cachedPath = resolveCodexPathSync();
    log("codex-binary", `Found codex at: ${cachedPath}`);
    return cachedPath;
  } catch {
    // Not found — attempt auto-download
  }

  log("codex-binary", "Codex not found locally, downloading via npm...");
  cachedPath = await downloadCodexBinary();
  log("codex-binary", `Downloaded codex to: ${cachedPath}`);
  return cachedPath;
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
    execSync(`npm pack ${packageSpec} --pack-destination .`, {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 120000, // 2 min timeout for download
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Find the downloaded .tgz
    const tgzFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tgz"));
    if (tgzFiles.length === 0) {
      throw new Error("npm pack produced no .tgz file");
    }
    const tgzPath = path.join(tmpDir, tgzFiles[0]);

    // Extract
    execSync(`tar xzf "${tgzPath}"`, { cwd: tmpDir, timeout: 30000 });

    // The binary is at package/bin/codex (or package/bin/codex.exe on Windows)
    const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
    const extractedBinary = path.join(tmpDir, "package", "bin", binaryName);

    if (!fs.existsSync(extractedBinary)) {
      // Fallback: some versions put the binary at the root of the package
      const altPaths = [
        path.join(tmpDir, "package", binaryName),
        path.join(tmpDir, "package", "codex"),
      ];
      const found = altPaths.find((p) => fs.existsSync(p));
      if (!found) {
        // List what's in the package for debugging
        const contents = execSync(`find "${path.join(tmpDir, "package")}" -type f | head -20`, {
          encoding: "utf-8",
          timeout: 5000,
        });
        throw new Error(`Codex binary not found in package. Contents:\n${contents}`);
      }
      fs.copyFileSync(found, getManagedBinaryPath());
    } else {
      fs.copyFileSync(extractedBinary, getManagedBinaryPath());
    }

    // Ensure executable
    fs.chmodSync(getManagedBinaryPath(), 0o755);

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
