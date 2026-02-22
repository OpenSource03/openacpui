import { BrowserWindow, ipcMain } from "electron";
import { spawn, ChildProcess } from "child_process";
import { Readable, Writable } from "stream";
import crypto from "crypto";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import { getAgent } from "../lib/agent-registry";
import { getMcpAuthHeaders } from "../lib/mcp-oauth-flow";

// ACP SDK is ESM-only, must be async-imported
let _acp: typeof import("@agentclientprotocol/sdk") | null = null;
async function getACP() {
  if (!_acp) _acp = await import("@agentclientprotocol/sdk");
  return _acp;
}

interface ACPSessionEntry {
  process: ChildProcess;
  connection: unknown; // ClientSideConnection — typed as unknown to avoid top-level ESM import
  acpSessionId: string;
  internalId: string;
  eventCounter: number;
  pendingPermissions: Map<string, { resolve: (response: unknown) => void }>;
  cwd: string;
  supportsLoadSession: boolean;
  /** True while session/load is in-flight — suppresses history replay notifications from reaching the renderer */
  isReloading: boolean;
}

export const acpSessions = new Map<string, ACPSessionEntry>();

// Buffer latest config options per session — survives the renderer's DRAFT→active transition
// where events arrive before useACP's listener is subscribed
const configBuffer = new Map<string, unknown[]>();

// Track in-flight acp:start so the renderer can abort during npx download / protocol init.
// Only one start can be in-flight at a time (guarded by materializingRef in the renderer).
let pendingStartProcess: { id: string; process: ChildProcess; aborted?: boolean } | null = null;

/** One-line summary for each ACP session update (mirrors summarizeEvent for Claude) */
function summarizeUpdate(update: Record<string, unknown>): string {
  const kind = update.sessionUpdate as string;
  switch (kind) {
    case "agent_message_chunk": {
      const c = update.content as { type?: string; text?: string } | undefined;
      return `agent_message_chunk text_len=${c?.text?.length ?? 0}`;
    }
    case "agent_thought_chunk": {
      const c = update.content as { type?: string; text?: string } | undefined;
      return `agent_thought_chunk text_len=${c?.text?.length ?? 0}`;
    }
    case "user_message_chunk": {
      const c = update.content as { type?: string; text?: string } | undefined;
      return `user_message_chunk text_len=${c?.text?.length ?? 0}`;
    }
    case "tool_call": {
      const tc = update as { toolCallId?: string; title?: string; kind?: string; status?: string };
      return `tool_call id=${tc.toolCallId?.slice(0, 12)} title="${tc.title}" kind=${tc.kind ?? "?"} status=${tc.status}`;
    }
    case "tool_call_update": {
      const tcu = update as { toolCallId?: string; status?: string; rawOutput?: unknown; content?: unknown[] };
      const hasOutput = tcu.rawOutput != null;
      const contentCount = Array.isArray(tcu.content) ? tcu.content.length : 0;
      return `tool_call_update id=${tcu.toolCallId?.slice(0, 12)} status=${tcu.status ?? "?"} hasOutput=${hasOutput} content_items=${contentCount}`;
    }
    case "plan": {
      const p = update as { entries?: unknown[] };
      return `plan entries=${p.entries?.length ?? 0}`;
    }
    case "usage_update": {
      const uu = update as { size?: number; used?: number; cost?: { amount?: number; currency?: string } };
      const parts: string[] = [];
      if (uu.size != null) parts.push(`size=${uu.size}`);
      if (uu.used != null) parts.push(`used=${uu.used}`);
      if (uu.cost) parts.push(`cost=$${uu.cost.amount}`);
      return `usage_update ${parts.join(" ")}`;
    }
    case "session_info_update": {
      const si = update as { title?: string };
      return `session_info_update title="${si.title ?? ""}"`;
    }
    case "current_mode_update": {
      const cm = update as { currentModeId?: string };
      return `current_mode_update mode=${cm.currentModeId}`;
    }
    case "config_option_update": {
      const co = update as { configOptions?: unknown[] };
      return `config_option_update options_count=${co.configOptions?.length ?? 0}`;
    }
    case "available_commands_update": {
      const ac = update as { availableCommands?: unknown[] };
      return `available_commands_update count=${ac.availableCommands?.length ?? 0}`;
    }
    default:
      return `${kind} (unknown)`;
  }
}

export function register(getMainWindow: () => BrowserWindow | null): void {

  // Forward renderer-side ACP logs to main process log file
  ipcMain.on("acp:log", (_event, label: string, data: unknown) => {
    log(`ACP_UI:${label}`, data);
  });

  // ACP SDK throws JSON-RPC error objects ({code, message}), not Error instances —
  // String() on those yields "[object Object]". This helper extracts the message properly.
  function extractErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "object" && err !== null && "message" in err) {
      return String((err as { message: unknown }).message);
    }
    return String(err);
  }

  ipcMain.handle("acp:start", async (_event, options: { agentId: string; cwd: string; mcpServers?: Array<{ name: string; transport: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }> }) => {
    log("ACP_SPAWN", `acp:start called with agentId=${options.agentId} cwd=${options.cwd}`);

    const agentDef = getAgent(options.agentId);
    if (!agentDef || agentDef.engine !== "acp") {
      const err = `Agent "${options.agentId}" not found or not an ACP agent`;
      log("ACP_SPAWN", `ERROR: ${err}`);
      return { error: err };
    }
    if (!agentDef.binary) {
      const err = `Agent "${options.agentId}" has no binary configured`;
      log("ACP_SPAWN", `ERROR: ${err}`);
      return { error: err };
    }

    let proc: ReturnType<typeof spawn> | null = null;
    try {
      log("ACP_SPAWN", `Importing ACP SDK...`);
      const acp = await getACP();
      const internalId = crypto.randomUUID();
      log("ACP_SPAWN", {
        sessionId: internalId,
        agent: agentDef.name,
        binary: agentDef.binary,
        args: agentDef.args ?? [],
        cwd: options.cwd,
      });

      proc = spawn(agentDef.binary, agentDef.args ?? [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...agentDef.env },
      });

      // Track immediately so the renderer can abort during the long protocol init / npx download
      pendingStartProcess = { id: internalId, process: proc };

      proc.on("error", (err) => {
        log("ACP_SPAWN", `ERROR: spawn failed: ${err.message}`);
        // Notify renderer so user isn't stuck with infinite spinner.
        // The "exit" event may not fire for ENOENT errors.
        safeSend(getMainWindow,"acp:exit", {
          _sessionId: internalId,
          code: 1,
          error: `Failed to start agent: ${err.message}`,
        });
        acpSessions.delete(internalId);
        configBuffer.delete(internalId);
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        log("ACP_STDERR", `session=${internalId.slice(0, 8)} ${chunk.toString().trim()}`);
      });

      proc.on("exit", (code) => {
        // Guard: session may already be deleted by the "error" handler (ENOENT race)
        if (!acpSessions.has(internalId)) return;
        const entry = acpSessions.get(internalId)!;
        log("ACP_EXIT", `session=${internalId.slice(0, 8)} code=${code} total_events=${entry.eventCounter}`);
        // Resolve any pending permissions so the SDK doesn't hang
        for (const [, resolver] of entry.pendingPermissions) {
          resolver.resolve({ outcome: { outcome: "cancelled" } });
        }
        entry.pendingPermissions.clear();
        safeSend(getMainWindow,"acp:exit", {
          _sessionId: internalId,
          code,
        });
        acpSessions.delete(internalId);
        configBuffer.delete(internalId);
      });

      log("ACP_SPAWN", `Process spawned pid=${proc.pid}, creating ClientSideConnection...`);
      const input = Writable.toWeb(proc.stdin!) as WritableStream;
      const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
      const stream = acp.ndJsonStream(input, output);

      const pendingPermissions = new Map<string, { resolve: (r: unknown) => void }>();

      const connection = new acp.ClientSideConnection((_agent) => ({
        async sessionUpdate(params: Record<string, unknown>) {
          const update = (params as { update: Record<string, unknown> }).update;
          const entry = acpSessions.get(internalId);
          if (entry) entry.eventCounter++;
          const count = entry?.eventCounter ?? 0;
          const summary = summarizeUpdate(update);
          log("ACP_EVENT", `session=${internalId.slice(0, 8)} #${count} ${entry?.isReloading ? "[suppressed] " : ""}${summary}`);

          // Full dump for tool calls and tool results (like EVENT_FULL for Claude)
          const eventKind = update?.sessionUpdate as string;
          if (eventKind === "tool_call" || eventKind === "tool_call_update") {
            log("ACP_EVENT_FULL", update);
          }

          // Buffer config options so renderer can retrieve them even if events arrive
          // before useACP's listener is subscribed (during DRAFT→active transition)
          if (eventKind === "config_option_update") {
            const configOptions = (update as { configOptions: unknown[] }).configOptions;
            configBuffer.set(internalId, configOptions);
          }

          // During session/load, the agent streams back history as notifications.
          // We suppress these from reaching the renderer since the UI already has
          // the full conversation — forwarding would cause duplicate messages.
          if (entry?.isReloading) return;

          safeSend(getMainWindow,"acp:event", {
            _sessionId: internalId,
            sessionId: (params as { sessionId: string }).sessionId,
            update,
          });
        },

        async requestPermission(params: Record<string, unknown>) {
          return new Promise((resolve) => {
            const requestId = crypto.randomUUID();
            const toolCall = (params as { toolCall: Record<string, unknown> }).toolCall;
            const options = (params as { options: unknown[] }).options;
            pendingPermissions.set(requestId, { resolve });

            log("ACP_PERMISSION_REQUEST", {
              session: internalId.slice(0, 8),
              requestId,
              tool: toolCall?.title,
              kind: toolCall?.kind,
              toolCallId: (toolCall?.toolCallId as string)?.slice(0, 12),
              optionCount: Array.isArray(options) ? options.length : 0,
            });

            safeSend(getMainWindow,"acp:permission_request", {
              _sessionId: internalId,
              requestId,
              sessionId: (params as { sessionId: string }).sessionId,
              toolCall,
              options,
            });
          });
        },

        async readTextFile(params: { uri: string }) {
          log("ACP_FS", `readTextFile uri=${params.uri}`);
          const fs = await import("fs/promises");
          const content = await fs.readFile(params.uri, "utf-8");
          log("ACP_FS", `readTextFile result len=${content.length}`);
          return { content };
        },
        async writeTextFile(params: { uri: string; content: string }) {
          log("ACP_FS", `writeTextFile uri=${params.uri} len=${params.content.length}`);
          const fs = await import("fs/promises");
          await fs.writeFile(params.uri, params.content, "utf-8");
          return {};
        },
      }), stream);

      log("ACP_SPAWN", `Initializing protocol...`);
      const initResult = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
      });
      const caps = (initResult as { agentCapabilities?: { loadSession?: boolean } }).agentCapabilities;
      const supportsLoadSession = caps?.loadSession === true;
      log("ACP_SPAWN", `Initialized protocol v${initResult.protocolVersion} for ${agentDef.name} (loadSession=${supportsLoadSession})`);

      const acpMcpServers = (await Promise.all((options.mcpServers ?? []).map(async (s) => {
        if (s.transport === "stdio") {
          if (!s.command) { log("ACP_MCP_WARN", `Server "${s.name}" (stdio) missing command — skipping`); return null; }
          return {
            name: s.name,
            command: s.command,
            args: s.args ?? [],
            env: s.env ? Object.entries(s.env).map(([name, value]) => ({ name, value })) : [],
          };
        }
        if (!s.url) { log("ACP_MCP_WARN", `Server "${s.name}" (${s.transport}) missing URL — skipping`); return null; }
        const authHeaders = await getMcpAuthHeaders(s.name, s.url);
        const mergedHeaders = { ...s.headers, ...authHeaders };
        return {
          type: s.transport as "http" | "sse",
          name: s.name,
          url: s.url,
          headers: Object.entries(mergedHeaders).map(([name, value]) => ({ name, value })),
        };
      }))).filter(Boolean);

      log("ACP_SPAWN", `Creating new session with ${acpMcpServers.length} MCP server(s)...`);
      const sessionResult = await connection.newSession({
        cwd: options.cwd,
        mcpServers: acpMcpServers,
      });
      log("ACP_SPAWN", `Created session ${sessionResult.sessionId} for ${agentDef.name}`);

      const entry: ACPSessionEntry = {
        process: proc,
        connection,
        acpSessionId: sessionResult.sessionId,
        internalId,
        eventCounter: 0,
        pendingPermissions,
        cwd: options.cwd,
        supportsLoadSession,
        isReloading: false,
      };
      acpSessions.set(internalId, entry);

      // Merge: configOptions from newSession response + any that arrived via events during newSession
      const fromResponse = sessionResult.configOptions ?? [];
      const fromEvents = configBuffer.get(internalId) ?? [];
      let configOptions = fromResponse.length ? fromResponse : fromEvents;

      // Fallback: if no configOptions but models field exists (unstable API), synthesize a model config option
      const models = (sessionResult as Record<string, unknown>).models as { currentModelId?: string; availableModels?: Array<{ modelId: string; name: string; description?: string }> } | null;
      if (configOptions.length === 0 && models?.availableModels?.length) {
        log("ACP_SPAWN", `No configOptions, synthesizing from ${models.availableModels.length} models (unstable API)`);
        configOptions = [{
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: models.currentModelId ?? models.availableModels[0].modelId,
          options: models.availableModels.map(m => ({
            value: m.modelId,
            name: m.name,
            description: m.description ?? null,
          })),
        }];
      }

      if (configOptions.length) configBuffer.set(internalId, configOptions);
      log("ACP_SPAWN", `Session has ${configOptions.length} config options (response=${fromResponse.length}, buffered=${fromEvents.length}, models=${models?.availableModels?.length ?? 0})`);

      // Derive MCP statuses — ACP doesn't report them, so infer from config
      const mcpStatuses = (options.mcpServers ?? []).map(s => ({
        name: s.name,
        status: "connected" as const,
      }));

      // Startup succeeded — clear the pending tracker before returning
      pendingStartProcess = null;

      return {
        sessionId: internalId,
        agentSessionId: sessionResult.sessionId,
        agentName: agentDef.name,
        configOptions,
        mcpStatuses,
      };
    } catch (err) {
      // Check if the user intentionally aborted the start (stop button during download)
      const wasAborted = pendingStartProcess?.aborted === true;
      pendingStartProcess = null;

      // Kill the spawned process to avoid orphans
      try { proc?.kill(); } catch { /* already dead */ }

      if (wasAborted) {
        log("ACP_SPAWN", `Aborted by user`);
        return { cancelled: true };
      }

      const msg = extractErrorMessage(err);
      log("ACP_SPAWN", `ERROR: ${msg}`);
      if (err instanceof Error && err.stack) {
        log("ACP_SPAWN", `Stack: ${err.stack}`);
      }
      return { error: msg };
    }
  });

  // Revive a dead ACP session after app restart.
  // Spawns a fresh agent process and calls session/load (if supported) to restore context,
  // or falls back to newSession (fresh context, UI messages already restored from disk).
  ipcMain.handle("acp:revive-session", async (_event, options: {
    agentId: string;
    cwd: string;
    agentSessionId?: string; // ACP-side session ID from previous run
    mcpServers?: Array<{ name: string; transport: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }>;
  }) => {
    log("ACP_REVIVE", `agentId=${options.agentId} agentSessionId=${options.agentSessionId?.slice(0, 12) ?? "none"} cwd=${options.cwd}`);

    const agentDef = getAgent(options.agentId);
    if (!agentDef || agentDef.engine !== "acp" || !agentDef.binary) {
      return { error: `Agent "${options.agentId}" not found or not an ACP agent` };
    }

    let reviveProc: ReturnType<typeof spawn> | null = null;
    let reviveInternalId: string | null = null;
    try {
      const acp = await getACP();
      const internalId = crypto.randomUUID();
      reviveInternalId = internalId;

      const proc = spawn(agentDef.binary, agentDef.args ?? [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...agentDef.env },
      });
      reviveProc = proc;

      proc.on("error", (err) => {
        log("ACP_REVIVE", `ERROR: spawn failed: ${err.message}`);
        safeSend(getMainWindow,"acp:exit", {
          _sessionId: internalId,
          code: 1,
          error: `Failed to start agent: ${err.message}`,
        });
        acpSessions.delete(internalId);
        configBuffer.delete(internalId);
      });
      proc.stderr?.on("data", (chunk: Buffer) => log("ACP_STDERR", `session=${internalId.slice(0, 8)} ${chunk.toString().trim()}`));
      proc.on("exit", (code) => {
        // Guard: session may already be deleted by the "error" handler (ENOENT race)
        if (!acpSessions.has(internalId)) return;
        const entry = acpSessions.get(internalId)!;
        log("ACP_EXIT", `session=${internalId.slice(0, 8)} code=${code}`);
        for (const [, resolver] of entry.pendingPermissions) {
          resolver.resolve({ outcome: { outcome: "cancelled" } });
        }
        entry.pendingPermissions.clear();
        safeSend(getMainWindow,"acp:exit", { _sessionId: internalId, code });
        acpSessions.delete(internalId);
        configBuffer.delete(internalId);
      });

      const input = Writable.toWeb(proc.stdin!) as WritableStream;
      const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
      const stream = acp.ndJsonStream(input, output);
      const pendingPermissions = new Map<string, { resolve: (r: unknown) => void }>();

      const connection = new acp.ClientSideConnection((_agent) => ({
        async sessionUpdate(params: Record<string, unknown>) {
          const entry = acpSessions.get(internalId);
          if (entry) entry.eventCounter++;
          const update = (params as { update: Record<string, unknown> }).update;
          if (entry?.isReloading) return; // suppress history replay
          safeSend(getMainWindow,"acp:event", {
            _sessionId: internalId,
            sessionId: (params as { sessionId: string }).sessionId,
            update,
          });
        },
        async requestPermission(params: Record<string, unknown>) {
          return new Promise((resolve) => {
            const requestId = crypto.randomUUID();
            const toolCall = (params as { toolCall: Record<string, unknown> }).toolCall;
            const opts = (params as { options: unknown[] }).options;
            pendingPermissions.set(requestId, { resolve });
            safeSend(getMainWindow,"acp:permission_request", {
              _sessionId: internalId, requestId,
              sessionId: (params as { sessionId: string }).sessionId,
              toolCall, options: opts,
            });
          });
        },
        async readTextFile(params: { uri: string }) {
          const fs = await import("fs/promises");
          return { content: await fs.readFile(params.uri, "utf-8") };
        },
        async writeTextFile(params: { uri: string; content: string }) {
          const fs = await import("fs/promises");
          await fs.writeFile(params.uri, params.content, "utf-8");
          return {};
        },
      }), stream);

      const initResult = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });

      const caps = (initResult as { agentCapabilities?: { loadSession?: boolean } }).agentCapabilities;
      const supportsLoadSession = caps?.loadSession === true;
      log("ACP_REVIVE", `initialized (loadSession=${supportsLoadSession})`);

      const acpMcpServers = await Promise.all((options.mcpServers ?? []).map(async (s) => {
        if (s.transport === "stdio") {
          return { name: s.name, command: s.command!, args: s.args ?? [], env: s.env ? Object.entries(s.env).map(([name, value]) => ({ name, value })) : [] };
        }
        const authHeaders = await getMcpAuthHeaders(s.name, s.url!);
        return { type: s.transport as "http" | "sse", name: s.name, url: s.url!, headers: Object.entries({ ...s.headers, ...authHeaders }).map(([name, value]) => ({ name, value })) };
      }));

      let acpSessionId: string;
      let usedLoad = false;
      let configOptions: unknown[] = [];

      type SessionResult = { sessionId?: string; configOptions?: unknown[]; models?: unknown };

      if (supportsLoadSession && options.agentSessionId) {
        // Restore full context — suppress history replay from reaching the renderer
        const conn = connection as { loadSession: (p: unknown) => Promise<SessionResult> };
        const entry: ACPSessionEntry = { process: proc, connection, acpSessionId: options.agentSessionId, internalId, eventCounter: 0, pendingPermissions, cwd: options.cwd, supportsLoadSession, isReloading: true };
        acpSessions.set(internalId, entry);
        const loadResult = await conn.loadSession({ sessionId: options.agentSessionId, cwd: options.cwd, mcpServers: acpMcpServers });
        entry.isReloading = false;
        acpSessionId = options.agentSessionId;
        usedLoad = true;
        configOptions = (loadResult.configOptions ?? configBuffer.get(internalId) ?? []) as unknown[];
        log("ACP_REVIVE", `loadSession OK, session=${acpSessionId.slice(0, 12)} configOptions=${configOptions.length}`);
      } else {
        // Fall back to fresh session — UI messages already restored from disk
        const conn = connection as { newSession: (p: unknown) => Promise<SessionResult> };
        const sessionResult = await conn.newSession({ cwd: options.cwd, mcpServers: acpMcpServers });
        acpSessionId = sessionResult.sessionId!;
        const entry: ACPSessionEntry = { process: proc, connection, acpSessionId, internalId, eventCounter: 0, pendingPermissions, cwd: options.cwd, supportsLoadSession, isReloading: false };
        acpSessions.set(internalId, entry);

        // Build configOptions same way as acp:start (response + events + models fallback)
        const fromResponse = (sessionResult.configOptions ?? []) as unknown[];
        const fromEvents = (configBuffer.get(internalId) ?? []) as unknown[];
        configOptions = fromResponse.length ? fromResponse : fromEvents;
        const models = (sessionResult as Record<string, unknown>).models as { currentModelId?: string; availableModels?: Array<{ modelId: string; name: string; description?: string }> } | null;
        if (configOptions.length === 0 && models?.availableModels?.length) {
          configOptions = [{ id: "model", name: "Model", category: "model", type: "select", currentValue: models.currentModelId ?? models.availableModels[0].modelId, options: models.availableModels.map(m => ({ value: m.modelId, name: m.name, description: m.description ?? null })) }];
        }
        log("ACP_REVIVE", `newSession fallback, session=${acpSessionId.slice(0, 12)} configOptions=${configOptions.length}`);
      }

      if (configOptions.length) configBuffer.set(internalId, configOptions);
      const mcpStatuses = (options.mcpServers ?? []).map(s => ({ name: s.name, status: "connected" as const }));
      return { sessionId: internalId, agentSessionId: acpSessionId, usedLoad, configOptions, mcpStatuses };
    } catch (err) {
      // Kill process and clean up any partial session entry
      try { reviveProc?.kill(); } catch { /* already dead */ }
      if (reviveInternalId) {
        acpSessions.delete(reviveInternalId);
        configBuffer.delete(reviveInternalId);
      }
      const msg = extractErrorMessage(err);
      log("ACP_REVIVE", `ERROR: ${msg}`);
      return { error: msg };
    }
  });

  ipcMain.handle("acp:prompt", async (_event, { sessionId, text, images }: { sessionId: string; text: string; images?: Array<{ data: string; mediaType: string }> }) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_SEND", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }

    log("ACP_SEND", `session=${sessionId.slice(0, 8)} text=${text.slice(0, 500)} images=${images?.length ?? 0}`);

    const prompt: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];
    if (images) {
      for (const img of images) {
        prompt.push({ type: "image", data: img.data, mimeType: img.mediaType });
      }
    }
    prompt.push({ type: "text", text });

    try {
      const conn = session.connection as { prompt: (params: unknown) => Promise<{ stopReason: string; usage?: unknown }> };
      const result = await conn.prompt({
        sessionId: session.acpSessionId,
        prompt,
      });

      log("ACP_TURN_COMPLETE", `session=${sessionId.slice(0, 8)} stopReason=${result.stopReason} usage=${JSON.stringify(result.usage ?? null)}`);

      safeSend(getMainWindow,"acp:turn_complete", {
        _sessionId: sessionId,
        stopReason: result.stopReason,
        usage: result.usage,
      });

      return { ok: true };
    } catch (err) {
      log("ACP_SEND", `ERROR: session=${sessionId.slice(0, 8)} ${String(err)}`);
      return { error: String(err) };
    }
  });

  // Abort an in-flight acp:start (e.g. user clicked stop during npx download).
  // Marks pendingStartProcess as aborted and kills the process — the acp:start
  // catch block will detect `.aborted` and return { cancelled: true }.
  ipcMain.handle("acp:abort-pending-start", async () => {
    if (!pendingStartProcess) {
      log("ACP_ABORT_START", "No pending start to abort");
      return { ok: false };
    }
    log("ACP_ABORT_START", `Aborting start id=${pendingStartProcess.id.slice(0, 8)} pid=${pendingStartProcess.process.pid}`);
    pendingStartProcess.aborted = true;
    try { pendingStartProcess.process.kill(); } catch { /* already dead */ }
    return { ok: true };
  });

  ipcMain.handle("acp:stop", async (_event, sessionId: string) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      // Fallback: check if this is a pending start that hasn't completed yet
      if (pendingStartProcess?.id === sessionId) {
        log("ACP_STOP", `session=${sessionId?.slice(0, 8)} is pending start — aborting`);
        pendingStartProcess.aborted = true;
        try { pendingStartProcess.process.kill(); } catch { /* already dead */ }
        return { ok: true };
      }
      log("ACP_STOP", `session=${sessionId?.slice(0, 8)} already removed`);
      return { ok: true };
    }
    log("ACP_STOP", `session=${sessionId.slice(0, 8)} killing pid=${session.process.pid} total_events=${session.eventCounter}`);
    // Drain pending permissions before killing
    for (const [, resolver] of session.pendingPermissions) {
      resolver.resolve({ outcome: { outcome: "cancelled" } });
    }
    session.pendingPermissions.clear();
    session.process.kill();
    acpSessions.delete(sessionId);
    configBuffer.delete(sessionId);
    return { ok: true };
  });

  // Reload an existing ACP session with a new MCP server list using session/load.
  // This preserves full conversation context on the agent side — no process restart needed.
  // Returns { ok: true, supportsLoad: true } if successful, { supportsLoad: false } if not supported.
  ipcMain.handle("acp:reload-session", async (_event, { sessionId, mcpServers }: {
    sessionId: string;
    mcpServers?: Array<{ name: string; transport: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }>;
  }) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_RELOAD", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }
    if (!session.supportsLoadSession) {
      log("ACP_RELOAD", `session=${sessionId.slice(0, 8)} agent does not support session/load, falling back to restart`);
      return { supportsLoad: false };
    }

    log("ACP_RELOAD", `session=${sessionId.slice(0, 8)} calling loadSession with ${mcpServers?.length ?? 0} MCP server(s)`);

    const acpMcpServers = await Promise.all((mcpServers ?? []).map(async (s) => {
      if (s.transport === "stdio") {
        return {
          name: s.name,
          command: s.command!,
          args: s.args ?? [],
          env: s.env ? Object.entries(s.env).map(([name, value]) => ({ name, value })) : [],
        };
      }
      const authHeaders = await getMcpAuthHeaders(s.name, s.url!);
      const mergedHeaders = { ...s.headers, ...authHeaders };
      return {
        type: s.transport as "http" | "sse",
        name: s.name,
        url: s.url!,
        headers: Object.entries(mergedHeaders).map(([name, value]) => ({ name, value })),
      };
    }));

    try {
      const conn = session.connection as {
        loadSession: (params: unknown) => Promise<{ configOptions?: unknown[]; modes?: unknown; models?: unknown }>;
      };
      // Suppress history replay notifications so the renderer doesn't get duplicates
      session.isReloading = true;
      try {
        await conn.loadSession({
          sessionId: session.acpSessionId,
          cwd: session.cwd,
          mcpServers: acpMcpServers,
        });
      } finally {
        // Always reset — even if loadSession throws or process crashes
        if (acpSessions.has(sessionId)) {
          acpSessions.get(sessionId)!.isReloading = false;
        }
      }
      log("ACP_RELOAD", `session=${sessionId.slice(0, 8)} loadSession OK`);
      return { ok: true, supportsLoad: true };
    } catch (err) {
      const msg = extractErrorMessage(err);
      log("ACP_RELOAD", `ERROR: session=${sessionId.slice(0, 8)} loadSession failed: ${msg}`);
      return { error: msg, supportsLoad: true };
    }
  });

  ipcMain.handle("acp:cancel", async (_event, sessionId: string) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_CANCEL", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }

    const pendingCount = session.pendingPermissions.size;
    log("ACP_CANCEL", `session=${sessionId.slice(0, 8)} cancelling (${pendingCount} pending permissions)`);

    for (const [, resolver] of session.pendingPermissions) {
      resolver.resolve({ outcome: { outcome: "cancelled" } });
    }
    session.pendingPermissions.clear();

    try {
      const conn = session.connection as { cancel: (params: unknown) => Promise<unknown> };
      await conn.cancel({ sessionId: session.acpSessionId });
      log("ACP_CANCEL", `session=${sessionId.slice(0, 8)} acknowledged`);
    } catch (err) {
      log("ACP_CANCEL", `ERROR: session=${sessionId.slice(0, 8)} ${String(err)}`);
    }
    return { ok: true };
  });

  ipcMain.handle("acp:set-config", async (_event, { sessionId, configId, value }: { sessionId: string; configId: string; value: string }) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_CONFIG", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }
    log("ACP_CONFIG", `session=${sessionId.slice(0, 8)} setting ${configId}=${value}`);
    try {
      const conn = session.connection as {
        setSessionConfigOption: (params: unknown) => Promise<{ configOptions: unknown[] }>;
        unstable_setSessionModel?: (params: unknown) => Promise<unknown>;
      };

      // Try the stable config option API first
      try {
        const result = await conn.setSessionConfigOption({
          sessionId: session.acpSessionId,
          configId,
          value,
        });
        log("ACP_CONFIG", `session=${sessionId.slice(0, 8)} ${configId}=${value} OK (via setSessionConfigOption)`);
        if (result.configOptions) configBuffer.set(sessionId, result.configOptions);
        return { configOptions: result.configOptions };
      } catch (configErr) {
        // If it fails and this is the model config, try the unstable setSessionModel API
        if (configId === "model" && conn.unstable_setSessionModel) {
          log("ACP_CONFIG", `session=${sessionId.slice(0, 8)} setSessionConfigOption failed, trying unstable_setSessionModel...`);
          await conn.unstable_setSessionModel({
            sessionId: session.acpSessionId,
            modelId: value,
          });
          log("ACP_CONFIG", `session=${sessionId.slice(0, 8)} model=${value} OK (via unstable_setSessionModel)`);

          // Update the synthesized config option in the buffer
          const buffered = configBuffer.get(sessionId) as Array<{ id: string; currentValue: string }> | undefined;
          if (buffered) {
            const modelOpt = buffered.find(o => o.id === "model");
            if (modelOpt) modelOpt.currentValue = value;
            return { configOptions: buffered };
          }
          return {};
        }
        throw configErr;
      }
    } catch (err) {
      log("ACP_CONFIG", `ERROR: session=${sessionId.slice(0, 8)} ${String(err)}`);
      return { error: String(err) };
    }
  });

  // Retrieve buffered config options — used by renderer when useACP first mounts
  // and may have missed config_option_update events during DRAFT→active transition
  ipcMain.handle("acp:get-config-options", async (_event, sessionId: string) => {
    return { configOptions: configBuffer.get(sessionId) ?? [] };
  });

  ipcMain.handle("acp:permission_response", async (_event, { sessionId, requestId, optionId }: { sessionId: string; requestId: string; optionId: string }) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_PERMISSION_RESPONSE", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }

    const resolver = session.pendingPermissions.get(requestId);
    if (!resolver) {
      log("ACP_PERMISSION_RESPONSE", `ERROR: session=${sessionId.slice(0, 8)} no pending permission for requestId=${requestId}`);
      return { error: "No pending permission" };
    }

    log("ACP_PERMISSION_RESPONSE", `session=${sessionId.slice(0, 8)} requestId=${requestId} optionId=${optionId}`);
    resolver.resolve({ outcome: { outcome: "selected", optionId } });
    session.pendingPermissions.delete(requestId);
    return { ok: true };
  });
}
