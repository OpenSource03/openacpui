import { app } from "electron";

type QueryHandle = AsyncGenerator & {
  close: () => void;
  interrupt: () => Promise<void>;
  setPermissionMode: (mode: string) => Promise<void>;
  mcpServerStatus?: () => Promise<unknown[]>;
  reconnectMcpServer?: (serverName: string) => Promise<void>;
  supportedModels?: () => Promise<Array<{ value: string; displayName: string; description: string }>>;
  /** Restore files to their state at the given user message UUID checkpoint */
  rewindFiles?: (userMessageUuid: string) => Promise<void>;
};

type QueryFn = (args: { prompt: unknown; options: unknown }) => QueryHandle;

let _sdkQuery: QueryFn | null = null;

export type { QueryHandle };

export async function getSDK(): Promise<QueryFn> {
  if (!_sdkQuery) {
    try {
      const sdk = await import("@anthropic-ai/claude-agent-sdk");
      _sdkQuery = sdk.query as unknown as QueryFn;
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
