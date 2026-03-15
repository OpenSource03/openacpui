import { BrowserWindow, ipcMain } from "electron";
import WebSocket from "ws";
import crypto from "crypto";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import { reportError } from "../lib/error-utils";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

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
    const gatewayUrl = options.gatewayUrl || DEFAULT_GATEWAY_URL;

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

      const connectPayload = await wsSend(session, "connect", {
        client: { id: "harnss", version: "1.0.0", platform: process.platform, mode: "operator" },
        role: "operator",
        scopes: ["operator.read", "operator.write"],
      });

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
    try {
      const ws = new WebSocket(DEFAULT_GATEWAY_URL);
      const connected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 3000);
        ws.on("open", () => {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        });
        ws.on("error", () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });
      return { available: connected };
    } catch {
      return { available: false };
    }
  });
}
