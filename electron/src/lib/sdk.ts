import { app } from "electron";
import { getAppSetting } from "./app-settings";

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
      const msg = err instanceof Error ? err.message : String(err);
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

/**
 * Resolve the SDK's cli.js path for child process spawning.
 * In production ASAR builds, the SDK resolves cli.js inside app.asar via import.meta.url,
 * but the spawned Node child process has no ASAR patching and can't read it.
 * We translate app.asar → app.asar.unpacked so the child process finds the real file.
 */
export function getCliPath(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cliPath = require.resolve("@anthropic-ai/claude-agent-sdk/cli.js");
    if (!app.isPackaged) return cliPath;
    // asarUnpack puts cli.js in app.asar.unpacked/ — translate for child processes
    return cliPath.replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
  } catch {
    return undefined;
  }
}
