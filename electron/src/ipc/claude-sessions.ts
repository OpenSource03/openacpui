import { BrowserWindow, ipcMain } from "electron";
import crypto from "crypto";
import os from "os";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import { AsyncChannel } from "../lib/async-channel";
import { getSDK, getCliPath, clientAppEnv } from "../lib/sdk";
import type { QueryHandle } from "../lib/sdk";
import { getMcpAuthHeaders } from "../lib/mcp-oauth-flow";
import { getClaudeModelsCache, setClaudeModelsCache } from "../lib/claude-model-cache";
import { extractErrorMessage } from "../lib/error-utils";

/** SDK options for file checkpointing — enables Write/Edit/NotebookEdit revert support */
function fileCheckpointOptions(): Record<string, unknown> {
  return {
    enableFileCheckpointing: true,
    extraArgs: { "replay-user-messages": null }, // required to receive checkpoint UUIDs
    env: { ...process.env, ...clientAppEnv(), CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1" },
  };
}

type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
}

interface SessionEntry {
  channel: AsyncChannel<unknown>;
  queryHandle: QueryHandle | null;
  eventCounter: number;
  pendingPermissions: Map<string, PendingPermission>;
  startOptions?: StartOptions;
  /** When true, the old event loop should NOT send claude:exit on teardown */
  restarting?: boolean;
  /** When true, a stop was requested — suppress expected SDK teardown errors */
  stopping?: boolean;
  /** Why the stop was requested (user action, cleanup, etc.). */
  stopReason?: string;
}

export const sessions = new Map<string, SessionEntry>();

function summarizeEvent(event: Record<string, unknown>): string {
  switch (event.type) {
    case "system": {
      if (event.subtype === "init") {
        return `system/init session=${(event.session_id as string)?.slice(0, 8)} model=${event.model}`;
      }
      if (event.subtype === "task_started") {
        return `system/task_started task=${(event.task_id as string)?.slice(0, 8)} tool_use=${(event.tool_use_id as string)?.slice(0, 12)} desc="${event.description}"`;
      }
      if (event.subtype === "task_progress") {
        const usage = event.usage as { total_tokens: number; tool_uses: number; duration_ms: number } | undefined;
        return `system/task_progress task=${(event.task_id as string)?.slice(0, 8)} tokens=${usage?.total_tokens} tools=${usage?.tool_uses} ${usage?.duration_ms}ms last=${event.last_tool_name ?? "-"}`;
      }
      if (event.subtype === "task_notification") {
        const usage = event.usage as { total_tokens: number; tool_uses: number; duration_ms: number } | undefined;
        return `system/task_notification task=${(event.task_id as string)?.slice(0, 8)} status=${event.status} tokens=${usage?.total_tokens} ${usage?.duration_ms}ms`;
      }
      return `system/${event.subtype}`;
    }
    case "stream_event": {
      const e = event.event as Record<string, unknown>;
      switch (e.type) {
        case "message_start":
          return `stream/message_start msg_id=${((e.message as Record<string, unknown>)?.id as string)?.slice(0, 12)}`;
        case "content_block_start": {
          const b = e.content_block as Record<string, unknown>;
          if (b.type === "tool_use") return `stream/block_start idx=${e.index} tool_use name=${b.name} id=${(b.id as string)?.slice(0, 12)}`;
          return `stream/block_start idx=${e.index} type=${b.type}`;
        }
        case "content_block_delta": {
          const d = e.delta as Record<string, unknown>;
          if (d.type === "text_delta") return `stream/block_delta idx=${e.index} text_delta len=${(d.text as string)?.length}`;
          if (d.type === "input_json_delta") return `stream/block_delta idx=${e.index} json_delta len=${(d.partial_json as string)?.length}`;
          if (d.type === "thinking_delta") return `stream/block_delta idx=${e.index} thinking_delta len=${(d.thinking as string)?.length}`;
          return `stream/block_delta idx=${e.index} type=${d.type}`;
        }
        case "content_block_stop":
          return `stream/block_stop idx=${e.index}`;
        case "message_delta":
          return `stream/message_delta stop_reason=${(e.delta as Record<string, unknown>)?.stop_reason}`;
        case "message_stop":
          return "stream/message_stop";
        default:
          return `stream/${e.type}`;
      }
    }
    case "assistant": {
      const blocks = ((event.message as Record<string, unknown>)?.content as Array<Record<string, unknown>>) || [];
      const types = blocks.map((b) => {
        if (b.type === "tool_use") return `tool_use(${b.name}, id=${(b.id as string)?.slice(0, 12)})`;
        if (b.type === "text") return `text(len=${(b.text as string)?.length})`;
        return b.type;
      });
      return `assistant uuid=${(event.uuid as string)?.slice(0, 12)} blocks=[${types.join(", ")}]`;
    }
    case "user": {
      const content = (event.message as Record<string, unknown>)?.content;
      if (typeof content === "string") {
        return `user text(len=${content.length})`;
      }
      const items = ((content as Array<Record<string, unknown>>) || []).map((c) => {
        if (c.type === "tool_result") return `tool_result(tool_use_id=${(c.tool_use_id as string)?.slice(0, 12)})`;
        return (c.type as string) || "unknown";
      });
      const result = event.tool_use_result as Record<string, unknown> | undefined;
      let resultInfo = "";
      if (result) {
        if (result.isAsync) resultInfo = ` async agentId=${result.agentId} status=${result.status}`;
        else if (result.file) resultInfo = ` file=${(result.file as Record<string, unknown>).filePath}`;
        else if (result.stdout !== undefined) resultInfo = ` bash stdout_len=${(result.stdout as string)?.length} stderr_len=${(result.stderr as string)?.length || 0}`;
        else if (result.filePath) resultInfo = ` edit=${result.filePath}`;
        else resultInfo = ` result_keys=[${Object.keys(result).join(",")}]`;
      }
      return `user items=[${items.join(", ")}]${resultInfo}`;
    }
    case "result":
      return `result/${event.subtype} cost=$${event.total_cost_usd} turns=${event.num_turns} duration=${event.duration_ms}ms`;
    default:
      return `${event.type} (unknown)`;
  }
}

/**
 * Shared event forwarding loop for Claude SDK sessions.
 * Iterates the query handle's async generator, logs events, and forwards them
 * to the renderer. On exit, sends claude:exit unless the session is restarting.
 */
function startEventLoop(
  sessionId: string,
  queryHandle: QueryHandle,
  session: SessionEntry,
  getMainWindow: () => BrowserWindow | null,
): void {
  const logPrefix = `session=${sessionId.slice(0, 8)}`;
  let queryError: string | undefined;
  (async () => {
    try {
      for await (const message of queryHandle) {
        session.eventCounter++;
        const summary = summarizeEvent(message as Record<string, unknown>);
        log("EVENT", `${logPrefix} #${session.eventCounter} ${summary}`);
        const msgObj = message as Record<string, unknown>;
        if (msgObj.type === "assistant" || msgObj.type === "user" || msgObj.type === "result") {
          log("EVENT_FULL", message);
        }
        safeSend(getMainWindow, "claude:event", { ...(message as object), _sessionId: sessionId });
      }
    } catch (err) {
      queryError = extractErrorMessage(err);
      log("QUERY_ERROR", `${logPrefix} stopping=${!!session.stopping} reason=${session.stopReason ?? "none"} ${queryError}`);
    } finally {
      if (!session.restarting) {
        // Requested stop: treat teardown errors as clean exit
        const stopRequested = session.stopping;
        const exitCode = (queryError && !stopRequested) ? 1 : 0;
        log("EXIT", `${logPrefix} total_events=${session.eventCounter} stopRequested=${!!stopRequested} stopReason=${session.stopReason ?? "none"} error=${queryError ?? "none"}`);
        sessions.delete(sessionId);
        safeSend(getMainWindow, "claude:exit", {
          code: exitCode, _sessionId: sessionId,
          ...((queryError && !stopRequested) ? { error: queryError } : {}),
        });
      } else {
        log("EXIT_RESTART", `${logPrefix} old loop ended (restarting)`);
      }
    }
  })().catch((err) => log("EVENT_LOOP_FATAL", extractErrorMessage(err)));
}

function parseStopRequest(
  payload: string | { sessionId: string; reason?: string },
): { sessionId: string; reason: string } {
  if (typeof payload === "string") {
    return { sessionId: payload, reason: "user" };
  }
  return {
    sessionId: payload.sessionId,
    reason: typeof payload.reason === "string" && payload.reason.length > 0
      ? payload.reason
      : "user",
  };
}

interface McpServerInput {
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface StartOptions {
  cwd?: string;
  model?: string;
  permissionMode?: string;
  thinkingEnabled?: boolean;
  resume?: string;
  /** Fork to a new session ID when resuming (model forgets messages after resumeSessionAt) */
  forkSession?: boolean;
  /** Resume at a specific message UUID — used with forkSession to truncate history */
  resumeSessionAt?: string;
  mcpServers?: McpServerInput[];
}

function buildThinkingConfig(thinkingEnabled?: boolean): { type: "adaptive" } | { type: "disabled" } {
  return thinkingEnabled === false
    ? { type: "disabled" }
    : { type: "adaptive" };
}

let modelsRevalidationPromise: Promise<{ models: Array<Record<string, unknown>>; updatedAt?: number; error?: string }> | null = null;

async function revalidateClaudeModelsCache(cwd?: string): Promise<{ models: Array<Record<string, unknown>>; updatedAt?: number; error?: string }> {
  if (modelsRevalidationPromise) return modelsRevalidationPromise;

  modelsRevalidationPromise = (async () => {
    const existing = getClaudeModelsCache();
    let queryHandle: QueryHandle | null = null;
    const channel = new AsyncChannel<unknown>();

    try {
      const query = await getSDK();
      const queryOptions: Record<string, unknown> = {
        cwd: cwd?.trim() || os.homedir(),
        includePartialMessages: true,
        thinking: buildThinkingConfig(true),
        settingSources: ["user", "project"],
        pathToClaudeCodeExecutable: getCliPath(),
        ...fileCheckpointOptions(),
      };

      queryHandle = query({ prompt: channel, options: queryOptions });
      if (!queryHandle.supportedModels) {
        return { models: existing.models, updatedAt: existing.updatedAt };
      }

      const models = await queryHandle.supportedModels();
      if (Array.isArray(models) && models.length > 0) {
        const next = setClaudeModelsCache(models);
        return { models: next.models, updatedAt: next.updatedAt };
      }

      return { models: existing.models, updatedAt: existing.updatedAt };
    } catch (err) {
      const message = extractErrorMessage(err);
      log("MODELS_CACHE_REVALIDATE_ERR", message);
      return { models: existing.models, updatedAt: existing.updatedAt, error: message };
    } finally {
      channel.close();
      if (queryHandle) {
        try {
          queryHandle.close();
        } catch {
          // Ignore cleanup errors
        }
      }
      modelsRevalidationPromise = null;
    }
  })();

  return modelsRevalidationPromise;
}

// ── Build SDK-compatible MCP config from server inputs (with fresh auth headers) ──

async function buildSdkMcpConfig(servers: McpServerInput[]): Promise<Record<string, unknown>> {
  const sdkMcp: Record<string, unknown> = {};
  for (const s of servers) {
    if (s.transport === "stdio") {
      sdkMcp[s.name] = { command: s.command, args: s.args, env: s.env };
    } else if (s.url) {
      const authHeaders = await getMcpAuthHeaders(s.name, s.url);
      const mergedHeaders = { ...s.headers, ...authHeaders };
      sdkMcp[s.name] = {
        type: s.transport,
        url: s.url,
        headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
      };
    } else {
      log("MCP_CONFIG_WARN", `Server "${s.name}" has transport "${s.transport}" but no URL — skipping`);
    }
  }
  return sdkMcp;
}

// ── Restart a running session with fresh config (resume = same conversation) ──

async function restartSession(
  sessionId: string,
  getMainWindow: () => BrowserWindow | null,
  mcpServersOverride?: McpServerInput[],
): Promise<{ ok?: boolean; error?: string; restarted?: boolean }> {
  const session = sessions.get(sessionId);
  if (!session?.queryHandle || !session.startOptions) {
    return { error: "No active session to restart" };
  }

  const logPrefix = `session=${sessionId.slice(0, 8)}`;
  log("SESSION_RESTART", `${logPrefix} (rebuilding with fresh MCP config)`);

  // Mark old session so its event loop doesn't send claude:exit
  session.restarting = true;
  session.channel.close();
  session.queryHandle.close();

  // Deny all pending permissions
  for (const [reqId, pending] of session.pendingPermissions) {
    pending.resolve({ behavior: "deny", message: "Session restarting" });
    session.pendingPermissions.delete(reqId);
  }

  const opts = session.startOptions;
  const mcpServers = mcpServersOverride ?? opts.mcpServers;
  const query = await getSDK();
  const newChannel = new AsyncChannel<unknown>();

  const newSession: SessionEntry = {
    channel: newChannel,
    queryHandle: null,
    eventCounter: session.eventCounter,
    pendingPermissions: new Map(),
    startOptions: { ...opts, mcpServers },
  };

  const canUseTool = (toolName: string, input: unknown, context: { toolUseID: string; suggestions: unknown; decisionReason: string }) => {
    return new Promise<PermissionResult>((resolve) => {
      const requestId = crypto.randomUUID();
      newSession.pendingPermissions.set(requestId, { resolve });
      safeSend(getMainWindow,"claude:permission_request", {
        _sessionId: sessionId,
        requestId,
        toolName,
        toolInput: input,
        toolUseId: context.toolUseID,
        suggestions: context.suggestions,
        decisionReason: context.decisionReason,
      });
    });
  };

  const queryOptions: Record<string, unknown> = {
    cwd: opts.cwd || process.cwd(),
    includePartialMessages: true,
    thinking: buildThinkingConfig(opts.thinkingEnabled),
    canUseTool,
    settingSources: ["user", "project"],
    pathToClaudeCodeExecutable: getCliPath(),
    ...fileCheckpointOptions(),
    resume: sessionId,
    stderr: (data: string) => {
      const trimmed = data.trim();
      log("STDERR", `${logPrefix} ${trimmed}`);
      safeSend(getMainWindow,"claude:stderr", { data, _sessionId: sessionId });
    },
  };

  if (opts.permissionMode) {
    queryOptions.permissionMode = opts.permissionMode;
    if (opts.permissionMode === "bypassPermissions") {
      queryOptions.allowDangerouslySkipPermissions = true;
    }
  }
  if (opts.model) queryOptions.model = opts.model;

  if (mcpServers?.length) {
    queryOptions.mcpServers = await buildSdkMcpConfig(mcpServers);
  }

  log("SESSION_RESTART_SPAWN", { sessionId, options: { ...queryOptions, canUseTool: "[callback]", stderr: "[callback]" } });

  let q;
  try {
    q = query({ prompt: newChannel, options: queryOptions });
    newSession.queryHandle = q;
    sessions.set(sessionId, newSession);
  } catch (err) {
    // Restart failed — clean up and notify renderer
    sessions.delete(sessionId);
    safeSend(getMainWindow,"claude:exit", {
      code: 1, _sessionId: sessionId, error: extractErrorMessage(err),
    });
    return { error: `Restart failed: ${extractErrorMessage(err)}` };
  }

  startEventLoop(sessionId, q, newSession, getMainWindow);

  return { ok: true, restarted: true };
}

// ── IPC Registration ──

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("claude:start", async (_event, options: StartOptions = {}) => {
    // Fork sessions get a fresh IPC-level ID to avoid race with old session's
    // async cleanup (which would delete the new Map entry if we reused the old key).
    const sessionId = (options.resume && options.forkSession)
      ? crypto.randomUUID()
      : (options.resume || crypto.randomUUID());

    try {
      const query = await getSDK();

      const channel = new AsyncChannel<unknown>();
      const session: SessionEntry = {
        channel,
        queryHandle: null,
        eventCounter: 0,
        pendingPermissions: new Map(),
        startOptions: options,
      };
      sessions.set(sessionId, session);

      const canUseTool = (toolName: string, input: unknown, context: { toolUseID: string; suggestions: unknown; decisionReason: string }) => {
        return new Promise<PermissionResult>((resolve) => {
          const requestId = crypto.randomUUID();
          session.pendingPermissions.set(requestId, { resolve });
          log("PERMISSION_REQUEST", {
            session: sessionId.slice(0, 8),
            tool: toolName,
            requestId,
            toolUseId: context.toolUseID,
            reason: context.decisionReason,
          });
          safeSend(getMainWindow,"claude:permission_request", {
            _sessionId: sessionId,
            requestId,
            toolName,
            toolInput: input,
            toolUseId: context.toolUseID,
            suggestions: context.suggestions,
            decisionReason: context.decisionReason,
          });
        });
      };

      const queryOptions: Record<string, unknown> = {
        cwd: options.cwd || process.cwd(),
        includePartialMessages: true,
        thinking: buildThinkingConfig(options.thinkingEnabled),
        canUseTool,
        settingSources: ["user", "project"],
        pathToClaudeCodeExecutable: getCliPath(),
        ...fileCheckpointOptions(),
        stderr: (data: string) => {
          const trimmed = data.trim();
          log("STDERR", `session=${sessionId.slice(0, 8)} ${trimmed}`);
          safeSend(getMainWindow,"claude:stderr", { data, _sessionId: sessionId });
        },
      };

      if (options.resume) {
        queryOptions.resume = options.resume;
        if (options.forkSession) {
          queryOptions.forkSession = true;
          // Use our IPC-level ID as the fork's session ID so future resume works
          queryOptions.sessionId = sessionId;
        }
        if (options.resumeSessionAt) queryOptions.resumeSessionAt = options.resumeSessionAt;
      } else {
        queryOptions.sessionId = sessionId;
      }

      if (options.permissionMode) {
        queryOptions.permissionMode = options.permissionMode;
      }
      if (options.permissionMode === "bypassPermissions") {
        queryOptions.allowDangerouslySkipPermissions = true;
      }
      if (options.model) {
        queryOptions.model = options.model;
      }

      if (options.mcpServers?.length) {
        queryOptions.mcpServers = await buildSdkMcpConfig(options.mcpServers);
      }

      log("SPAWN", { sessionId, resume: options.resume || null, options: { ...queryOptions, canUseTool: "[callback]", stderr: "[callback]" } });

      const q = query({ prompt: channel, options: queryOptions });
      session.queryHandle = q;

      startEventLoop(sessionId, q, session, getMainWindow);

      return { sessionId, pid: 0 };
    } catch (err) {
      // getSDK() or query() threw — clean up and return error
      sessions.delete(sessionId);
      const errMsg = extractErrorMessage(err);
      log("START_ERROR", `session=${sessionId.slice(0, 8)} ${errMsg}`);
      safeSend(getMainWindow,"claude:exit", {
        code: 1, _sessionId: sessionId, error: errMsg,
      });
      return { sessionId, pid: 0, error: errMsg };
    }
  });

  ipcMain.handle("claude:send", (_event, { sessionId, message }: { sessionId: string; message: { message: { content: unknown } } }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      log("SEND", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Claude session not found" };
    }
    log("SEND", `session=${sessionId.slice(0, 8)} content=${JSON.stringify(message).slice(0, 500)}`);
    session.channel.push({
      type: "user",
      message: { role: "user", content: message.message.content },
      parent_tool_use_id: null,
      session_id: sessionId,
    });
    return { ok: true };
  });

  ipcMain.handle("claude:permission_response", async (_event, {
    sessionId, requestId, behavior, toolInput, newPermissionMode,
  }: {
    sessionId: string;
    requestId: string;
    behavior: string;
    toolUseId: string;
    toolInput: Record<string, unknown> | undefined;
    newPermissionMode?: string;
  }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      log("PERMISSION_RESPONSE", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Claude session not found" };
    }
    const pending = session.pendingPermissions.get(requestId);
    if (!pending) {
      log("PERMISSION_RESPONSE", `ERROR: no pending permission for requestId=${requestId}`);
      return { error: "No pending permission request" };
    }
    session.pendingPermissions.delete(requestId);
    log("PERMISSION_RESPONSE", `session=${sessionId.slice(0, 8)} behavior=${behavior} requestId=${requestId} newMode=${newPermissionMode ?? "none"}`);

    if (newPermissionMode && session.queryHandle) {
      try {
        await session.queryHandle.setPermissionMode(newPermissionMode);
        log("PERMISSION_MODE_CHANGED", `session=${sessionId.slice(0, 8)} mode=${newPermissionMode}`);
      } catch (err) {
        log("PERMISSION_MODE_ERR", `session=${sessionId.slice(0, 8)} ${extractErrorMessage(err)}`);
      }
    }

    if (behavior === "allow") {
      pending.resolve({ behavior: "allow", updatedInput: toolInput });
    } else {
      // Pass user-provided rejection reason (from plan feedback) to the SDK so the model can adjust
      const denyMsg = toolInput?.denyMessage;
      pending.resolve({
        behavior: "deny",
        message: typeof denyMsg === "string" && denyMsg.trim() ? denyMsg.trim() : "User denied permission",
      });
    }
    return { ok: true };
  });

  ipcMain.handle("claude:set-permission-mode", async (_event, { sessionId, permissionMode }: { sessionId: string; permissionMode: string }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      log("SET_PERM_MODE", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Claude session not found" };
    }
    if (!session.queryHandle) {
      return { error: "No active query handle" };
    }
    try {
      await session.queryHandle.setPermissionMode(permissionMode);
      log("SET_PERM_MODE", `session=${sessionId.slice(0, 8)} mode=${permissionMode}`);
      return { ok: true };
    } catch (err) {
      log("SET_PERM_MODE_ERR", `session=${sessionId.slice(0, 8)} ${extractErrorMessage(err)}`);
      return { error: extractErrorMessage(err) };
    }
  });

  ipcMain.handle("claude:set-model", async (_event, { sessionId, model }: { sessionId: string; model: string }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      log("SET_MODEL", "ERROR: session " + sessionId.slice(0, 8) + " not found");
      return { error: "Claude session not found" };
    }
    if (!session.queryHandle?.setModel) {
      log("SET_MODEL", "ERROR: session=" + sessionId.slice(0, 8) + " setModel unsupported");
      return { error: "Model switching is not supported by this Claude SDK version" };
    }
    try {
      await session.queryHandle.setModel(model);
      if (session.startOptions) {
        session.startOptions.model = model;
      }
      log("SET_MODEL", "session=" + sessionId.slice(0, 8) + " model=" + model);
      return { ok: true };
    } catch (err) {
      log("SET_MODEL_ERR", "session=" + sessionId.slice(0, 8) + " model=" + model + " " + extractErrorMessage(err));
      return { error: extractErrorMessage(err) };
    }
  });

  ipcMain.handle("claude:set-thinking", async (_event, { sessionId, thinkingEnabled }: { sessionId: string; thinkingEnabled: boolean }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      log("SET_THINKING", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Claude session not found" };
    }
    if (!session.queryHandle?.setMaxThinkingTokens) {
      log("SET_THINKING", `ERROR: session=${sessionId.slice(0, 8)} setMaxThinkingTokens unsupported`);
      return { error: "Reasoning toggle is not supported by this Claude SDK version" };
    }
    try {
      await session.queryHandle.setMaxThinkingTokens(thinkingEnabled ? null : 0);
      if (session.startOptions) {
        session.startOptions.thinkingEnabled = thinkingEnabled;
      }
      log("SET_THINKING", `session=${sessionId.slice(0, 8)} thinkingEnabled=${thinkingEnabled}`);
      return { ok: true };
    } catch (err) {
      log("SET_THINKING_ERR", `session=${sessionId.slice(0, 8)} thinkingEnabled=${thinkingEnabled} ${extractErrorMessage(err)}`);
      return { error: extractErrorMessage(err) };
    }
  });

  ipcMain.on("claude:log", (_event, label: string, data: unknown) => {
    log(`UI:${label}`, data);
  });

  ipcMain.handle(
    "claude:stop",
    (_event, payload: string | { sessionId: string; reason?: string }) => {
      const { sessionId, reason } = parseStopRequest(payload);
      const session = sessions.get(sessionId);
      if (session) {
        // Mark as requested stop so teardown errors are suppressed
        session.stopping = true;
        session.stopReason = reason;
        // Drain pending permissions before closing
        for (const [, pending] of session.pendingPermissions) {
          pending.resolve({ behavior: "deny", message: "Session stopped" });
        }
        session.pendingPermissions.clear();
        session.channel.close();
        session.queryHandle?.close();
        // Let the event loop's finally block handle sessions.delete + claude:exit
      }
      return { ok: true };
    },
  );

  ipcMain.handle("claude:interrupt", async (_event, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      log("INTERRUPT", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }

    log("INTERRUPT", `session=${sessionId.slice(0, 8)}`);

    for (const [requestId, pending] of session.pendingPermissions) {
      pending.resolve({ behavior: "deny", message: "Interrupted by user" });
      session.pendingPermissions.delete(requestId);
    }

    try {
      await session.queryHandle!.interrupt();
      log("INTERRUPT", `session=${sessionId.slice(0, 8)} acknowledged`);
    } catch (err) {
      log("INTERRUPT_ERR", `session=${sessionId.slice(0, 8)} ${extractErrorMessage(err)}`);
      return { error: extractErrorMessage(err) };
    }

    return { ok: true };
  });

  ipcMain.handle("claude:revert-files", async (_event, { sessionId, checkpointId }: { sessionId: string; checkpointId: string }) => {
    const session = sessions.get(sessionId);
    if (!session?.queryHandle?.rewindFiles) {
      return { error: "No active session or rewind not supported" };
    }
    try {
      await session.queryHandle.rewindFiles(checkpointId);
      log("REVERT_FILES", `session=${sessionId.slice(0, 8)} checkpoint=${checkpointId.slice(0, 12)}`);
      return { ok: true };
    } catch (err) {
      log("REVERT_FILES_ERR", `session=${sessionId.slice(0, 8)} ${extractErrorMessage(err)}`);
      return { error: extractErrorMessage(err) };
    }
  });

  ipcMain.handle("claude:mcp-status", async (_event, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session?.queryHandle?.mcpServerStatus) return { servers: [] };
    try {
      const servers = await session.queryHandle.mcpServerStatus();
      return { servers };
    } catch (err) {
      log("MCP_STATUS_ERR", `session=${sessionId.slice(0, 8)} ${extractErrorMessage(err)}`);
      return { servers: [], error: extractErrorMessage(err) };
    }
  });

  ipcMain.handle("claude:supported-models", async (_event, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session?.queryHandle?.supportedModels) return { models: [] };
    try {
      const models = await session.queryHandle.supportedModels();
      if (Array.isArray(models) && models.length > 0) {
        setClaudeModelsCache(models);
      }
      return { models };
    } catch (err) {
      log("SUPPORTED_MODELS_ERR", `session=${sessionId.slice(0, 8)} ${extractErrorMessage(err)}`);
      return { models: [], error: extractErrorMessage(err) };
    }
  });

  ipcMain.handle("claude:models-cache:get", async () => {
    const cached = getClaudeModelsCache();
    return { models: cached.models, updatedAt: cached.updatedAt };
  });

  ipcMain.handle("claude:models-cache:revalidate", async (_event, options?: { cwd?: string }) => {
    return revalidateClaudeModelsCache(options?.cwd);
  });

  ipcMain.handle("claude:mcp-reconnect", async (_event, { sessionId, serverName }: { sessionId: string; serverName: string }) => {
    const session = sessions.get(sessionId);
    if (!session?.queryHandle) return { error: "No active session" };

    // Check if we have stored OAuth tokens for this server.
    // If yes, we need to restart the entire session because the SDK was started
    // without auth headers — reconnectMcpServer() can't inject new headers.
    const mcpServer = session.startOptions?.mcpServers?.find((s) => s.name === serverName);
    const hasNewToken = mcpServer?.url ? !!(await getMcpAuthHeaders(mcpServer.name, mcpServer.url)) : false;

    if (hasNewToken) {
      return restartSession(sessionId, getMainWindow);
    }

    // No new token — try regular reconnect
    if (!session.queryHandle.reconnectMcpServer) return { error: "Not supported" };
    try {
      await session.queryHandle.reconnectMcpServer(serverName);
      log("MCP_RECONNECT", `session=${sessionId.slice(0, 8)} server=${serverName}`);
      return { ok: true };
    } catch (err) {
      log("MCP_RECONNECT_ERR", `session=${sessionId.slice(0, 8)} server=${serverName} ${extractErrorMessage(err)}`);
      return { error: extractErrorMessage(err) };
    }
  });

  // Restart the session with a new MCP server list (e.g., after add/remove)
  ipcMain.handle("claude:restart-session", async (_event, { sessionId, mcpServers }: { sessionId: string; mcpServers?: McpServerInput[] }) => {
    return restartSession(sessionId, getMainWindow, mcpServers);
  });
}
