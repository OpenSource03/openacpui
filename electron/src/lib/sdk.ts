import path from "path";
import fs from "fs";
import { app } from "electron";
import { getAppSetting } from "./app-settings";
import { log } from "./logger";
import { reportError } from "./error-utils";

// Import the SDK's own types — Query is the return type of sdk.query()
import type { Query, query as sdkQueryFn } from "@anthropic-ai/claude-agent-sdk";

type SDKQueryFn = typeof sdkQueryFn;

let _sdkQuery: SDKQueryFn | null = null;

export type { Query as QueryHandle };

export async function getSDK(): Promise<SDKQueryFn> {
  if (!_sdkQuery) {
    try {
      const sdk = await import("@anthropic-ai/claude-agent-sdk");
      _sdkQuery = sdk.query;
    } catch (err) {
      const msg = reportError("SDK_IMPORT_ERR", err);
      // Most common cause: Claude Code CLI is not installed
      if (msg.includes("Cannot find module") || msg.includes("MODULE_NOT_FOUND")) {
        throw new Error(
          "Claude Code is not installed. Install it from https://docs.anthropic.com/en/docs/claude-code/getting-started",
        );
      }
      throw new Error(`Failed to load Claude Code SDK: ${msg}`);
    }
  }
  return _sdkQuery;
}

/**
 * Environment variables that identify the app to the Claude backend.
 * The SDK reads CLAUDE_AGENT_SDK_CLIENT_APP and includes it in the User-Agent header,
 * letting Anthropic distinguish sessions from CLI / other clients.
 * Uses the custom client name from settings (defaults to "Harnss").
 */
export function clientAppEnv(): Record<string, string> {
  const clientName = getAppSetting("codexClientName") || "Harnss";
  return { CLAUDE_AGENT_SDK_CLIENT_APP: `${clientName}/${app.getVersion()}` };
}

const SDK_PACKAGE = ["@anthropic-ai", "claude-agent-sdk"].join("/");
const SDK_EMBED_EXPORT = [SDK_PACKAGE, "embed"].join("/");

/**
 * Resolve the SDK's cli.js path for child process spawning.
 * In production ASAR builds, the SDK may resolve cli.js inside app.asar, but the
 * spawned Node child process has no ASAR patching and can't read it. We derive
 * cli.js from the package entrypoint and prefer app.asar.unpacked when packaged.
 */
export function resolveCliPathFromEntry(entryPath: string, isPackaged: boolean): string {
  const cliPath = path.join(path.dirname(entryPath), "cli.js");
  if (!isPackaged) return cliPath;

  const unpackedCliPath = cliPath.replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
  return unpackedCliPath;
}

/** Cached CLI path — resolved once then reused. */
let _cachedCliPath: string | undefined;

interface CliPathResolution {
  strategy: "embed" | "package" | "app-path";
  path: string;
}

function candidateExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function tryResolveFromEntry(specifier: string, strategy: CliPathResolution["strategy"]): CliPathResolution | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const entryPath = require.resolve(specifier);
    const candidatePath = resolveCliPathFromEntry(entryPath, app.isPackaged);
    const exists = candidateExists(candidatePath);
    log("CLI_PATH_RESOLVE", `strategy=${strategy} entry=${entryPath} candidate=${candidatePath} exists=${exists}`);
    if (!exists) return undefined;
    return { strategy, path: candidatePath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("CLI_PATH_RESOLVE_ERR", `strategy=${strategy} specifier=${specifier} ${message}`);
    return undefined;
  }
}

function resolveFromEmbedEntry(): CliPathResolution | undefined {
  return tryResolveFromEntry(SDK_EMBED_EXPORT, "embed");
}

function resolveFromPackageEntry(): CliPathResolution | undefined {
  return tryResolveFromEntry(SDK_PACKAGE, "package");
}

function resolveFromAppPath(): CliPathResolution | undefined {
  if (!app.isPackaged) return undefined;

  const unpackedBase = app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked");
  const candidatePath = path.join(unpackedBase, "node_modules", "@anthropic-ai", "claude-agent-sdk", "cli.js");
  const exists = candidateExists(candidatePath);
  log("CLI_PATH_RESOLVE", `strategy=app-path candidate=${candidatePath} exists=${exists}`);
  if (!exists) return undefined;
  return { strategy: "app-path", path: candidatePath };
}

export function getCliPath(): string | undefined {
  if (_cachedCliPath) return _cachedCliPath;

  const resolution = resolveFromEmbedEntry() ?? resolveFromPackageEntry() ?? resolveFromAppPath();
  if (resolution) {
    _cachedCliPath = resolution.path;
    log("CLI_PATH_SELECTED", `strategy=${resolution.strategy} path=${resolution.path}`);
    return resolution.path;
  }

  log("CLI_PATH_MISSING", "No valid Claude CLI path resolved; SDK fallback may fail in packaged apps");
  return undefined;
}
