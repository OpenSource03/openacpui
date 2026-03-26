import { BrowserWindow, ipcMain } from "electron";
import { spawn, ChildProcess } from "child_process";
import { Readable, Writable } from "stream";
import crypto from "crypto";
import path from "path";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import { getAgent } from "../lib/agent-registry";
import type { InstalledAgent } from "../lib/agent-registry";
import { getMcpAuthHeaders } from "../lib/mcp-oauth-flow";
import { extractErrorMessage, reportError } from "../lib/error-utils";
import { captureEvent } from "../lib/posthog";

// ACP SDK is ESM-only, must be async-imported
import type { ClientSideConnection } from "@agentclientprotocol/sdk";
let _acp: typeof import("@agentclientprotocol/sdk") | null = null;
async function getACP() {
  if (!_acp) _acp = await import("@agentclientprotocol/sdk");
  return _acp;
}

import { resolveACPFilePath, applyReadRange } from "@shared/lib/acp-helpers";
import type { ACPTextFileParams } from "@shared/lib/acp-helpers";

type ACPReadTextFileParams = ACPTextFileParams & { content?: string; line?: number | null; limit?: number | null };
type ACPWriteTextFileParams = ACPTextFileParams & { content: string };

async function acpReadTextFile(params: ACPReadTextFileParams): Promise<{ content: string; filePath: string }> {
  const filePath = resolveACPFilePath(params);
  const fs = await import("fs/promises");
  const content = await fs.readFile(filePath, "utf-8");
  return { filePath, content: applyReadRange(content, params.line, params.limit) };
}

async function acpWriteTextFile(params: ACPWriteTextFileParams): Promise<{ filePath: string }> {
  const filePath = resolveACPFilePath(params);
  const fs = await import("fs/promises");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, params.content, "utf-8");
  return { filePath };
}

// Advertise only capabilities that are fully implemented here.
// Intentionally omit `terminal` and any custom `_meta` flags (e.g. terminal_output)
// so ACP agents use their protocol fallbacks instead of unsupported client RPC paths.
const ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
} as const;

interface ACPSessionEntry {
  process: ChildProcess;
  connection: ClientSideConnection;
  acpSessionId: string;
  internalId: string;
  analyticsProperties: AcpAnalyticsProperties;
  eventCounter: number;
  pendingPermissions: Map<string, { resolve: (response: unknown) => void }>;
  cwd: string;
  supportsLoadSession: boolean;
  /** True while session/load is in-flight — suppresses history replay notifications from reaching the renderer */
  isReloading: boolean;
  /** ACP-side session IDs for ephemeral utility prompts (title gen, commit msg) */
  utilitySessionIds?: Set<string>;
  /** Text accumulator buffers for utility sessions, keyed by ACP sessionId */
  utilityTextBuffers?: Map<string, string>;
  /** Last actionable stderr error line observed from the ACP agent process */
  lastStderrError?: string;
  /** True after we've already attempted to auto-switch mode to agent */
  modeAutoSwitched?: boolean;
  /**
   * Called by sessionUpdate on every event while an acp:prompt is in-flight.
   * The acp:prompt handler installs this to reset an inactivity timer — if
   * Gemini streams events then silently stops without sending the turn-end
   * JSON-RPC response, the timer fires and unblocks the renderer.
   */
  promptInactivityReset?: () => void;
  /**
   * Number of successfully completed prompt turns in this session.
   * Gemini CLI v0.35.1 only processes the first session/prompt call — on
   * subsequent calls it's silently ignored. We use this to trigger an
   * auto-respawn (kill + loadSession) before each turn after the first.
   */
  completedTurns: number;
  /** agentId used to spawn this session — needed for auto-respawn */
  agentId: string;
  /** MCP servers configured for this session — needed for auto-respawn */
  mcpServers: McpServerInput[];
}

export const acpSessions = new Map<string, ACPSessionEntry>();

// Buffer latest config options per session — survives the renderer's DRAFT→active transition
// where events arrive before useACP's listener is subscribed
const configBuffer = new Map<string, unknown[]>();

// Buffer latest available commands per session — same lifecycle as configBuffer
const commandsBuffer = new Map<string, unknown[]>();

// Track in-flight acp:start so the renderer can abort during npx download / protocol init.
// Only one start can be in-flight at a time (guarded by materializingRef in the renderer).
let pendingStartProcess: { id: string; process: ChildProcess; aborted?: boolean } | null = null;

type AcpAnalyticsProperties = {
  acp_agent: string;
  acp_agent_source: "registry" | "custom";
  acp_agent_launch_method: "npx" | "binary" | "unknown";
  acp_agent_registry_id?: string;
  acp_agent_registry_version?: string;
};

function buildAcpAnalyticsProperties(agent: InstalledAgent): AcpAnalyticsProperties {
  const registryId = agent.registryId?.trim();
  const launchMethod = agent.binary === "npx" ? "npx" : agent.binary ? "binary" : "unknown";

  if (registryId) {
    return {
      acp_agent: registryId,
      acp_agent_source: "registry",
      acp_agent_launch_method: launchMethod,
      acp_agent_registry_id: registryId,
      ...(agent.registryVersion ? { acp_agent_registry_version: agent.registryVersion } : {}),
    };
  }

  const customHash = crypto.createHash("sha256").update(agent.id).digest("hex").slice(0, 12);
  return {
    acp_agent: `custom:${customHash}`,
    acp_agent_source: "custom",
    acp_agent_launch_method: launchMethod,
  };
}

export function getAcpAnalyticsPropertiesForSession(sessionId: string): Record<string, unknown> | null {
  return acpSessions.get(sessionId)?.analyticsProperties ?? null;
}

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

type McpServerInput = { name: string; transport: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };

/** Convert renderer MCP server configs to ACP SDK format (with fresh auth headers). */
async function buildAcpMcpServers(servers: McpServerInput[]): Promise<unknown[]> {
  return (await Promise.all(servers.map(async (s) => {
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
}

/** Merge configOptions from session response, event buffer, and unstable models API. */
function resolveConfigOptions(
  sessionResult: { configOptions?: unknown[]; models?: unknown },
  internalId: string,
  logLabel: string,
): unknown[] {
  const fromResponse = (sessionResult.configOptions ?? []) as unknown[];
  const fromEvents = (configBuffer.get(internalId) ?? []) as unknown[];
  let configOptions = fromResponse.length ? fromResponse : fromEvents;

  // Fallback: synthesize config option from unstable models API
  const models = (sessionResult as Record<string, unknown>).models as { currentModelId?: string; availableModels?: Array<{ modelId: string; name: string; description?: string }> } | null;
  if (configOptions.length === 0 && models?.availableModels?.length) {
    log(logLabel, `No configOptions, synthesizing from ${models.availableModels.length} models (unstable API)`);
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
  log(logLabel, `${configOptions.length} config options (response=${fromResponse.length}, buffered=${fromEvents.length}, models=${models?.availableModels?.length ?? 0})`);
  return configOptions;
}

interface AcpConnectionResult {
  proc: ChildProcess;
  connection: ClientSideConnection;
  pendingPermissions: Map<string, { resolve: (r: unknown) => void }>;
  internalId: string;
  supportsLoadSession: boolean;
}

/**
 * Spawn an ACP agent process, create the ClientSideConnection, and initialize the protocol.
 * Shared by acp:start and acp:revive-session to avoid duplicating ~120 lines of boilerplate.
 */
async function createAcpConnection(
  agentDef: { binary: string; args?: string[]; env?: Record<string, string>; name: string },
  getMainWindow: () => BrowserWindow | null,
  logLabel: string,
  /** Reuse an existing session ID (for transparent respawn — preserves renderer subscriptions). */
  overrideInternalId?: string,
): Promise<AcpConnectionResult> {
  const acp = await getACP();
  const internalId = overrideInternalId ?? crypto.randomUUID();

  // For npx-based agents: prefer the local npm cache to avoid re-downloading on
  // every startup. Falls back to network only if not cached.
  const isNpx = agentDef.binary === "npx";
  const spawnEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...agentDef.env,
    ...(isNpx ? { NPM_CONFIG_PREFER_OFFLINE: "true" } : {}),
  };

  const proc = spawn(agentDef.binary, agentDef.args ?? [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: spawnEnv,
    shell: process.platform === "win32",
  });

  // Process lifecycle handlers
  proc.on("error", (err) => {
    log(logLabel, `ERROR: spawn failed: ${err.message}`);
    safeSend(getMainWindow, "acp:exit", {
      _sessionId: internalId,
      code: 1,
      error: `Failed to start agent: ${err.message}`,
    });
    acpSessions.delete(internalId);
    configBuffer.delete(internalId);
    commandsBuffer.delete(internalId);
  });

  // Accumulate multi-line stderr messages before parsing
  let stderrBuffer = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    // Process complete lines
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const raw = line.trim();
      if (!raw) continue;
      log("ACP_STDERR", `session=${internalId.slice(0, 8)} ${raw}`);
      const cleaned = raw.replace(/\x1b\[[0-9;]*m/g, "");

      // Detect actionable errors: explicit error patterns and auth failures
      const turnError = cleaned.match(/Unhandled error during turn:\s*(.+)$/)?.[1]?.trim();
      const authError = /auth|login|credential|api[\s_-]?key|unauthorized|403|permission denied/i.test(cleaned) ? cleaned : undefined;
      const parsed = turnError ?? authError ?? (/\bERROR\b/i.test(cleaned) ? cleaned : undefined);
      if (!parsed) continue;
      const entry = acpSessions.get(internalId);
      if (entry) entry.lastStderrError = parsed;
    }
  });

  proc.on("exit", (code) => {
    // Guard: session may already be deleted by the "error" handler (ENOENT race)
    if (!acpSessions.has(internalId)) return;
    const entry = acpSessions.get(internalId)!;
    log("ACP_EXIT", `session=${internalId.slice(0, 8)} code=${code} total_events=${entry.eventCounter}`);
    for (const [, resolver] of entry.pendingPermissions) {
      resolver.resolve({ outcome: { outcome: "cancelled" } });
    }
    entry.pendingPermissions.clear();
    safeSend(getMainWindow, "acp:exit", { _sessionId: internalId, code });
    acpSessions.delete(internalId);
    configBuffer.delete(internalId);
    commandsBuffer.delete(internalId);
  });

  // Stream + connection setup
  const input = Writable.toWeb(proc.stdin!) as WritableStream;
  const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(input, output);
  const pendingPermissions = new Map<string, { resolve: (r: unknown) => void }>();

  const connection = new acp.ClientSideConnection((_agent) => ({
    async sessionUpdate(params: Record<string, unknown>) {
      const update = (params as { update: Record<string, unknown> }).update;
      const acpSessionId = (params as { sessionId: string }).sessionId;
      const entry = acpSessions.get(internalId);

      // Utility session events: accumulate text, skip renderer forwarding
      if (entry?.utilitySessionIds?.has(acpSessionId)) {
        const eventKind = (update as { sessionUpdate: string }).sessionUpdate;
        if (eventKind === "agent_message_chunk") {
          const text = (update as { content?: { text?: string } }).content?.text ?? "";
          if (text && entry.utilityTextBuffers) {
            const current = entry.utilityTextBuffers.get(acpSessionId) ?? "";
            entry.utilityTextBuffers.set(acpSessionId, current + text);
          }
        }
        return;
      }

      if (entry) entry.eventCounter++;
      const count = entry?.eventCounter ?? 0;
      const summary = summarizeUpdate(update);
      log("ACP_EVENT", `session=${internalId.slice(0, 8)} #${count} ${entry?.isReloading ? "[suppressed] " : ""}${summary}`);

      // Notify an in-flight acp:prompt that the agent is still active.
      // This resets the streaming inactivity timer — prevents false timeouts
      // on long-running tool chains while preventing infinite hangs when
      // Gemini stops sending events without completing the turn.
      if (entry) entry.promptInactivityReset?.();

      // Full dump for tool calls and tool results
      const eventKind = update?.sessionUpdate as string;
      if (eventKind === "tool_call" || eventKind === "tool_call_update") {
        log("ACP_EVENT_FULL", update);
      }

      // Buffer config options for late-subscribing renderer listeners
      if (eventKind === "config_option_update") {
        const configOptions = (update as { configOptions: unknown[] }).configOptions;
        configBuffer.set(internalId, configOptions);

        // Auto-switch to Agent mode the first time a "mode" config option arrives
        // in "ask" state. The mode option is sent via event (not in newSession response),
        // so we must handle it here instead of in acp:start.
        //
        // IMPORTANT: we do NOT forward the original "ask" config_option_update to the
        // renderer here. We wait for setSessionConfigOption() to complete and then
        // forward the updated config (with "agent" as currentValue) in the .then().
        // This prevents a race condition where the renderer's onEvent listener hasn't
        // registered yet and the "ask" value gets stuck in the UI.
        if (entry && !entry.modeAutoSwitched) {
          const modeOpt = (configOptions as Array<{ id: string; category?: string; currentValue: string; options?: unknown[] }>)
            .find((o) => o.category === "mode");
          if (modeOpt && /ask/i.test(modeOpt.currentValue)) {
            entry.modeAutoSwitched = true;
            const flatOptions = (modeOpt.options ?? []) as Array<{ value: string; name?: string; options?: Array<{ value: string; name?: string }> }>;
            const allOptions: Array<{ value: string; name?: string }> = [];
            for (const o of flatOptions) {
              if (Array.isArray(o.options)) allOptions.push(...o.options);
              else allOptions.push(o);
            }
            const agentOpt = allOptions.find((o) => /agent/i.test(o.value) || /agent/i.test(o.name ?? ""));
            if (agentOpt) {
              log("ACP_MODE", `session=${internalId.slice(0, 8)} auto-switching mode "${modeOpt.currentValue}" → "${agentOpt.value}"`);
              void entry.connection.setSessionConfigOption({
                sessionId: entry.acpSessionId,
                configId: modeOpt.id,
                value: agentOpt.value,
              }).then((r) => {
                const updatedOptions = r.configOptions ?? configOptions;
                configBuffer.set(internalId, updatedOptions);
                log("ACP_MODE", `session=${internalId.slice(0, 8)} mode switch OK, forwarding updated config`);
                // Forward the UPDATED config (mode=agent) — not the original "ask" version.
                // By the time this .then() fires, useACP's onEvent listener should be registered.
                safeSend(getMainWindow, "acp:event", {
                  _sessionId: internalId,
                  sessionId: entry.acpSessionId,
                  update: { sessionUpdate: "config_option_update", configOptions: updatedOptions },
                });
              }).catch((err) => {
                log("ACP_MODE", `session=${internalId.slice(0, 8)} mode switch failed — forwarding original config: ${(err as Error).message}`);
                // Switch failed: still forward the original config so the UI has something
                safeSend(getMainWindow, "acp:event", {
                  _sessionId: internalId,
                  sessionId: entry.acpSessionId,
                  update: { sessionUpdate: "config_option_update", configOptions },
                });
              });
              // Do NOT fall through to the generic safeSend below — return early.
              // The renderer will receive the config once the switch resolves.
              if (entry?.isReloading) return;
              return;
            }
          }
        }
      }

      // current_mode_update: Gemini CLI sends this after setSessionMode() completes.
      // Forward it to the renderer so the mode dropdown updates.
      if (eventKind === "current_mode_update") {
        const currentModeId = (update as { currentModeId?: string }).currentModeId;
        log("ACP_MODE", `session=${internalId.slice(0, 8)} current_mode_update modeId=${currentModeId}`);
      }

      // Buffer available commands for late-subscribing renderer listeners
      if (eventKind === "available_commands_update") {
        const commands = (update as { availableCommands: unknown[] }).availableCommands;
        commandsBuffer.set(internalId, commands);
      }

      // During session/load, suppress history replay from reaching the renderer
      if (entry?.isReloading) return;

      safeSend(getMainWindow, "acp:event", {
        _sessionId: internalId,
        sessionId: acpSessionId,
        update,
      });
    },

    async requestPermission(params: Record<string, unknown>) {
      const acpSessionId = (params as { sessionId: string }).sessionId;
      const entry = acpSessions.get(internalId);

      // Auto-deny permission requests for utility sessions
      if (entry?.utilitySessionIds?.has(acpSessionId)) {
        log("ACP_UTILITY", `Auto-denying permission for utility session ${acpSessionId.slice(0, 12)}`);
        const options = (params as { options: Array<{ optionId: string; kind: string }> }).options;
        const rejectOption = options.find(o => o.kind === "reject_once") ?? options[options.length - 1];
        return { outcome: { outcome: "selected", optionId: rejectOption?.optionId ?? "reject" } };
      }

      return new Promise((resolve) => {
        const requestId = crypto.randomUUID();
        const toolCall = (params as { toolCall: Record<string, unknown> }).toolCall;
        const opts = (params as { options: unknown[] }).options;
        pendingPermissions.set(requestId, { resolve });

        log("ACP_PERMISSION_REQUEST", {
          session: internalId.slice(0, 8),
          requestId,
          tool: toolCall?.title,
          kind: toolCall?.kind,
          toolCallId: (toolCall?.toolCallId as string)?.slice(0, 12),
          optionCount: Array.isArray(opts) ? opts.length : 0,
        });

        safeSend(getMainWindow, "acp:permission_request", {
          _sessionId: internalId,
          requestId,
          sessionId: acpSessionId,
          toolCall,
          options: opts,
        });
      });
    },

    async readTextFile(params: { path?: string; uri?: string; line?: number | null; limit?: number | null }) {
      try {
        const { filePath, content } = await acpReadTextFile(params);
        log("ACP_FS", `readTextFile path=${filePath} line=${params.line ?? ""} limit=${params.limit ?? ""}`);
        log("ACP_FS", `readTextFile result len=${content.length}`);
        return { content };
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        log("ACP_FS", `readTextFile ERROR: ${msg}`);
        // Return error as content so the agent can handle it gracefully instead of hanging
        return { content: `[Error reading file: ${msg}]` };
      }
    },
    async writeTextFile(params: { path?: string; uri?: string; content: string }) {
      try {
        const { filePath } = await acpWriteTextFile(params);
        log("ACP_FS", `writeTextFile path=${filePath} len=${params.content.length}`);
        return {};
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        log("ACP_FS", `writeTextFile ERROR: ${msg}`);
        throw new Error(`Failed to write file: ${msg}`);
      }
    },
  }), stream);

  // Protocol initialization
  log(logLabel, `Initializing protocol...`);
  const initResult = await connection.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: ACP_CLIENT_CAPABILITIES,
  });
  const supportsLoadSession = initResult.agentCapabilities?.loadSession === true;
  log(logLabel, `Initialized protocol v${initResult.protocolVersion} for ${agentDef.name} (loadSession=${supportsLoadSession})`);

  return { proc, connection, pendingPermissions, internalId, supportsLoadSession };
}

/**
 * Auto-switch an ACP session from "ask" → "agent" mode using the dedicated
 * `session/set_mode` RPC (used by Gemini CLI and other agents that expose
 * modes via the `modes` field in the newSession/loadSession response).
 *
 * This is called right after newSession() returns. The session entry must
 * already be in `acpSessions` before calling this.
 */
async function autoSwitchToAgentMode(
  entry: ACPSessionEntry,
  sessionResult: { sessionId: string; modes?: { currentModeId?: string; availableModes?: Array<{ id: string; name: string }> } | null },
  internalId: string,
  getMainWindow: () => BrowserWindow | null,
): Promise<void> {
  if (entry.modeAutoSwitched) return;
  const modes = sessionResult.modes;
  if (!modes?.currentModeId || !modes.availableModes?.length) return;
  if (!/ask/i.test(modes.currentModeId)) return;

  const agentMode = modes.availableModes.find(
    (m) => /agent/i.test(m.id) || /agent/i.test(m.name),
  );
  if (!agentMode) {
    log("ACP_MODE", `session=${internalId.slice(0, 8)} no agent mode found in availableModes: ${JSON.stringify(modes.availableModes)}`);
    return;
  }

  entry.modeAutoSwitched = true;
  log("ACP_MODE", `session=${internalId.slice(0, 8)} auto-switching mode "${modes.currentModeId}" → "${agentMode.id}" (via setSessionMode)`);
  try {
    await entry.connection.setSessionMode({
      sessionId: entry.acpSessionId,
      modeId: agentMode.id,
    });
    log("ACP_MODE", `session=${internalId.slice(0, 8)} setSessionMode OK`);
    // The agent will emit current_mode_update which the sessionUpdate handler
    // will forward to the renderer, updating the mode dropdown there.
  } catch (err) {
    log("ACP_MODE", `session=${internalId.slice(0, 8)} setSessionMode failed (non-fatal): ${(err as Error).message}`);
    entry.modeAutoSwitched = false; // allow retry on next event
  }
}

export function register(getMainWindow: () => BrowserWindow | null): void {

  // Forward renderer-side ACP logs to main process log file
  ipcMain.on("acp:log", (_event, label: string, data: unknown) => {
    log(`ACP_UI:${label}`, data);
  });

  ipcMain.handle("acp:start", async (_event, options: { agentId: string; cwd: string; mcpServers?: McpServerInput[] }) => {
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

    let connResult: AcpConnectionResult | null = null;
    const analyticsProperties = buildAcpAnalyticsProperties(agentDef);
    try {
      connResult = await createAcpConnection(agentDef as { binary: string; args?: string[]; env?: Record<string, string>; name: string }, getMainWindow, "ACP_SPAWN");
      const { proc, connection, pendingPermissions, internalId, supportsLoadSession } = connResult;

      // Track immediately so the renderer can abort during the long protocol init / npx download
      pendingStartProcess = { id: internalId, process: proc };

      const acpMcpServers = await buildAcpMcpServers(options.mcpServers ?? []);

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
        analyticsProperties,
        eventCounter: 0,
        pendingPermissions,
        cwd: options.cwd,
        supportsLoadSession,
        isReloading: false,
        completedTurns: 0,
        agentId: options.agentId,
        mcpServers: options.mcpServers ?? [],
      };
      acpSessions.set(internalId, entry);

      const configOptions = resolveConfigOptions(sessionResult, internalId, "ACP_SPAWN");

      // Auto-switch from Ask → Agent mode using the dedicated `modes` API.
      // Gemini CLI v0.35.1 does NOT send config_option_update events — it exposes
      // modes via the `modes` field in the newSession response and the
      // `session/set_mode` RPC. The event-based handler is kept as a fallback
      // for other ACP agents that do use config_option_update.
      // Await mode switch (with timeout) so the connection isn't blocked when
      // the first prompt is sent — Gemini CLI serializes JSON-RPC calls, so a
      // pending setSessionMode would delay the prompt response beyond the
      // inactivity timeout.
      try {
        await Promise.race([
          autoSwitchToAgentMode(entry, sessionResult, internalId, getMainWindow),
          new Promise((resolve) => setTimeout(resolve, 10_000)),
        ]);
      } catch {
        log("ACP_SPAWN", `autoSwitchToAgentMode timed out or failed (non-fatal)`);
      }

      // Derive MCP statuses — ACP doesn't report them, so infer from config
      const mcpStatuses = (options.mcpServers ?? []).map(s => ({
        name: s.name,
        status: "connected" as const,
      }));

      // Startup succeeded — clear the pending tracker before returning
      pendingStartProcess = null;

      void captureEvent("session_created", { engine: "acp", ...analyticsProperties });

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
      try { connResult?.proc?.kill(); } catch { /* already dead */ }

      if (wasAborted) {
        log("ACP_SPAWN", `Aborted by user`);
        return { cancelled: true };
      }

      const msg = reportError("ACP_SPAWN", err, { engine: "acp", ...analyticsProperties });
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
    mcpServers?: McpServerInput[];
  }) => {
    log("ACP_REVIVE", `agentId=${options.agentId} agentSessionId=${options.agentSessionId?.slice(0, 12) ?? "none"} cwd=${options.cwd}`);

    const agentDef = getAgent(options.agentId);
    if (!agentDef || agentDef.engine !== "acp" || !agentDef.binary) {
      return { error: `Agent "${options.agentId}" not found or not an ACP agent` };
    }

    let connResult: AcpConnectionResult | null = null;
    const analyticsProperties = buildAcpAnalyticsProperties(agentDef);
    try {
      connResult = await createAcpConnection(agentDef as { binary: string; args?: string[]; env?: Record<string, string>; name: string }, getMainWindow, "ACP_REVIVE");
      const { proc, connection, pendingPermissions, internalId, supportsLoadSession } = connResult;

      const acpMcpServers = await buildAcpMcpServers(options.mcpServers ?? []);

      let acpSessionId: string;
      let usedLoad = false;
      let configOptions: unknown[] = [];

      if (supportsLoadSession && options.agentSessionId) {
        // Restore full context — suppress history replay from reaching the renderer
        const entry: ACPSessionEntry = { process: proc, connection, acpSessionId: options.agentSessionId!, internalId, analyticsProperties, eventCounter: 0, pendingPermissions, cwd: options.cwd, supportsLoadSession, isReloading: true, completedTurns: 0, agentId: options.agentId, mcpServers: options.mcpServers ?? [] };
        acpSessions.set(internalId, entry);
        const loadResult = await connection.loadSession({ sessionId: options.agentSessionId, cwd: options.cwd, mcpServers: acpMcpServers });
        entry.isReloading = false;
        acpSessionId = options.agentSessionId;
        usedLoad = true;
        configOptions = (loadResult.configOptions ?? configBuffer.get(internalId) ?? []) as unknown[];
        if (configOptions.length) configBuffer.set(internalId, configOptions);
        log("ACP_REVIVE", `loadSession OK, session=${acpSessionId.slice(0, 12)} configOptions=${configOptions.length}`);
      } else {
        // Fall back to fresh session — UI messages already restored from disk
        const sessionResult = await connection.newSession({ cwd: options.cwd, mcpServers: acpMcpServers });
        acpSessionId = sessionResult.sessionId;
        const entry: ACPSessionEntry = { process: proc, connection, acpSessionId, internalId, analyticsProperties, eventCounter: 0, pendingPermissions, cwd: options.cwd, supportsLoadSession, isReloading: false, completedTurns: 0, agentId: options.agentId, mcpServers: options.mcpServers ?? [] };
        acpSessions.set(internalId, entry);
        configOptions = resolveConfigOptions(sessionResult, internalId, "ACP_REVIVE");
        try {
          await Promise.race([
            autoSwitchToAgentMode(entry, sessionResult, internalId, getMainWindow),
            new Promise((resolve) => setTimeout(resolve, 10_000)),
          ]);
        } catch {
          log("ACP_REVIVE", `autoSwitchToAgentMode timed out or failed (non-fatal)`);
        }
        log("ACP_REVIVE", `newSession fallback, session=${acpSessionId.slice(0, 12)}`);
      }

      const mcpStatuses = (options.mcpServers ?? []).map(s => ({ name: s.name, status: "connected" as const }));
      void captureEvent("session_revived", { engine: "acp", success: true, ...analyticsProperties });
      return { sessionId: internalId, agentSessionId: acpSessionId, usedLoad, configOptions, mcpStatuses };
    } catch (err) {
      // Kill process and clean up any partial session entry
      try { connResult?.proc?.kill(); } catch { /* already dead */ }
      if (connResult?.internalId) {
        acpSessions.delete(connResult.internalId);
        configBuffer.delete(connResult.internalId);
      }
      const msg = reportError("ACP_REVIVE", err, { engine: "acp", ...analyticsProperties });
      return { error: msg };
    }
  });

  ipcMain.handle("acp:prompt", async (_event, { sessionId, text, images }: { sessionId: string; text: string; images?: Array<{ data: string; mediaType: string }> }) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_SEND", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }

    log("ACP_SEND", `session=${sessionId.slice(0, 8)} text=${text.slice(0, 500)} images=${images?.length ?? 0} completedTurns=${session.completedTurns}`);

    // Auto-respawn: Gemini CLI v0.35.1 only processes the FIRST session/prompt
    // call per process — subsequent calls are silently ignored. To support
    // multi-turn, we kill the old process, spawn a new one using the SAME
    // internalId (passed as overrideInternalId so all event closures use the
    // correct ID), then call loadSession to restore the conversation context.
    if (session.completedTurns > 0 && session.supportsLoadSession) {
      log("ACP_RESPAWN", `session=${sessionId.slice(0, 8)} respawning for turn ${session.completedTurns + 1}`);
      const prevAcpSessionId = session.acpSessionId;
      const agentDef = getAgent(session.agentId);
      if (agentDef?.engine === "acp" && agentDef.binary) {
        try {
          // Remove stale entry so the old process's exit handler fires silently
          acpSessions.delete(sessionId);
          try { session.process.kill(); } catch { /* already dead */ }

          // Spawn fresh process reusing the same internalId so all event
          // closures inside createAcpConnection route to the correct sessionId
          const connResult = await createAcpConnection(
            agentDef as { binary: string; args?: string[]; env?: Record<string, string>; name: string },
            getMainWindow,
            "ACP_RESPAWN",
            sessionId, // ← overrideInternalId: events from new process use old sessionId
          );
          const acpMcpServers = await buildAcpMcpServers(session.mcpServers);
          const loadResult = await connResult.connection.loadSession({
            sessionId: prevAcpSessionId,
            cwd: session.cwd,
            mcpServers: acpMcpServers,
          });
          // Re-register the updated entry
          session.process = connResult.proc;
          session.connection = connResult.connection;
          session.acpSessionId = prevAcpSessionId;
          session.supportsLoadSession = connResult.supportsLoadSession;
          session.pendingPermissions = connResult.pendingPermissions;
          session.eventCounter = 0;
          session.isReloading = false;
          session.lastStderrError = undefined;
          acpSessions.set(sessionId, session);
          if (loadResult.configOptions) configBuffer.set(sessionId, loadResult.configOptions as unknown[]);
          log("ACP_RESPAWN", `session=${sessionId.slice(0, 8)} respawn OK, acpSessionId=${prevAcpSessionId.slice(0, 12)}`);
        } catch (err) {
          // Respawn failed — re-register whatever we have so the session isn't orphaned
          acpSessions.set(sessionId, session);
          log("ACP_RESPAWN", `session=${sessionId.slice(0, 8)} respawn failed (continuing with current connection): ${(err as Error).message}`);
        }
      }
    }

    const prompt: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];
    if (images) {
      for (const img of images) {
        prompt.push({ type: "image", data: img.data, mimeType: img.mediaType });
      }
    }
    prompt.push({ type: "text", text });

    // Hard timeout — absolute last-resort guard (2 min)
    const PROMPT_TIMEOUT_MS = 2 * 60 * 1000;
    // Inactivity timeout — fires when streaming events stop but the turn never completes.
    // This is the main failure mode for Gemini CLI: it streams "Planning next moves" events
    // then silently stops without sending the session/prompt JSON-RPC response.
    // First turn: Gemini CLI can take 60-120s to respond while loading skills,
    // MCP servers, and completing the mode switch.  Subsequent turns are faster.
    const INACTIVITY_TIMEOUT_MS = session.completedTurns === 0 ? 120_000 : 45_000;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let inactivityHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      session.lastStderrError = undefined;

      const promptPromise = session.connection.prompt({
        sessionId: session.acpSessionId,
        prompt,
      });

      // Race against the stream closing (process exit) so we fail immediately
      // instead of waiting for the timeout. The ACP SDK doesn't reject pending
      // requests when the underlying stream closes, so we do it ourselves here.
      const closedPromise: Promise<never> = session.connection.closed.then(() => {
        return Promise.reject(new Error("Agent process exited before completing the turn"));
      });

      // Inactivity promise: rejects if no sessionUpdate event arrives for INACTIVITY_TIMEOUT_MS.
      // Every sessionUpdate from the agent resets this timer (via session.promptInactivityReset).
      const inactivityPromise = new Promise<never>((_, reject) => {
        const reset = () => {
          if (inactivityHandle !== null) clearTimeout(inactivityHandle);
          inactivityHandle = setTimeout(
            () => reject(new Error(`Agent stopped responding (${INACTIVITY_TIMEOUT_MS / 1000}s inactivity)`)),
            INACTIVITY_TIMEOUT_MS,
          );
        };
        session.promptInactivityReset = reset;
        reset(); // arm the initial timer
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error("Agent response timed out (2 min)")),
          PROMPT_TIMEOUT_MS,
        );
      });

      const result = await Promise.race([promptPromise, closedPromise, inactivityPromise, timeoutPromise]);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      if (inactivityHandle !== null) clearTimeout(inactivityHandle);
      session.promptInactivityReset = undefined;
      session.completedTurns++;

      log("ACP_TURN_COMPLETE", `session=${sessionId.slice(0, 8)} stopReason=${result.stopReason} completedTurns=${session.completedTurns} usage=${JSON.stringify(result.usage ?? null)}`);

      safeSend(getMainWindow,"acp:turn_complete", {
        _sessionId: sessionId,
        stopReason: result.stopReason,
        usage: result.usage,
      });

      return { ok: true };
    } catch (err) {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      if (inactivityHandle !== null) clearTimeout(inactivityHandle);
      session.promptInactivityReset = undefined;
      const msg = extractErrorMessage(err);
      // Prefer stderr context over generic "Internal error" — it usually contains
      // the real cause (auth failures, API errors, etc.)
      const surfacedError = session.lastStderrError ?? (msg === "Internal error" ? "Agent error — check that you are authenticated (run: gemini auth)" : msg);
      reportError("ACP_PROMPT_ERR", err, { engine: "acp", sessionId, surfacedError });
      // Ensure the renderer knows the turn ended on error
      safeSend(getMainWindow, "acp:turn_complete", {
        _sessionId: sessionId,
        stopReason: "error",
        usage: null,
      });
      return { error: surfacedError };
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
    commandsBuffer.delete(sessionId);
    return { ok: true };
  });

  // Reload an existing ACP session with a new MCP server list using session/load.
  // This preserves full conversation context on the agent side — no process restart needed.
  // Returns { ok: true, supportsLoad: true } if successful, { supportsLoad: false } if not supported.
  ipcMain.handle("acp:reload-session", async (_event, { sessionId, mcpServers, cwd }: {
    sessionId: string;
    mcpServers?: McpServerInput[];
    cwd?: string;
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

    const nextCwd = cwd ?? session.cwd;
    log("ACP_RELOAD", `session=${sessionId.slice(0, 8)} calling loadSession with ${mcpServers?.length ?? 0} MCP server(s) cwd=${nextCwd}`);

    const acpMcpServers = await buildAcpMcpServers(mcpServers ?? []);

    try {
      // Suppress history replay notifications so the renderer doesn't get duplicates
      session.isReloading = true;
      try {
        await session.connection.loadSession({
          sessionId: session.acpSessionId,
          cwd: nextCwd,
          mcpServers: acpMcpServers,
        });
      } finally {
        // Always reset — even if loadSession throws or process crashes
        if (acpSessions.has(sessionId)) {
          acpSessions.get(sessionId)!.isReloading = false;
        }
      }
      session.cwd = nextCwd;
      log("ACP_RELOAD", `session=${sessionId.slice(0, 8)} loadSession OK`);
      return { ok: true, supportsLoad: true };
    } catch (err) {
      const msg = reportError("ACP_RELOAD_ERR", err, { engine: "acp", sessionId });
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
      await session.connection.cancel({ sessionId: session.acpSessionId });
      log("ACP_CANCEL", `session=${sessionId.slice(0, 8)} acknowledged`);
      return { ok: true };
    } catch (err) {
      const msg = reportError("ACP_CANCEL_ERR", err, { engine: "acp", sessionId });
      return { error: msg };
    }
  });

  ipcMain.handle("acp:set-config", async (_event, { sessionId, configId, value }: { sessionId: string; configId: string; value: string }) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_CONFIG", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }
    log("ACP_CONFIG", `session=${sessionId.slice(0, 8)} setting ${configId}=${value}`);
    try {
      const conn = session.connection;

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
        if (configId === "model") {
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
      const errMsg = reportError("ACP_CONFIG_ERR", err, { engine: "acp", sessionId, configId });
      return { error: errMsg };
    }
  });

  // Retrieve buffered config options — used by renderer when useACP first mounts
  // and may have missed config_option_update events during DRAFT→active transition
  ipcMain.handle("acp:get-config-options", async (_event, sessionId: string) => {
    return { configOptions: configBuffer.get(sessionId) ?? [] };
  });

  // Retrieve buffered available commands — same pattern as config options
  ipcMain.handle("acp:get-available-commands", async (_event, sessionId: string) => {
    return { commands: commandsBuffer.get(sessionId) ?? [] };
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
