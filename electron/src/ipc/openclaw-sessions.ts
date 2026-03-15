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

const CLIENT_ID = "cli";
const CLIENT_MODE = "backend";
const PROTOCOL_VERSION = 3;
const ROLE = "operator";
const SCOPES = ["operator.read", "operator.write", "operator.pairing"];

function getGatewayUrl(): string {
  return getAppSetting("openclawGatewayUrl") || "ws://127.0.0.1:18789";
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

function signConnectPayload(identity: DeviceIdentity, nonce: string): { signature: string; signedAt: number } {
  const signedAt = Date.now();
  const token = getAppSetting("openclawGatewayToken") || getAppSetting("openclawDeviceToken") || "";
  const scopesStr = SCOPES.join(",");
  const payload = `v2|${identity.id}|${CLIENT_ID}|${CLIENT_MODE}|${ROLE}|${scopesStr}|${signedAt}|${token}|${nonce}`;

  const privateKey = crypto.createPrivateKey(identity.privateKey);
  const sig = crypto.sign(null, Buffer.from(payload, "utf-8"), privateKey);
  return { signature: sig.toString("base64url"), signedAt };
}

function buildConnectParams(identity: DeviceIdentity, nonce: string): Record<string, unknown> {
  const { signature, signedAt } = signConnectPayload(identity, nonce);
  const auth: Record<string, unknown> = {};
  const deviceToken = getAppSetting("openclawDeviceToken");
  const gatewayToken = getAppSetting("openclawGatewayToken");
  if (deviceToken) auth.deviceToken = deviceToken;
  else if (gatewayToken) auth.token = gatewayToken;

  return {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: { id: CLIENT_ID, version: "1.0.0", platform: process.platform, mode: CLIENT_MODE },
    device: {
      id: identity.id,
      publicKey: identity.publicKey,
      signature,
      signedAt,
      nonce,
    },
    role: ROLE,
    scopes: SCOPES,
    ...(Object.keys(auth).length > 0 ? { auth } : {}),
  };
}

function waitForChallenge(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for connect.challenge from Gateway")), 8000);
    const handler = (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === "event" && msg.event === "connect.challenge") {
          clearTimeout(timeout);
          ws.removeListener("message", handler);
          const payload = msg.payload as Record<string, unknown>;
          resolve((payload.nonce as string) || "");
        }
      } catch {}
    };
    ws.on("message", handler);
    ws.on("close", () => { clearTimeout(timeout); reject(new Error("WebSocket closed before challenge received")); });
    ws.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });
}

interface OpenClawSession {
  ws: WebSocket;
  sessionKey: string;
  internalId: string;
  eventCounter: number;
  gatewayUrl: string;
  cwd: string;
  pendingRequests: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
}

export const openclawSessions = new Map<string, OpenClawSession>();

function nextReqId(): string {
  return crypto.randomUUID();
}

function wsSend(session: OpenClawSession, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextReqId();
    session.pendingRequests.set(id, { resolve, reject });
    const frame = JSON.stringify({ type: "req", id, method, params });
    session.ws.send(frame, (err) => {
      if (err) {
        session.pendingRequests.delete(id);
        reject(err);
      }
    });
  });
}

function handleWsMessage(
  sessionId: string,
  session: OpenClawSession,
  raw: string,
  getMainWindow: () => BrowserWindow | null,
): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type === "res") {
    const pending = session.pendingRequests.get(msg.id as string);
    if (pending) {
      session.pendingRequests.delete(msg.id as string);
      if (msg.ok) {
        pending.resolve(msg.payload);
      } else {
        pending.reject(new Error((msg.error as Record<string, unknown>)?.message as string ?? "Gateway error"));
      }
    }
    return;
  }

  if (msg.type === "event") {
    session.eventCounter++;
    const event = msg.event as string;
    const payload = (msg.payload ?? {}) as Record<string, unknown>;

    safeSend(getMainWindow, "openclaw:event", {
      _sessionId: sessionId,
      type: event,
      payload,
      _seq: session.eventCounter,
    });
  }
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("openclaw:start", async (_event, options: {
    cwd: string;
    gatewayUrl?: string;
    model?: string;
    skills?: string[];
  }) => {
    const sessionId = crypto.randomUUID();
    const gatewayUrl = options.gatewayUrl || getGatewayUrl();

    try {
      const ws = new WebSocket(gatewayUrl, { rejectUnauthorized: false });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Gateway connection timeout"));
        }, 10000);

        ws.on("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        ws.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      const identity = loadOrCreateDeviceIdentity();
      const nonce = await waitForChallenge(ws);

      const session: OpenClawSession = {
        ws,
        sessionKey: sessionId,
        internalId: sessionId,
        eventCounter: 0,
        gatewayUrl,
        cwd: options.cwd,
        pendingRequests: new Map(),
      };

      ws.on("message", (data) => {
        handleWsMessage(sessionId, session, data.toString(), getMainWindow);
      });

      ws.on("close", (code) => {
        openclawSessions.delete(sessionId);
        safeSend(getMainWindow, "openclaw:exit", {
          _sessionId: sessionId,
          code,
        });
      });

      ws.on("error", (err) => {
        log("OPENCLAW_WS_ERR", `session=${sessionId.slice(0, 8)} ${err.message}`);
      });

      openclawSessions.set(sessionId, session);

      const model = options.model || getAppSetting("openclawDefaultModel") || undefined;
      const skills = options.skills?.length ? options.skills : (getAppSetting("openclawDefaultSkills") ?? []);

      const connectParams = buildConnectParams(identity, nonce);
      const connectPayload = await wsSend(session, "connect", connectParams);

      const hello = connectPayload as Record<string, unknown> | null;
      const helloAuth = hello?.auth as Record<string, unknown> | undefined;
      if (helloAuth?.deviceToken) {
        setAppSettings({ openclawDeviceToken: helloAuth.deviceToken as string });
      }

      log("OPENCLAW_START", { sessionId, gatewayUrl, connected: true });

      return {
        sessionId,
        gatewayVersion: (connectPayload as Record<string, unknown>)?.protocol,
      };
    } catch (err) {
      const errMsg = reportError("OPENCLAW_START_ERR", err, { engine: "openclaw" });
      return { error: errMsg };
    }
  });

  ipcMain.handle("openclaw:send", async (_event, { sessionId, text }: { sessionId: string; text: string }) => {
    const session = openclawSessions.get(sessionId);
    if (!session) return { error: "OpenClaw session not found" };

    try {
      await wsSend(session, "chat.send", {
        sessionKey: session.sessionKey,
        message: text,
        cwd: session.cwd,
      });
      return { ok: true };
    } catch (err) {
      const errMsg = reportError("OPENCLAW_SEND_ERR", err, { engine: "openclaw", sessionId });
      return { error: errMsg };
    }
  });

  ipcMain.handle("openclaw:stop", async (_event, sessionId: string) => {
    const session = openclawSessions.get(sessionId);
    if (!session) return { ok: true };

    try {
      session.ws.close();
    } catch {
      // already closed
    }
    openclawSessions.delete(sessionId);
    log("OPENCLAW_STOP", { sessionId: sessionId.slice(0, 8) });
    return { ok: true };
  });

  ipcMain.handle("openclaw:interrupt", async (_event, sessionId: string) => {
    const session = openclawSessions.get(sessionId);
    if (!session) return { error: "OpenClaw session not found" };

    try {
      await wsSend(session, "chat.cancel", { sessionKey: session.sessionKey });
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
    const session = openclawSessions.get(sessionId);
    if (!session) return { error: "OpenClaw session not found" };

    try {
      const result = await wsSend(session, "agent.spawn", {
        sessionKey: session.sessionKey,
        agentName,
        prompt,
        skills,
        cwd: session.cwd,
      });
      return { ok: true, agentId: (result as Record<string, unknown>)?.agentId };
    } catch (err) {
      const errMsg = reportError("OPENCLAW_SPAWN_AGENT_ERR", err, { engine: "openclaw", sessionId });
      return { error: errMsg };
    }
  });

  ipcMain.handle("openclaw:list-agents", async (_event, sessionId: string) => {
    const session = openclawSessions.get(sessionId);
    if (!session) return { error: "OpenClaw session not found" };

    try {
      const result = await wsSend(session, "agent.list", { sessionKey: session.sessionKey });
      return { ok: true, agents: result };
    } catch (err) {
      const errMsg = reportError("OPENCLAW_LIST_AGENTS_ERR", err, { engine: "openclaw", sessionId });
      return { error: errMsg };
    }
  });

  ipcMain.handle("openclaw:status", async () => {
    const url = getGatewayUrl();
    try {
      const ws = new WebSocket(url, { rejectUnauthorized: false });
      let settled = false;

      const result = await new Promise<{ available: boolean; error?: string }>((resolve) => {
        const settle = (r: { available: boolean; error?: string }) => {
          if (settled) return;
          settled = true;
          resolve(r);
        };

        const timeout = setTimeout(() => {
          try { ws.close(); } catch {}
          settle({ available: false, error: `Connection timed out after 5s — is the Gateway running at ${url}?` });
        }, 5000);

        ws.on("open", () => {
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          settle({ available: true });
        });

        ws.on("error", (err) => {
          clearTimeout(timeout);
          const raw = String((err as Error).message || err || "Unknown error");
          let friendly: string;
          if (raw.includes("ECONNREFUSED")) {
            friendly = `Connection refused — Gateway is not running at ${url}`;
          } else if (raw.includes("ENOTFOUND") || raw.includes("getaddrinfo")) {
            friendly = `Host not found — cannot resolve ${url}`;
          } else if (raw.includes("ETIMEDOUT")) {
            friendly = `Connection timed out — ${url} is not reachable`;
          } else if (raw.includes("CERT") || raw.includes("certificate") || raw.includes("SSL") || raw.includes("TLS")) {
            friendly = `TLS/certificate error — ${raw}`;
          } else if (raw.includes("ECONNRESET")) {
            friendly = `Connection reset by Gateway at ${url}`;
          } else if (raw.includes("401") || raw.includes("403") || raw.includes("Unauthorized")) {
            friendly = `Authentication failed — check your Gateway Token`;
          } else {
            friendly = raw;
          }
          settle({ available: false, error: friendly });
        });

        ws.on("close", (code, reason) => {
          clearTimeout(timeout);
          if (!settled) {
            const reasonStr = reason?.toString() || "";
            if (code === 1008) {
              settle({ available: false, error: `Pairing required — approve this device on the Gateway` });
            } else {
              settle({ available: false, error: `Gateway closed connection (code ${code}${reasonStr ? `: ${reasonStr}` : ""})` });
            }
          }
        });
      });
      return result;
    } catch (err) {
      const raw = String((err as Error).message || err || "Unknown error");
      return { available: false, error: raw };
    }
  });

  ipcMain.handle("openclaw:pair", async () => {
    const url = getGatewayUrl();
    try {
      const ws = new WebSocket(url, { rejectUnauthorized: false });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Gateway connection timeout"));
        }, 10000);
        ws.on("open", () => { clearTimeout(timeout); resolve(); });
        ws.on("error", (err) => { clearTimeout(timeout); reject(err); });
      });

      const identity = loadOrCreateDeviceIdentity();
      const nonce = await waitForChallenge(ws);

      const pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

      ws.on("message", (data) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (msg.type === "res") {
          const pending = pendingRequests.get(msg.id as string);
          if (pending) {
            pendingRequests.delete(msg.id as string);
            if (msg.ok) pending.resolve(msg.payload);
            else pending.reject(new Error((msg.error as Record<string, unknown>)?.message as string ?? "Gateway error"));
          }
        }
      });

      const sendReq = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
        return new Promise((resolve, reject) => {
          const id = nextReqId();
          pendingRequests.set(id, { resolve, reject });
          ws.send(JSON.stringify({ type: "req", id, method, params }), (err) => {
            if (err) { pendingRequests.delete(id); reject(err); }
          });
        });
      };

      const connectParams = buildConnectParams(identity, nonce);
      const connectResult = await sendReq("connect", connectParams) as Record<string, unknown> | null;

      const auth = (connectResult?.auth ?? {}) as Record<string, unknown>;
      if (auth.deviceToken) {
        setAppSettings({ openclawDeviceToken: auth.deviceToken as string });
      }

      const version = connectResult?.protocol as string | undefined;

      ws.close();
      log("OPENCLAW_PAIR", { paired: true, version, deviceId: identity.id.slice(0, 12) });
      return { ok: true, paired: true, version };
    } catch (err) {
      const msg = (err as Error).message || "Pairing failed";
      log("OPENCLAW_PAIR_ERR", msg);
      if (msg.includes("1008") || msg.includes("pairing required")) {
        return { ok: false, error: "Pairing required — approve this device on the Gateway (run `openclaw nodes approve` or use the Gateway UI)" };
      }
      if (msg.includes("AUTH_TOKEN_MISMATCH")) {
        return { ok: false, error: "Token mismatch — check your Gateway Token in settings" };
      }
      if (msg.includes("DEVICE_AUTH_SIGNATURE_INVALID") || msg.includes("device signature invalid")) {
        return { ok: false, error: "Device signature invalid — try deleting the identity file and re-pairing" };
      }
      return { ok: false, error: msg };
    }
  });
}
