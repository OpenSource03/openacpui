import { BrowserWindow, ipcMain } from "electron";
import WebSocket from "ws";
import crypto from "crypto";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import { reportError } from "../lib/error-utils";
import { getAppSetting, setAppSettings } from "../lib/app-settings";

function getGatewayUrl(): string {
  return getAppSetting("openclawGatewayUrl") || "ws://127.0.0.1:18789";
}

function getDeviceId(): string {
  let id = getAppSetting("openclawDeviceId");
  if (!id) {
    id = `harnss-${crypto.randomUUID()}`;
    setAppSettings({ openclawDeviceId: id });
  }
  return id;
}

function buildAuthParams(): Record<string, unknown> {
  const auth: Record<string, unknown> = {};
  const token = getAppSetting("openclawGatewayToken");
  const deviceToken = getAppSetting("openclawDeviceToken");
  if (deviceToken) {
    auth.deviceToken = deviceToken;
  } else if (token) {
    auth.token = token;
  }
  return Object.keys(auth).length > 0 ? { auth } : {};
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
      const ws = new WebSocket(gatewayUrl);

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

      const connectPayload = await wsSend(session, "connect", {
        client: { id: "harnss", version: "1.0.0", platform: process.platform, mode: "operator" },
        device: { id: getDeviceId() },
        role: "operator",
        scopes: ["operator.read", "operator.write", "operator.pairing"],
        ...buildAuthParams(),
        cwd: options.cwd,
        ...(model ? { model } : {}),
        ...(skills.length ? { skills } : {}),
      });

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
      const ws = new WebSocket(url);
      const result = await new Promise<{ available: boolean; error?: string }>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ available: false, error: `Connection timeout (${url})` });
        }, 5000);
        ws.on("open", () => {
          clearTimeout(timeout);
          ws.close();
          resolve({ available: true });
        });
        ws.on("error", (err) => {
          clearTimeout(timeout);
          const msg = (err as Error).message || "Unknown error";
          if (msg.includes("ECONNREFUSED")) {
            resolve({ available: false, error: `Gateway not running at ${url}` });
          } else if (msg.includes("ENOTFOUND")) {
            resolve({ available: false, error: `Host not found: ${url}` });
          } else if (msg.includes("ETIMEDOUT")) {
            resolve({ available: false, error: `Connection timed out: ${url}` });
          } else {
            resolve({ available: false, error: msg });
          }
        });
      });
      return result;
    } catch (err) {
      return { available: false, error: (err as Error).message || "Connection failed" };
    }
  });

  ipcMain.handle("openclaw:pair", async () => {
    const url = getGatewayUrl();
    try {
      const ws = new WebSocket(url);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Gateway connection timeout"));
        }, 10000);
        ws.on("open", () => { clearTimeout(timeout); resolve(); });
        ws.on("error", (err) => { clearTimeout(timeout); reject(err); });
      });

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

      const tokenParam = getAppSetting("openclawGatewayToken");
      const authParams: Record<string, unknown> = {};
      if (tokenParam) authParams.token = tokenParam;

      const connectResult = await sendReq("connect", {
        client: { id: "harnss", version: "1.0.0", platform: process.platform, mode: "operator" },
        device: { id: getDeviceId() },
        role: "operator",
        scopes: ["operator.read", "operator.write", "operator.pairing"],
        ...(Object.keys(authParams).length > 0 ? { auth: authParams } : {}),
      }) as Record<string, unknown> | null;

      const auth = (connectResult?.auth ?? {}) as Record<string, unknown>;
      if (auth.deviceToken) {
        setAppSettings({ openclawDeviceToken: auth.deviceToken as string });
      }

      const version = connectResult?.protocol as string | undefined;

      ws.close();
      log("OPENCLAW_PAIR", { paired: true, version });
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
      return { ok: false, error: msg };
    }
  });
}
