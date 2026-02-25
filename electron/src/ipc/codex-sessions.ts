/**
 * Codex app-server IPC handler.
 *
 * Manages the lifecycle of Codex sessions: spawn the `codex app-server` process,
 * perform the JSON-RPC initialize handshake, create/resume threads, forward
 * notifications to the renderer, and bridge approval requests.
 */

import { BrowserWindow, ipcMain } from "electron";
import { spawn } from "child_process";
import crypto from "crypto";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import { CodexRpcClient } from "../lib/codex-rpc";
import { getCodexBinaryPath, getCodexVersion } from "../lib/codex-binary";

// ── Session state ──

interface CodexSession {
  rpc: CodexRpcClient;
  internalId: string;
  threadId: string | null;
  /** Active turn id — needed for interrupt */
  activeTurnId: string | null;
  eventCounter: number;
  cwd: string;
  model?: string;
}

const codexSessions = new Map<string, CodexSession>();
const APP_SERVER_CLIENT_INFO = {
  name: "openacpui",
  title: "OpenACP UI",
  version: "0.1.0", // TODO: read from package.json
};

/** Extract a user-friendly error message from unknown error values. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Pick a valid model id from model/list, preferring the requested id when available. */
function pickModelId(
  requestedModel: string | undefined,
  models: Array<Record<string, unknown>>,
): string | undefined {
  const requested = typeof requestedModel === "string" ? requestedModel.trim() : "";
  if (requested.length > 0) {
    const hasRequested = models.some((m) => m.id === requested);
    if (hasRequested) return requested;
  }

  const defaultModel = models.find((m) => m.isDefault === true);
  if (typeof defaultModel?.id === "string") return defaultModel.id;

  const first = models[0];
  return typeof first?.id === "string" ? first.id : undefined;
}

// ── Registration ──

export function register(getMainWindow: () => BrowserWindow | null): void {
  // ─── codex:start ───
  ipcMain.handle(
    "codex:start",
    async (
      _,
      options: {
        cwd: string;
        model?: string;
        approvalPolicy?: string;
        personality?: string;
      },
    ) => {
      const internalId = crypto.randomUUID();

      try {
        const codexPath = await getCodexBinaryPath();
        log("codex",` Starting app-server: ${codexPath} (session=${internalId})`);

        const proc = spawn(codexPath, ["app-server"], {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: options.cwd,
          env: {
            ...process.env,
            RUST_LOG: process.env.RUST_LOG ?? "warn",
          },
        });

        if (!proc.pid) {
          throw new Error("Failed to spawn codex app-server process");
        }
        log("codex",` Spawned pid=${proc.pid} for session=${internalId}`);

        const rpc = new CodexRpcClient(proc);
        const session: CodexSession = {
          rpc,
          internalId,
          threadId: null,
          activeTurnId: null,
          eventCounter: 0,
          cwd: options.cwd,
          model: undefined,
        };
        codexSessions.set(internalId, session);

        // Forward stderr as log entries
        rpc.onStderr = (text) => {
          log("codex", `[stderr:${internalId.slice(0, 8)}] ${text.slice(0, 500)}`);
        };

        // Forward notifications to renderer
        rpc.onNotification = (msg) => {
          session.eventCounter++;

          // Track active turn from turn events
          if (msg.method === "turn/started") {
            const turn = (msg.params as Record<string, unknown>).turn as Record<string, unknown> | undefined;
            if (turn?.id) session.activeTurnId = turn.id as string;
          } else if (msg.method === "turn/completed") {
            session.activeTurnId = null;
          }

          safeSend(getMainWindow, "codex:event", {
            _sessionId: internalId,
            method: msg.method,
            params: msg.params,
          });
        };

        // Bridge server-initiated approval requests to renderer
        rpc.onServerRequest = (msg) => {
          if (
            msg.method === "item/commandExecution/requestApproval" ||
            msg.method === "item/fileChange/requestApproval"
          ) {
            safeSend(getMainWindow, "codex:approval_request", {
              _sessionId: internalId,
              rpcId: msg.id,
              method: msg.method,
              ...msg.params,
            });
          } else {
            // Unknown server request — auto-decline
            log("codex",` Unknown server request: ${msg.method}, auto-declining`);
            rpc.respondToServerError(msg.id, -32601, `Unsupported server request: ${msg.method}`);
          }
        };

        // Handle process exit
        rpc.onExit = (code, signal) => {
          log("codex",` Process exited: code=${code} signal=${signal} session=${internalId}`);
          codexSessions.delete(internalId);
          safeSend(getMainWindow, "codex:exit", {
            _sessionId: internalId,
            code,
            signal,
          });
        };

        // ── Initialize handshake ──
        const initResult = await rpc.request("initialize", {
          clientInfo: APP_SERVER_CLIENT_INFO,
          capabilities: {
            experimentalApi: true,
          },
        });
        rpc.notify("initialized", {});
        log("codex",` Initialized: ${JSON.stringify(initResult).slice(0, 200)}`);

        // ── Check auth status ──
        const authResult = (await rpc.request("account/read", { refreshToken: false })) as {
          account: Record<string, unknown> | null;
          requiresOpenaiAuth: boolean;
        };

        const needsAuth = authResult.requiresOpenaiAuth && !authResult.account;
        if (needsAuth) {
          // Notify renderer that auth is required — don't start thread yet
          safeSend(getMainWindow, "codex:event", {
            _sessionId: internalId,
            method: "codex:auth_required",
            params: { requiresOpenaiAuth: authResult.requiresOpenaiAuth },
          });
          return {
            sessionId: internalId,
            needsAuth: true,
            account: authResult.account,
          };
        }

        // ── Fetch available models ──
        let models: unknown[] = [];
        let selectedModel: string | undefined;
        try {
          const modelResult = (await rpc.request("model/list", { includeHidden: false })) as {
            data: unknown[];
          };
          models = modelResult.data ?? [];
          const modelEntries = (models as Array<Record<string, unknown>>)
            .filter((m) => typeof m?.id === "string");
          selectedModel = pickModelId(options.model, modelEntries);
          if (options.model && selectedModel !== options.model) {
            log("codex", ` Requested model ${options.model} not found; using ${selectedModel ?? "server default"}`);
          }
          if (selectedModel) {
            session.model = selectedModel;
          }
        } catch (err) {
          log("codex",` model/list failed: ${errorMessage(err)}`);
        }

        // ── Start a thread ──
        const threadParams: Record<string, unknown> = {
          cwd: options.cwd,
        };
        if (selectedModel) threadParams.model = selectedModel;
        if (options.approvalPolicy) threadParams.approvalPolicy = options.approvalPolicy;
        if (options.personality) threadParams.personality = options.personality;

        const threadResult = (await rpc.request("thread/start", threadParams)) as {
          thread: { id: string; [k: string]: unknown };
        };
        session.threadId = threadResult.thread.id;
        log("codex",` Thread started: ${session.threadId}`);

        return {
          sessionId: internalId,
          threadId: session.threadId,
          models,
          selectedModel,
          account: authResult.account,
          needsAuth: false,
        };
      } catch (err) {
        log("codex",` Start failed: ${errorMessage(err)}`);
        // Clean up on failure
        const session = codexSessions.get(internalId);
        if (session) {
          session.rpc.destroy();
          codexSessions.delete(internalId);
        }
        return { error: errorMessage(err) };
      }
    },
  );

  // ─── codex:send (start a turn) ───
  ipcMain.handle(
    "codex:send",
    async (
      _,
      data: {
        sessionId: string;
        text: string;
        images?: Array<{ type: "image"; url: string } | { type: "localImage"; path: string }>;
        effort?: string;
      },
    ) => {
      const session = codexSessions.get(data.sessionId);
      if (!session) return { error: "Session not found" };
      if (!session.threadId) return { error: "No active thread" };

      try {
        const input: unknown[] = [{ type: "text", text: data.text }];
        if (data.images) {
          input.push(...data.images);
        }

        const turnParams: Record<string, unknown> = {
          threadId: session.threadId,
          input,
        };
        if (session.model) turnParams.model = session.model;
        if (data.effort) turnParams.effort = data.effort;

        const result = (await session.rpc.request("turn/start", turnParams)) as {
          turn: { id: string; [k: string]: unknown };
        };
        session.activeTurnId = result.turn.id;
        return { turnId: result.turn.id };
      } catch (err) {
        return { error: errorMessage(err) };
      }
    },
  );

  // ─── codex:stop ───
  ipcMain.handle("codex:stop", async (_, sessionId: string) => {
    const session = codexSessions.get(sessionId);
    if (!session) return;
    session.rpc.destroy();
    codexSessions.delete(sessionId);
    log("codex",` Session stopped: ${sessionId}`);
  });

  // ─── codex:interrupt ───
  ipcMain.handle("codex:interrupt", async (_, sessionId: string) => {
    const session = codexSessions.get(sessionId);
    if (!session?.threadId || !session.activeTurnId) return { error: "No active turn" };

    try {
      await session.rpc.request("turn/interrupt", {
        threadId: session.threadId,
        turnId: session.activeTurnId,
      });
      return {};
    } catch (err) {
      return { error: errorMessage(err) };
    }
  });

  // ─── codex:approval_response ───
  ipcMain.handle(
    "codex:approval_response",
    async (
      _,
      data: {
        sessionId: string;
        rpcId: number;
        decision: string;
        acceptSettings?: { forSession?: boolean };
      },
    ) => {
      const session = codexSessions.get(data.sessionId);
      if (!session) return;

      const result: Record<string, unknown> = { decision: data.decision };
      if (data.acceptSettings) result.acceptSettings = data.acceptSettings;
      session.rpc.respondToServer(data.rpcId, result);
    },
  );

  // ─── codex:compact ───
  ipcMain.handle("codex:compact", async (_, sessionId: string) => {
    const session = codexSessions.get(sessionId);
    if (!session?.threadId) return { error: "No active thread" };

    try {
      await session.rpc.request("thread/compact/start", { threadId: session.threadId });
      return {};
    } catch (err) {
      return { error: errorMessage(err) };
    }
  });

  // ─── codex:list-models ───
  ipcMain.handle("codex:list-models", async () => {
    // Try to use any active session's RPC first
    for (const session of codexSessions.values()) {
      if (session.rpc.isAlive) {
        try {
          const result = (await session.rpc.request("model/list", { includeHidden: false })) as {
            data: unknown[];
          };
          return { models: result.data ?? [] };
        } catch {
          continue;
        }
      }
    }

    // No live session: spawn a short-lived app-server process and fetch model/list.
    try {
      const codexPath = await getCodexBinaryPath();
      const proc = spawn(codexPath, ["app-server"], {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: process.cwd(),
        env: {
          ...process.env,
          RUST_LOG: process.env.RUST_LOG ?? "warn",
        },
      });
      if (!proc.pid) {
        throw new Error("Failed to spawn codex app-server process");
      }

      const rpc = new CodexRpcClient(proc);
      try {
        await rpc.request("initialize", {
          clientInfo: APP_SERVER_CLIENT_INFO,
          capabilities: { experimentalApi: true },
        });
        rpc.notify("initialized", {});
        const result = (await rpc.request("model/list", { includeHidden: false })) as {
          data: unknown[];
        };
        return { models: result.data ?? [] };
      } finally {
        rpc.destroy();
      }
    } catch (err) {
      return { models: [], error: errorMessage(err) };
    }
  });

  // ─── codex:auth-status ───
  ipcMain.handle("codex:auth-status", async () => {
    for (const session of codexSessions.values()) {
      if (session.rpc.isAlive) {
        try {
          return await session.rpc.request("account/read", { refreshToken: false });
        } catch {
          continue;
        }
      }
    }
    return { account: null, requiresOpenaiAuth: true };
  });

  // ─── codex:login ───
  ipcMain.handle(
    "codex:login",
    async (
      _,
      data: {
        sessionId: string;
        type: "apiKey" | "chatgpt";
        apiKey?: string;
      },
    ) => {
      const session = codexSessions.get(data.sessionId);
      if (!session) return { error: "Session not found" };

      try {
        const params: Record<string, unknown> = { type: data.type };
        if (data.type === "apiKey" && data.apiKey) {
          params.apiKey = data.apiKey;
        }
        const result = await session.rpc.request("account/login/start", params, 60000);
        return result;
      } catch (err) {
        return { error: errorMessage(err) };
      }
    },
  );

  // ─── codex:resume (restart process + resume thread) ───
  ipcMain.handle(
    "codex:resume",
    async (
      _,
      data: {
        cwd: string;
        threadId: string;
        model?: string;
      },
    ) => {
      const internalId = crypto.randomUUID();

      try {
        const codexPath = await getCodexBinaryPath();
        log("codex",` Resuming thread ${data.threadId} in new process (session=${internalId})`);

        const proc = spawn(codexPath, ["app-server"], {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: data.cwd,
          env: {
            ...process.env,
            RUST_LOG: process.env.RUST_LOG ?? "warn",
          },
        });

        if (!proc.pid) throw new Error("Failed to spawn codex app-server");

        const rpc = new CodexRpcClient(proc);
        const session: CodexSession = {
          rpc,
          internalId,
          threadId: null,
          activeTurnId: null,
          eventCounter: 0,
          cwd: data.cwd,
          model: data.model,
        };
        codexSessions.set(internalId, session);

        // Set up handlers (same as codex:start)
        rpc.onStderr = (text) => log("codex", `[stderr:${internalId.slice(0, 8)}] ${text.slice(0, 500)}`);
        rpc.onNotification = (msg) => {
          session.eventCounter++;
          if (msg.method === "turn/started") {
            const turn = (msg.params as Record<string, unknown>).turn as Record<string, unknown> | undefined;
            if (turn?.id) session.activeTurnId = turn.id as string;
          } else if (msg.method === "turn/completed") {
            session.activeTurnId = null;
          }
          safeSend(getMainWindow, "codex:event", {
            _sessionId: internalId,
            method: msg.method,
            params: msg.params,
          });
        };
        rpc.onServerRequest = (msg) => {
          if (
            msg.method === "item/commandExecution/requestApproval" ||
            msg.method === "item/fileChange/requestApproval"
          ) {
            safeSend(getMainWindow, "codex:approval_request", {
              _sessionId: internalId,
              rpcId: msg.id,
              method: msg.method,
              ...msg.params,
            });
          } else {
            rpc.respondToServerError(msg.id, -32601, `Unsupported: ${msg.method}`);
          }
        };
        rpc.onExit = (code, signal) => {
          codexSessions.delete(internalId);
          safeSend(getMainWindow, "codex:exit", { _sessionId: internalId, code, signal });
        };

        // Initialize
        await rpc.request("initialize", {
          clientInfo: APP_SERVER_CLIENT_INFO,
          capabilities: { experimentalApi: true },
        });
        rpc.notify("initialized", {});

        // Resume thread
        const threadResult = (await rpc.request("thread/resume", {
          threadId: data.threadId,
        })) as { thread: { id: string; [k: string]: unknown } };
        session.threadId = threadResult.thread.id;
        log("codex",` Thread resumed: ${session.threadId}`);

        return { sessionId: internalId, threadId: session.threadId };
      } catch (err) {
        log("codex",` Resume failed: ${errorMessage(err)}`);
        const session = codexSessions.get(internalId);
        if (session) {
          session.rpc.destroy();
          codexSessions.delete(internalId);
        }
        return { error: errorMessage(err) };
      }
    },
  );

  // ─── codex:set-model ───
  ipcMain.handle(
    "codex:set-model",
    async (_, data: { sessionId: string; model: string }) => {
      const session = codexSessions.get(data.sessionId);
      if (!session) return { error: "Session not found" };
      // Store model for next turn/start override
      session.model = data.model;
      return {};
    },
  );

  // ─── codex:version ───
  ipcMain.handle("codex:version", async () => {
    try {
      return { version: await getCodexVersion() };
    } catch (err) {
      return { error: errorMessage(err) };
    }
  });
}

/** Stop all Codex sessions (called on app quit). */
export function stopAll(): void {
  for (const [id, session] of codexSessions) {
    session.rpc.destroy();
    codexSessions.delete(id);
  }
}
