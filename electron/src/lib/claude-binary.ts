import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawn } from "child_process";
import { getAppSetting } from "./app-settings";
import { extractErrorMessage, reportError } from "./error-utils";
import { log } from "./logger";
import { getCliPath } from "./sdk";

export type ClaudeBinarySource = "auto" | "managed" | "custom";
export type ClaudeBinaryResolutionStrategy = "custom" | "env" | "known" | "path" | "sdk-fallback";

interface ResolveClaudeBinaryOptions {
  installIfMissing?: boolean;
  allowSdkFallback?: boolean;
}

interface ClaudeBinaryResolution {
  strategy: ClaudeBinaryResolutionStrategy;
  path: string;
}

let cachedPath: string | null = null;
let cachedSource: ClaudeBinarySource | null = null;
let installInFlight: Promise<string> | null = null;

const CLAUDE_INSTALL_SH = "https://claude.ai/install.sh";
const CLAUDE_INSTALL_PS1 = "https://claude.ai/install.ps1";
const CLAUDE_INSTALL_CMD = "https://claude.ai/install.cmd";

function getSource(): ClaudeBinarySource {
  return getAppSetting("claudeBinarySource");
}

function getCustomPath(): string {
  return getAppSetting("claudeCustomBinaryPath")?.trim() || "";
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeExecutablePath(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  const normalized = path.normalize(trimmed);
  return isExecutable(normalized) ? normalized : null;
}

function getEnvOverride(): string | null {
  const envPath = process.env.CLAUDE_CODE_CLI_PATH || process.env.CLAUDE_CLI_PATH;
  return envPath ? normalizeExecutablePath(envPath) : null;
}

function getKnownPaths(): string[] {
  if (process.platform === "win32") return [];
  return [path.join(os.homedir(), ".local", "bin", "claude")];
}

function isScriptExecutable(filePath: string): boolean {
  return [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"].includes(path.extname(filePath));
}

function resolveFromCustom(): ClaudeBinaryResolution {
  const customPath = getCustomPath();
  if (!customPath) {
    throw new Error("Claude custom binary path is not set");
  }
  const resolved = normalizeExecutablePath(customPath);
  if (!resolved) {
    throw new Error(`Configured Claude binary path is not executable: ${customPath}`);
  }
  return { strategy: "custom", path: resolved };
}

function resolveFromEnv(): ClaudeBinaryResolution | null {
  const envPath = getEnvOverride();
  return envPath ? { strategy: "env", path: envPath } : null;
}

function resolveFromKnownPaths(): ClaudeBinaryResolution | null {
  for (const knownPath of getKnownPaths()) {
    const resolved = normalizeExecutablePath(knownPath);
    if (resolved) return { strategy: "known", path: resolved };
  }
  return null;
}

function resolveFromPathLookup(): ClaudeBinaryResolution | null {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(cmd, ["claude"], { encoding: "utf-8", timeout: 5000 });
    const candidates = output
      .split(/\r?\n/g)
      .map((line) => normalizeExecutablePath(line))
      .filter((candidate): candidate is string => !!candidate);
    const found = candidates[0];
    return found ? { strategy: "path", path: found } : null;
  } catch {
    return null;
  }
}

function resolveSdkFallback(): ClaudeBinaryResolution | null {
  const cliPath = getCliPath();
  return cliPath ? { strategy: "sdk-fallback", path: cliPath } : null;
}

function resolveClaudeBinarySync(options?: ResolveClaudeBinaryOptions): ClaudeBinaryResolution | null {
  const source = getSource();
  const allowSdkFallback = options?.allowSdkFallback ?? true;

  if (source === "custom") {
    return resolveFromCustom();
  }

  const resolution =
    resolveFromEnv() ??
    resolveFromKnownPaths() ??
    resolveFromPathLookup();

  if (resolution) return resolution;
  if (allowSdkFallback && source === "auto") {
    return resolveSdkFallback();
  }
  return null;
}

async function runInstaller(command: string, args: string[], label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      const trimmed = text.trim();
      if (trimmed) log("CLAUDE_BINARY_INSTALL_STDOUT", `${label} ${trimmed}`);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      const trimmed = text.trim();
      if (trimmed) log("CLAUDE_BINARY_INSTALL_STDERR", `${label} ${trimmed}`);
    });

    child.on("error", (err) => {
      reject(new Error(`${label} failed to start: ${extractErrorMessage(err)}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `exit code ${code ?? "unknown"}`;
      reject(new Error(`${label} failed: ${detail}`));
    });
  });
}

async function installClaudeBinary(): Promise<string> {
  log("CLAUDE_BINARY_INSTALL_START", `platform=${process.platform}`);
  try {
    if (process.platform === "win32") {
      try {
        await runInstaller(
          "powershell",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `irm ${CLAUDE_INSTALL_PS1} | iex`],
          "powershell",
        );
      } catch (err) {
        reportError("CLAUDE_BINARY_INSTALL_ERR", err, { installer: "powershell" });
        await runInstaller(
          "cmd",
          ["/c", `curl -fsSL ${CLAUDE_INSTALL_CMD} -o install.cmd && install.cmd && del install.cmd`],
          "cmd",
        );
      }
    } else {
      await runInstaller(
        "bash",
        ["-lc", `curl -fsSL ${CLAUDE_INSTALL_SH} | bash`],
        process.platform,
      );
    }

    const resolution = resolveClaudeBinarySync({ allowSdkFallback: false });
    if (!resolution) {
      throw new Error("Claude install completed but no executable was found on the system");
    }
    log("CLAUDE_BINARY_SELECTED", `strategy=${resolution.strategy} path=${resolution.path}`);
    return resolution.path;
  } catch (err) {
    reportError("CLAUDE_BINARY_INSTALL_ERR", err);
    throw err;
  }
}

export function isClaudeInstalled(): boolean {
  return resolveClaudeBinarySync({ installIfMissing: false, allowSdkFallback: false }) != null;
}

export async function getClaudeBinaryPath(options?: ResolveClaudeBinaryOptions): Promise<string> {
  const source = getSource();
  if (cachedSource !== source) {
    cachedPath = null;
  }

  if (cachedPath && isExecutable(cachedPath)) {
    return cachedPath;
  }

  const installIfMissing = options?.installIfMissing ?? true;
  const allowSdkFallback = options?.allowSdkFallback ?? true;

  const resolution = resolveClaudeBinarySync({ installIfMissing, allowSdkFallback });
  if (resolution) {
    cachedPath = resolution.path;
    cachedSource = source;
    log("CLAUDE_BINARY_SELECTED", `strategy=${resolution.strategy} path=${resolution.path}`);
    return resolution.path;
  }

  if (!installIfMissing || source === "custom") {
    throw new Error("Claude executable not found");
  }

  if (!installInFlight) {
    installInFlight = installClaudeBinary()
      .then((binaryPath) => {
        cachedPath = binaryPath;
        cachedSource = source;
        return binaryPath;
      })
      .finally(() => {
        installInFlight = null;
      });
  }

  try {
    const installedPath = await installInFlight;
    if (installedPath) return installedPath;
  } catch (err) {
    if (allowSdkFallback && source === "auto") {
      const fallback = resolveSdkFallback();
      if (fallback) {
        cachedPath = fallback.path;
        cachedSource = source;
        log("CLAUDE_BINARY_FALLBACK_SDK", `path=${fallback.path}`);
        return fallback.path;
      }
    }
    throw err;
  }

  if (allowSdkFallback && source === "auto") {
    const fallback = resolveSdkFallback();
    if (fallback) {
      cachedPath = fallback.path;
      cachedSource = source;
      log("CLAUDE_BINARY_FALLBACK_SDK", `path=${fallback.path}`);
      return fallback.path;
    }
  }

  throw new Error("Claude executable not found");
}

export function getClaudeBinaryStatus(): { installed: boolean; installing: boolean } {
  return {
    installed: isClaudeInstalled(),
    installing: installInFlight != null,
  };
}

function readClaudeVersion(binaryPath: string): string | null {
  const command = isScriptExecutable(binaryPath) ? process.execPath : binaryPath;
  const args = isScriptExecutable(binaryPath) ? [binaryPath, "--version"] : ["--version"];
  const output = execFileSync(command, args, {
    encoding: "utf-8",
    timeout: 10000,
  }).trim();
  return output || null;
}

export function getClaudeBinaryMetadata(options?: ResolveClaudeBinaryOptions): {
  path: string;
  strategy: ClaudeBinaryResolutionStrategy;
  source: ClaudeBinarySource;
} | null {
  const source = getSource();
  const resolution = resolveClaudeBinarySync(options);
  if (!resolution) return null;
  return {
    path: resolution.path,
    strategy: resolution.strategy,
    source,
  };
}

export async function getClaudeVersion(binaryPath?: string): Promise<string | null> {
  try {
    if (binaryPath) return readClaudeVersion(binaryPath);
    const resolution = resolveClaudeBinarySync({ installIfMissing: false, allowSdkFallback: true });
    if (!resolution) return null;
    return readClaudeVersion(resolution.path);
  } catch {
    return null;
  }
}
