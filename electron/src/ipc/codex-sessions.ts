/**
 * Codex app-server IPC handler.
 *
 * Manages the lifecycle of Codex sessions: spawn the `codex app-server` process,
 * perform the JSON-RPC initialize handshake, create/resume threads, forward
 * notifications to the renderer, and bridge approval requests.
 */

import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "child_process";
import crypto from "crypto";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import { CodexRpcClient } from "../lib/codex-rpc";
import { getCodexBinaryPath, getCodexVersion } from "../lib/codex-binary";
import { getAppSetting } from "../lib/app-settings";
import { extractErrorMessage } from "../lib/error-utils";

import type {
  CodexServerNotification,
  CodexModel,
  CodexModelListResponse,
  CodexAccountResponse,
  CodexThreadStartResponse,
  CodexThreadResumeResponse,
  CodexTurnStartResponse,
  CodexInitializeResponse,
  CodexItemStartedNotification,
  CodexItemCompletedNotification,
} from "@shared/types/codex";

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
const SUPPORTED_SERVER_REQUESTS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
]);

function isSupportedServerRequestMethod(method: string): boolean {
  return SUPPORTED_SERVER_REQUESTS.has(method);
}

function getAppServerClientInfo(): { name: string; title: string; version: string } {
  const clientName = getAppSetting("codexClientName") || "Harnss";
  return {
    name: clientName,
    title: clientName,
    version: app.getVersion(),
  };
}

/** Pick a valid model id from model/list, preferring the requested id when available. */
function pickModelId(
  requestedModel: string | undefined,
  models: Array<CodexModel>,
): string | undefined {
  const requested = typeof requestedModel === "string" ? requestedModel.trim() : "";
  if (requested.length > 0) {
    const hasRequested = models.some((m) => m.id === requested);
    if (hasRequested) return requested;
  }

  const defaultModel = models.find((m) => m.isDefault === true);
  if (defaultModel) return defaultModel.id;

  const first = models[0];
  return first?.id;
}

function shortId(value: unknown, length = 8): string {
  return typeof value === "string" ? value.slice(0, length) : "n/a";
}

function shouldLogFullToolEvent(
  method: string,
  params: CodexItemStartedNotification | CodexItemCompletedNotification,
): boolean {
  if (method !== "item/started" && method !== "item/completed") return false;
  const { item } = params;
  return (
    item.type === "commandExecution" ||
    item.type === "fileChange" ||
    item.type === "mcpToolCall" ||
    item.type === "webSearch" ||
    item.type === "imageView"
  );
}

function summarizeCodexNotification(notification: CodexServerNotification): string {
  switch (notification.method) {
    case "turn/started": {
      const { turn } = notification.params;
      return `turn/started turn=${shortId(turn.id, 12)}`;
    }
    case "turn/completed": {
      const { turn } = notification.params;
      const errMsg = turn.error?.message;
      return `turn/completed turn=${shortId(turn.id, 12)} status=${turn.status}${typeof errMsg === "string" ? ` error="${errMsg.slice(0, 120)}"` : ""}`;
    }
    case "item/started":
    case "item/completed": {
      const { item } = notification.params;
      const status = "status" in item ? ` status=${item.status}` : "";
      const cmd = "command" in item ? ` cmd="${item.command.split("\n")[0].slice(0, 80)}"` : "";
      const exit = "exitCode" in item && item.exitCode != null ? ` exit=${item.exitCode}` : "";
      return `${notification.method} type=${item.type} id=${shortId(item.id, 12)}${status}${exit}${cmd}`;
    }
    case "item/agentMessage/delta": {
      const { delta, itemId } = notification.params;
      return `item/agentMessage/delta id=${shortId(itemId, 12)} len=${delta.length}`;
    }
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta": {
      const { delta, itemId } = notification.params;
      return `${notification.method} id=${shortId(itemId, 12)} len=${delta.length}`;
    }
    case "item/commandExecution/outputDelta": {
      const { delta, itemId } = notification.params;
      return `item/commandExecution/outputDelta id=${shortId(itemId, 12)} len=${delta.length}`;
    }
    case "turn/plan/updated": {
      const { plan } = notification.params;
      return `turn/plan/updated steps=${plan.length}`;
    }
    case "thread/tokenUsage/updated": {
      const { tokenUsage } = notification.params;
      return `thread/tokenUsage/updated total=${tokenUsage.total.totalTokens} last_in=${tokenUsage.last.inputTokens} last_out=${tokenUsage.last.outputTokens}`;
    }
    case "error": {
      const { error } = notification.params;
      return `error message="${error.message.slice(0, 180)}"`;
    }
    default:
      return notification.method;
  }
}

/** Wire up all RPC event handlers for a Codex session (shared by start and resume). */
function setupCodexHandlers(
  rpc: CodexRpcClient,
  session: CodexSession,
  internalId: string,
  getMainWindow: () => BrowserWindow | null,
): void {
  rpc.onStderr = (text) => {
    log("codex", `[stderr:${internalId.slice(0, 8)}] ${text.slice(0, 500)}`);
  };

  rpc.onNotification = (msg) => {
    // Cast to the generated discriminated union for typed access
    const notification = msg as CodexServerNotification;
    session.eventCounter++;
    log(
      "codex",
      `[evt:${internalId.slice(0, 8)}] #${session.eventCounter} ${summarizeCodexNotification(notification)}`,
    );
    if (
      (notification.method === "item/started" || notification.method === "item/completed") &&
      shouldLogFullToolEvent(notification.method, notification.params)
    ) {
      log("CODEX_EVENT_FULL", {
        session: internalId.slice(0, 8),
        method: notification.method,
        item: notification.params.item,
      });
    }

    // Track active turn from turn events
    if (notification.method === "turn/started") {
      session.activeTurnId = notification.params.turn.id;
    } else if (notification.method === "turn/completed") {
      session.activeTurnId = null;
    }

    safeSend(getMainWindow, "codex:event", {
      _sessionId: internalId,
      method: notification.method,
      params: notification.params,
    });
  };

  rpc.onServerRequest = (msg) => {
    log(
      "codex",
      `[srvreq:${internalId.slice(0, 8)}] ${msg.method} id=${msg.id}`,
    );
    if (isSupportedServerRequestMethod(msg.method)) {
      safeSend(getMainWindow, "codex:approval_request", {
        _sessionId: internalId,
        rpcId: msg.id,
        method: msg.method,
        // Spread typed params — the renderer narrows by method
        ...(msg.params as Record<string, unknown>),
      });
    } else {
      log("codex", ` Unknown server request: ${msg.method}, auto-declining`);
      rpc.respondToServerError(msg.id, -32601, `Unsupported server request: ${msg.method}`);
    }
  };

  rpc.onExit = (code, signal) => {
    log("codex", ` Process exited: code=${code} signal=${signal} session=${internalId}`);
    codexSessions.delete(internalId);
    safeSend(getMainWindow, "codex:exit", {
      _sessionId: internalId,
      code,
      signal,
    });
  };
}

// ── Registration ──

export function register(getMainWindow: () => BrowserWindow | null): void {
  // Forward renderer-side Codex logs to main process log file.
  ipcMain.on("codex:log", (_event, label: string, data: unknown) => {
    log(`CODEX_UI:${label}`, data);
  });

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
        collaborationMode?: { mode: string; settings: { model: string; reasoning_effort: string | null; developer_instructions: string | null } };
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
        setupCodexHandlers(rpc, session, internalId, getMainWindow);

        // ── Initialize handshake ──
        const initResult = await rpc.request<CodexInitializeResponse>("initialize", {
          clientInfo: getAppServerClientInfo(),
          capabilities: {
            experimentalApi: true,
          },
        });
        rpc.notify("initialized", {});
        log("codex",` Initialized: ${JSON.stringify(initResult).slice(0, 200)}`);

        // ── Check auth status ──
        const authResult = await rpc.request<CodexAccountResponse>("account/read", { refreshToken: false });

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
        let models: CodexModel[] = [];
        let selectedModel: string | undefined;
        try {
          const modelResult = await rpc.request<CodexModelListResponse>("model/list", { includeHidden: false });
          models = modelResult.data ?? [];
          selectedModel = pickModelId(options.model, models);
          if (options.model && selectedModel !== options.model) {
            log("codex", ` Requested model ${options.model} not found; using ${selectedModel ?? "server default"}`);
          }
          if (selectedModel) {
            session.model = selectedModel;
          }
        } catch (err) {
          log("codex",` model/list failed: ${extractErrorMessage(err)}`);
        }

        // ── Start a thread ──
        // ThreadStartParams: experimentalRawEvents and persistExtendedHistory are required booleans
        const threadParams: Record<string, unknown> = {
          cwd: options.cwd,
          experimentalRawEvents: false,
          persistExtendedHistory: false,
        };
        if (selectedModel) threadParams.model = selectedModel;
        if (options.approvalPolicy) threadParams.approvalPolicy = options.approvalPolicy;
        if (options.personality) threadParams.personality = options.personality;
        // collaborationMode is set per-turn via turn/start, not on thread/start

        const threadResult = await rpc.request<CodexThreadStartResponse>("thread/start", threadParams);
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
        log("codex",` Start failed: ${extractErrorMessage(err)}`);
        // Clean up on failure
        const session = codexSessions.get(internalId);
        if (session) {
          session.rpc.destroy();
          codexSessions.delete(internalId);
        }
        return { error: extractErrorMessage(err) };
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
        collaborationMode?: { mode: string; settings: { model: string; reasoning_effort: string | null; developer_instructions: string | null } };
      },
    ) => {
      const session = codexSessions.get(data.sessionId);
      if (!session) {
        log("codex", ` Send rejected: session not found id=${shortId(data.sessionId, 12)}`);
        return { error: "Session not found" };
      }
      if (!session.threadId) {
        log("codex", ` Send rejected: no active thread session=${shortId(data.sessionId, 12)}`);
        return { error: "No active thread" };
      }

      log(
        "codex",
        ` Send requested: session=${shortId(data.sessionId, 12)} thread=${shortId(session.threadId, 12)} text_len=${data.text.length} images=${data.images?.length ?? 0} effort=${data.effort ?? "default"} collab=${data.collaborationMode?.mode ?? "none"} activeTurn=${session.activeTurnId ? shortId(session.activeTurnId, 12) : "none"}`,
      );

      try {
        const input: unknown[] = [{ type: "text", text: data.text }];
        if (data.images) {
          input.push(...data.images);
        }

        // TurnStartParams: only threadId and input are required; all other fields are optional.
        // Only include fields we actually have values for.
        const turnParams: Record<string, unknown> = {
          threadId: session.threadId,
          input,
          ...(session.model ? { model: session.model } : {}),
          ...(data.effort ? { effort: data.effort } : {}),
          ...(data.collaborationMode ? { collaborationMode: data.collaborationMode } : {}),
        };


        const result = await session.rpc.request<CodexTurnStartResponse>("turn/start", turnParams);
        session.activeTurnId = result.turn.id;
        log(
          "codex",
          ` Send accepted: session=${shortId(data.sessionId, 12)} turn=${shortId(result.turn.id, 12)}`,
        );
        return { turnId: result.turn.id };
      } catch (err) {
        log(
          "codex",
          ` Send failed: session=${shortId(data.sessionId, 12)} error=${extractErrorMessage(err)}`,
        );
        return { error: extractErrorMessage(err) };
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
      return { error: extractErrorMessage(err) };
    }
  });

  // ─── codex:approval_response ───
  ipcMain.handle(
    "codex:approval_response",
    async (
      _,
      data: {
        sessionId: string;
        rpcId: string | number;
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

  // ─── codex:user_input_response ───
  ipcMain.handle(
    "codex:user_input_response",
    async (
      _,
      data: {
        sessionId: string;
        rpcId: string | number;
        answers: Record<string, { answers: string[] }>;
      },
    ) => {
      const session = codexSessions.get(data.sessionId);
      if (!session) return;
      session.rpc.respondToServer(data.rpcId, { answers: data.answers });
    },
  );

  // ─── codex:server_request_error ───
  ipcMain.handle(
    "codex:server_request_error",
    async (
      _,
      data: {
        sessionId: string;
        rpcId: string | number;
        code: number;
        message: string;
      },
    ) => {
      const session = codexSessions.get(data.sessionId);
      if (!session) return;
      session.rpc.respondToServerError(data.rpcId, data.code, data.message);
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
      return { error: extractErrorMessage(err) };
    }
  });

  // ─── codex:list-models ───
  ipcMain.handle("codex:list-models", async () => {
    // Try to use any active session's RPC first
    for (const session of codexSessions.values()) {
      if (session.rpc.isAlive) {
        try {
          const result = await session.rpc.request<CodexModelListResponse>("model/list", { includeHidden: false });
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
        await rpc.request<CodexInitializeResponse>("initialize", {
          clientInfo: getAppServerClientInfo(),
          capabilities: { experimentalApi: true },
        });
        rpc.notify("initialized", {});
        const result = await rpc.request<CodexModelListResponse>("model/list", { includeHidden: false });
        return { models: result.data ?? [] };
      } finally {
        rpc.destroy();
      }
    } catch (err) {
      return { models: [], error: extractErrorMessage(err) };
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
        return { error: extractErrorMessage(err) };
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
        approvalPolicy?: string;
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
        setupCodexHandlers(rpc, session, internalId, getMainWindow);

        // Initialize
        await rpc.request<CodexInitializeResponse>("initialize", {
          clientInfo: getAppServerClientInfo(),
          capabilities: { experimentalApi: true },
        });
        rpc.notify("initialized", {});

        // Resume thread — persistExtendedHistory is required by ThreadResumeParams
        const threadParams: Record<string, unknown> = {
          threadId: data.threadId,
          persistExtendedHistory: false,
        };
        if (data.approvalPolicy) threadParams.approvalPolicy = data.approvalPolicy;

        const threadResult = await rpc.request<CodexThreadResumeResponse>("thread/resume", threadParams);
        session.threadId = threadResult.thread.id;
        log("codex",` Thread resumed: ${session.threadId}`);

        return { sessionId: internalId, threadId: session.threadId };
      } catch (err) {
        log("codex",` Resume failed: ${extractErrorMessage(err)}`);
        const session = codexSessions.get(internalId);
        if (session) {
          session.rpc.destroy();
          codexSessions.delete(internalId);
        }
        return { error: extractErrorMessage(err) };
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
      return { error: extractErrorMessage(err) };
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
