import { BrowserWindow, ipcMain } from "electron";
import WebSocket from "ws";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import { reportError } from "../lib/error-utils";
import { getAppSetting, setAppSettings } from "../lib/app-settings";
import { getDataDir } from "../lib/data-dir";

function getGatewayUrl(): string {
  return getAppSetting("openclawGatewayUrl") || "wss://127.0.0.1:18789";
}

function getGatewayToken(): string {
  return getAppSetting("openclawGatewayToken") || "";
}

function getAgentId(): string {
  return getAppSetting("openclawDefaultAgent") || "";
}

interface DeviceIdentity {
  id: string;
  publicKey: string;
  privateKey: string;
}

function getIdentityPath(): string {
  return path.join(getDataDir(), "openclaw-device-identity.json");
}

function loadOrCreateDeviceIdentity(): DeviceIdentity {
  const idPath = getIdentityPath();
  try {
    const raw = fs.readFileSync(idPath, "utf-8");
    const identity = JSON.parse(raw) as DeviceIdentity;
    if (identity.id && identity.publicKey && identity.privateKey) {
      if (identity.publicKey.length === 64 && /^[0-9a-f]+$/.test(identity.publicKey)) {
        log("OPENCLAW_IDENTITY_MIGRATION", "Regenerating identity — old hex format detected");
      } else {
        return identity;
      }
    }
  } catch {}

  const keyPair = crypto.generateKeyPairSync("ed25519");
  const spkiDer = keyPair.publicKey.export({ type: "spki", format: "der" });
  const raw32 = spkiDer.subarray(-32);
  const publicKeyBase64Url = raw32.toString("base64url");
  const deviceId = crypto.createHash("sha256").update(raw32).digest("hex");

  const identity: DeviceIdentity = {
    id: deviceId,
    publicKey: publicKeyBase64Url,
    privateKey: keyPair.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  };

  const dir = path.dirname(idPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(idPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
  log("OPENCLAW_IDENTITY_CREATED", { deviceId: deviceId.slice(0, 12) });
  return identity;
}

interface PendingRpc {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let shared: {
  ws: WebSocket;
  connected: boolean;
  sessionKey: string;
  pending: Map<string, PendingRpc>;
  getMainWindow: () => BrowserWindow | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  activeSessionIds: Set<string>;
  currentRunId: string | null;
} | null = null;

function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if (!shared?.connected || !shared.ws || shared.ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Not connected to Gateway"));
  }
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      shared?.pending.delete(id);
      reject(new Error(`Timeout: ${method}`));
    }, 30_000);
    shared!.pending.set(id, { resolve, reject, timer });
    shared!.ws.send(JSON.stringify({ type: "req", id, method, params }), (err) => {
      if (err) {
        clearTimeout(timer);
        shared?.pending.delete(id);
        reject(err);
      }
    });
  });
}

function emitToSessions(type: string, payload: Record<string, unknown>): void {
  if (!shared) return;
  for (const sid of shared.activeSessionIds) {
    safeSend(shared.getMainWindow, "openclaw:event", {
      _sessionId: sid,
      type,
      payload,
      _seq: 0,
    });
  }
}

function handleMessage(raw: string): void {
  if (!shared) return;
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.type === "res") {
    const pending = shared.pending.get(msg.id as string);
    if (pending) {
      shared.pending.delete(msg.id as string);
      clearTimeout(pending.timer);
      if (msg.ok === false || msg.error) {
        const errObj = msg.error as Record<string, unknown> | string | undefined;
        const errMsg = typeof errObj === "string" ? errObj : (errObj as Record<string, unknown>)?.message as string ?? "Gateway error";
        pending.reject(new Error(errMsg));
      } else {
        pending.resolve(msg.payload ?? msg.result);
      }
    }
    return;
  }

  if (msg.id && shared.pending.has(msg.id as string)) {
    const pending = shared.pending.get(msg.id as string)!;
    shared.pending.delete(msg.id as string);
    clearTimeout(pending.timer);
    if (msg.error) {
      pending.reject(new Error(typeof msg.error === "string" ? msg.error : JSON.stringify(msg.error)));
    } else {
      pending.resolve(msg.result ?? msg.payload);
    }
    return;
  }

  if (msg.method === "chat" && msg.params) {
    const params = msg.params as Record<string, unknown>;
    const delta = params.delta as string | undefined;
    const content = params.content as string | undefined;
    const done = params.done as boolean | undefined;

    if (delta) {
      emitToSessions("chat:delta", { text: delta });
    }

    if (done) {
      shared.currentRunId = null;
      emitToSessions("chat:final", { message: content ?? "" });
    }
    return;
  }

  if (msg.type === "event") {
    const event = msg.event as string;
    const payload = (msg.payload ?? {}) as Record<string, unknown>;
    const data = (payload.data ?? {}) as Record<string, unknown>;

    if (event === "tick" || event === "health" || event === "presence" || event === "heartbeat" || event === "connect.challenge" || event === "chat") return;

    if (event === "agent") {
      const stream = payload.stream as string;
      if (stream === "lifecycle") {
        const phase = data.phase as string;
        if (phase === "start") emitToSessions("lifecycle:start", {});
        else if (phase === "error") emitToSessions("chat:error", { message: (data.error as string) ?? "Agent error" });
        else if (phase === "end" || phase === "done") emitToSessions("lifecycle:end", {});
      } else if (stream === "thinking") {
        emitToSessions("thinking:delta", { text: (data.text ?? data.delta ?? "") as string });
      } else if (stream === "thinking_done") {
        emitToSessions("thinking:done", {});
      } else if (stream === "assistant") {
        emitToSessions("chat:delta", { text: (data.text ?? data.delta ?? "") as string });
      } else if (stream === "tool") {
        const phase = (data.phase ?? data.status) as string | undefined;
        if (phase === "end" || phase === "completed" || phase === "done") {
          emitToSessions("tool:result", {
            toolUseId: data.toolUseId ?? data.id,
            toolName: data.name ?? data.toolName,
            result: data.result ?? data.output,
          });
        } else {
          emitToSessions("tool:start", {
            toolUseId: data.toolUseId ?? data.id,
            toolName: (data.name ?? data.toolName ?? "unknown") as string,
            input: data.input ?? data.args ?? {},
          });
        }
      }
    }
  }
}

async function ensureConnection(getMainWindow: () => BrowserWindow | null): Promise<void> {
  if (shared?.connected && shared.ws.readyState === WebSocket.OPEN) return;

  if (shared?.reconnectTimer) {
    clearTimeout(shared.reconnectTimer);
    shared.reconnectTimer = null;
  }

  const gatewayUrl = getGatewayUrl();
  const agentId = getAgentId();
  const sessionKey = `agent:${agentId}:editor`;

  const ws = new WebSocket(gatewayUrl, { rejectUnauthorized: false });

  if (!shared) {
    shared = {
      ws,
      connected: false,
      sessionKey,
      pending: new Map(),
      getMainWindow,
      reconnectTimer: null,
      activeSessionIds: new Set(),
      currentRunId: null,
    };
  } else {
    shared.ws = ws;
    shared.connected = false;
    shared.sessionKey = sessionKey;
    shared.getMainWindow = getMainWindow;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Gateway connection timeout"));
    }, 10000);
    ws.on("open", () => { clearTimeout(timeout); resolve(); });
    ws.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });

  const challengeNonce = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for connect.challenge")), 8000);
    const handler = (rawData: WebSocket.Data) => {
      try {
        const m = JSON.parse(rawData.toString()) as Record<string, unknown>;
        if (m.type === "event" && m.event === "connect.challenge") {
          clearTimeout(timeout);
          ws.removeListener("message", handler);
          resolve(((m.payload as Record<string, unknown>)?.nonce as string) || "");
        }
      } catch {}
    };
    ws.on("message", handler);
  });

  ws.on("message", (data) => handleMessage(data.toString()));

  ws.on("close", () => {
    log("OPENCLAW_WS_CLOSED", "Reconnecting in 3s");
    if (shared) {
      shared.connected = false;
      emitToSessions("status", { connected: false });
      shared.reconnectTimer = setTimeout(() => {
        ensureConnection(getMainWindow).catch((err) => {
          log("OPENCLAW_RECONNECT_ERR", (err as Error).message);
        });
      }, 3000);
    }
  });

  ws.on("error", (err) => {
    log("OPENCLAW_WS_ERR", err.message);
  });

  const identity = loadOrCreateDeviceIdentity();
  const signedAt = Date.now();
  const gatewayToken = getAppSetting("openclawGatewayToken");
  const deviceToken = getAppSetting("openclawDeviceToken");
  const signToken = gatewayToken || deviceToken || "";
  const scopes = ["operator.read", "operator.write", "operator.pairing"];
  const payloadStr = `v2|${identity.id}|cli|backend|operator|${scopes.join(",")}|${signedAt}|${signToken}|${challengeNonce}`;

  const privateKey = crypto.createPrivateKey(identity.privateKey);
  const sig = crypto.sign(null, Buffer.from(payloadStr, "utf-8"), privateKey);

  const auth: Record<string, unknown> = {};
  if (gatewayToken) auth.token = gatewayToken;
  if (deviceToken) auth.deviceToken = deviceToken;

  const connectId = crypto.randomUUID();
  const connectFrame = JSON.stringify({
    type: "req",
    id: connectId,
    method: "connect",
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: "cli", version: "1.0.0", platform: process.platform, mode: "backend" },
      device: {
        id: identity.id,
        publicKey: identity.publicKey,
        signature: sig.toString("base64url"),
        signedAt,
        nonce: challengeNonce,
      },
      role: "operator",
      scopes,
      ...(Object.keys(auth).length > 0 ? { auth } : {}),
    },
  });

  const connectResult = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Connect timeout")), 15000);
    const handler = (rawData: WebSocket.Data) => {
      try {
        const m = JSON.parse(rawData.toString()) as Record<string, unknown>;
        if (m.type === "res" && m.id === connectId) {
          clearTimeout(timeout);
          ws.removeListener("message", handler);
          if (m.ok === false) {
            reject(new Error((m.error as Record<string, unknown>)?.message as string ?? "Connect rejected"));
          } else {
            resolve(m.payload ?? m.result);
          }
        }
      } catch {}
    };
    ws.on("message", handler);
    ws.send(connectFrame);
  });

  const helloAuth = ((connectResult as Record<string, unknown>)?.auth ?? {}) as Record<string, unknown>;
  if (helloAuth.deviceToken) {
    setAppSettings({ openclawDeviceToken: helloAuth.deviceToken as string });
  }

  shared.connected = true;
  log("OPENCLAW_CONNECTED", { gatewayUrl, agentId, sessionKey });
}

export const openclawSessions = new Map<string, boolean>();

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("openclaw:start", async (_event, _options: {
    cwd: string;
    gatewayUrl?: string;
    model?: string;
    skills?: string[];
  }) => {
    const sessionId = crypto.randomUUID();
    try {
      await ensureConnection(getMainWindow);
      shared!.activeSessionIds.add(sessionId);
      openclawSessions.set(sessionId, true);
      log("OPENCLAW_START", { sessionId: sessionId.slice(0, 8), sessionKey: shared!.sessionKey });
      return { sessionId };
    } catch (err) {
      const errMsg = reportError("OPENCLAW_START_ERR", err, { engine: "openclaw" });
      return { error: errMsg };
    }
  });

  ipcMain.handle("openclaw:send", async (_event, { sessionId, text }: { sessionId: string; text: string }) => {
    try {
      await ensureConnection(getMainWindow);
      shared!.activeSessionIds.add(sessionId);

      const attachments: { id: string; dataUrl: string; mimeType: string }[] = [];
      const cleanText = text.replace(/<file path="([^"]+)">\n([\s\S]*?)\n<\/file>/g, (_match, filePath: string, content: string) => {
        const ext = (filePath.split(".").pop() ?? "").toLowerCase();
        const mimeMap: Record<string, string> = {
          ts: "text/typescript", tsx: "text/typescript",
          js: "text/javascript", jsx: "text/javascript",
          py: "text/x-python", json: "application/json",
          html: "text/html", css: "text/css",
          md: "text/markdown", yaml: "text/yaml", yml: "text/yaml",
          sh: "text/x-shellscript", bash: "text/x-shellscript",
          rs: "text/x-rust", go: "text/x-go",
          java: "text/x-java", cpp: "text/x-c++src", c: "text/x-csrc",
          rb: "text/x-ruby", swift: "text/x-swift",
        };
        const mimeType = mimeMap[ext] ?? "text/plain";
        const base64 = Buffer.from(content, "utf-8").toString("base64");
        attachments.push({
          id: crypto.randomUUID(),
          dataUrl: `data:${mimeType};base64,${base64}`,
          mimeType,
        });
        return "";
      }).replace(/<folder path="([^"]+)">\n([\s\S]*?)\n<\/folder>/g, (_match, folderPath: string, tree: string) => {
        const base64 = Buffer.from(`Directory listing: ${folderPath}\n\n${tree}`, "utf-8").toString("base64");
        attachments.push({
          id: crypto.randomUUID(),
          dataUrl: `data:text/plain;base64,${base64}`,
          mimeType: "text/plain",
        });
        return "";
      }).replace(/\n{3,}/g, "\n\n").trim();

      const params: Record<string, unknown> = {
        sessionKey: shared!.sessionKey,
        message: cleanText || text,
        deliver: false,
        idempotencyKey: crypto.randomUUID(),
      };
      if (attachments.length > 0) params.attachments = attachments;

      const result = await rpc("chat.send", params) as Record<string, unknown>;

      shared!.currentRunId = (result?.runId as string) ?? null;
      log("OPENCLAW_SEND", { sessionId: sessionId.slice(0, 8), runId: shared!.currentRunId });
      return { ok: true };
    } catch (err) {
      const errMsg = reportError("OPENCLAW_SEND_ERR", err, { engine: "openclaw", sessionId });
      emitToSessions("chat:error", { message: errMsg });
      return { error: errMsg };
    }
  });

  ipcMain.handle("openclaw:stop", async (_event, sessionId: string) => {
    shared?.activeSessionIds.delete(sessionId);
    openclawSessions.delete(sessionId);
    if (shared && shared.activeSessionIds.size === 0) {
      if (shared.reconnectTimer) clearTimeout(shared.reconnectTimer);
      try { shared.ws.close(); } catch {}
      shared = null;
    }
    log("OPENCLAW_STOP", { sessionId: sessionId.slice(0, 8) });
    return { ok: true };
  });

  ipcMain.handle("openclaw:interrupt", async (_event, sessionId: string) => {
    try {
      const params: Record<string, unknown> = { sessionKey: shared?.sessionKey ?? "" };
      if (shared?.currentRunId) params.runId = shared.currentRunId;
      await rpc("chat.abort", params);
      shared!.currentRunId = null;
      emitToSessions("lifecycle:end", {});
      return { ok: true };
    } catch (err) {
      const errMsg = reportError("OPENCLAW_INTERRUPT_ERR", err, { engine: "openclaw", sessionId });
      return { error: errMsg };
    }
  });

  ipcMain.handle("openclaw:spawn-agent", async (_event, { sessionId, agentName, prompt, skills }: {
    sessionId: string;
    agentName: string;
    prompt: string;
    skills?: string[];
  }) => {
    try {
      const result = await rpc("agent.spawn", { agentName, prompt, skills });
      return { ok: true, agentId: (result as Record<string, unknown>)?.agentId };
    } catch (err) {
      const errMsg = reportError("OPENCLAW_SPAWN_AGENT_ERR", err, { engine: "openclaw", sessionId });
      return { error: errMsg };
    }
  });

  ipcMain.handle("openclaw:list-agents", async (_event, _sessionId: string) => {
    try {
      const result = await rpc("agent.list", {});
      return { ok: true, agents: result };
    } catch {
      return { ok: true, agents: [] };
    }
  });

  ipcMain.handle("openclaw:status", async () => {
    try {
      await ensureConnection(getMainWindow);
      return { available: true };
    } catch (err) {
      const raw = String((err as Error).message || err);
      let friendly: string;
      if (raw.includes("ECONNREFUSED")) friendly = `Connection refused — Gateway is not running at ${getGatewayUrl()}`;
      else if (raw.includes("ENOTFOUND")) friendly = `Host not found — cannot resolve ${getGatewayUrl()}`;
      else if (raw.includes("timeout")) friendly = `Connection timed out — is the Gateway running at ${getGatewayUrl()}?`;
      else friendly = raw;
      return { available: false, error: friendly };
    }
  });

  ipcMain.handle("openclaw:pair", async () => {
    try {
      await ensureConnection(getMainWindow);
      return { ok: true, paired: true };
    } catch (err) {
      const msg = (err as Error).message || "Pairing failed";
      log("OPENCLAW_PAIR_ERR", msg);
      return { ok: false, error: msg };
    }
  });
}
