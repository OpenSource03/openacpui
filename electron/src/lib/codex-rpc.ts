/**
 * Re-exports the shared CodexRpcClient with Electron's logger injected.
 *
 * Electron consumers continue to use `new CodexRpcClient(proc)` — the factory
 * function wraps the shared class to inject the platform-specific logger.
 */

import type { ChildProcess } from "child_process";
import { CodexRpcClient as SharedCodexRpcClient } from "@shared/lib/codex-rpc";
import { log } from "./logger";
import { reportError } from "./error-utils";

export type {
  RpcError,
  ServerRequestHandler,
  NotificationHandler,
} from "@shared/lib/codex-rpc";

/**
 * Create a CodexRpcClient with Electron's logger and error reporter injected.
 */
export class CodexRpcClient extends SharedCodexRpcClient {
  constructor(proc: ChildProcess) {
    super(proc, { log, reportError });
  }
}
