/**
 * Lightweight JSON-RPC 2.0 client over stdio (JSONL).
 *
 * The Codex app-server protocol is JSON-RPC 2.0 with the `"jsonrpc":"2.0"` header
 * omitted on the wire. Three message shapes arrive on stdout:
 *
 * 1. **Response** to our request:   `{ id, result }` or `{ id, error }`
 * 2. **Server-initiated request**:  `{ id, method, params }` (has both id AND method)
 * 3. **Notification**:              `{ method, params }` (no id)
 */

import type { ChildProcess } from "child_process";
import { log } from "./logger";

const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type ServerRequestHandler = (msg: {
  id: number;
  method: string;
  params: Record<string, unknown>;
}) => void;

export type NotificationHandler = (msg: {
  method: string;
  params: Record<string, unknown>;
}) => void;

export class CodexRpcClient {
  private nextId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private lineBuffer = "";
  private destroyed = false;

  /** Called for server-initiated requests (e.g. approval prompts) */
  onServerRequest: ServerRequestHandler | null = null;
  /** Called for server notifications (item/*, turn/*, etc.) */
  onNotification: NotificationHandler | null = null;
  /** Called when the process stderr emits data */
  onStderr: ((data: string) => void) | null = null;
  /** Called when the process exits */
  onExit: ((code: number | null, signal: string | null) => void) | null = null;

  constructor(private proc: ChildProcess) {
    proc.stdout?.on("data", (chunk: Buffer) => this.handleData(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.onStderr?.(text);
    });
    proc.on("exit", (code, signal) => {
      this.destroyed = true;
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Codex process exited (code=${code}, signal=${signal}) while waiting for ${pending.method}`));
        this.pendingRequests.delete(id);
      }
      this.onExit?.(code, signal);
    });
    proc.on("error", (err) => {
      log("codex-rpc", `Process error: ${err.message}`);
    });
  }

  /** Send a JSON-RPC request and wait for the response. */
  async request<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    if (this.destroyed) throw new Error("Codex RPC client is destroyed");

    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex RPC timeout: ${method} (id=${id}) after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (r: unknown) => void,
        reject,
        timer,
        method,
      });

      this.writeLine({ method, id, params: params ?? {} });
    });
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  notify(method: string, params?: unknown): void {
    if (this.destroyed) return;
    this.writeLine({ method, params: params ?? {} });
  }

  /** Respond to a server-initiated request. */
  respondToServer(id: number, result: unknown): void {
    if (this.destroyed) return;
    this.writeLine({ id, result });
  }

  /** Respond to a server-initiated request with an error. */
  respondToServerError(id: number, code: number, message: string): void {
    if (this.destroyed) return;
    this.writeLine({ id, error: { code, message } });
  }

  /** Kill the underlying process. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.proc.kill();
    } catch {
      /* already dead */
    }
  }

  get isAlive(): boolean {
    return !this.destroyed && this.proc.exitCode === null && !this.proc.killed;
  }

  get pid(): number | undefined {
    return this.proc.pid;
  }

  // ── Internal ──

  private writeLine(msg: Record<string, unknown>): void {
    if (this.destroyed || !this.proc.stdin || this.proc.stdin.destroyed) return;
    const line = JSON.stringify(msg) + "\n";
    this.proc.stdin.write(line);
  }

  private handleData(chunk: Buffer): void {
    this.lineBuffer += chunk.toString();
    const lines = this.lineBuffer.split("\n");
    this.lineBuffer = lines.pop()!; // keep incomplete trailing line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        this.dispatchMessage(msg);
      } catch (err) {
        log("codex-rpc", `Failed to parse line: ${(err as Error).message}`);
      }
    }
  }

  private dispatchMessage(msg: Record<string, unknown>): void {
    const hasId = "id" in msg && msg.id != null;
    const hasMethod = "method" in msg && typeof msg.method === "string";
    const hasResult = "result" in msg;
    const hasError = "error" in msg;

    if (hasId && (hasResult || hasError) && !hasMethod) {
      // Response to our request
      const id = msg.id as number;
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        clearTimeout(pending.timer);
        if (hasError) {
          const err = msg.error as RpcError;
          pending.reject(new Error(`Codex RPC error [${err.code}]: ${err.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if (hasId && hasMethod) {
      // Server-initiated request (e.g. approval prompt)
      this.onServerRequest?.({
        id: msg.id as number,
        method: msg.method as string,
        params: (msg.params ?? {}) as Record<string, unknown>,
      });
    } else if (hasMethod && !hasId) {
      // Notification
      this.onNotification?.({
        method: msg.method as string,
        params: (msg.params ?? {}) as Record<string, unknown>,
      });
    } else {
      log("codex-rpc", `Unrecognized message shape: ${JSON.stringify(msg).slice(0, 200)}`);
    }
  }
}
