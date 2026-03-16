import { BrowserWindow, ipcMain } from "electron";
import WebSocket from "ws";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { execFile, exec } from "child_process";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import { reportError } from "../lib/error-utils";
import { getAppSetting, setAppSettings } from "../lib/app-settings";
import { getDataDir } from "../lib/data-dir";

function getGatewayUrl(): string {
  return getAppSetting("openclawGatewayUrl") || "ws://127.0.0.1:18789";
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
  cwd: string | null;
  chatBuffer: string;
  lastEmittedCleanLength: number;
  processedCurrentTurn: boolean;
  processedFilePaths: Set<string>;
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

const FILE_TAG_PREFIXES = ["read_file", "write_file", "edit_file", "delete_file"];

function stripFileTagsForDisplay(text: string): string {
  let result = text;
  result = result.replace(/<read_file\s+path="[^"]+"\s*\/>/g, "");
  result = result.replace(/<write_file\s+path="[^"]+">([\s\S]*?)<\/write_file>/g, "");
  result = result.replace(/<edit_file\s+path="[^"]+">([\s\S]*?)<\/edit_file>/g, "");
  result = result.replace(/<delete_file\s+path="[^"]+"\s*\/>/g, "");
  result = result.replace(/<write_file[\s\S]*$/g, "");
  result = result.replace(/<edit_file[\s\S]*$/g, "");
  result = result.replace(/<read_file[\s\S]*$/g, "");
  result = result.replace(/<delete_file[\s\S]*$/g, "");
  const lastLt = result.lastIndexOf("<");
  if (lastLt !== -1 && lastLt >= result.length - 30) {
    const tail = result.slice(lastLt + 1).split(/[\s>"\/]/)[0].toLowerCase();
    if (tail && FILE_TAG_PREFIXES.some(name => name.startsWith(tail))) {
      result = result.slice(0, lastLt);
    }
  }
  result = result.replace(/\n{3,}/g, "\n\n");
  return result;
}

type SharedState = NonNullable<typeof shared>;
type EmitFn = typeof emitToSessions;
type RpcFn = typeof rpc;

const MAX_FILE_OPS_PER_TURN = 10;

function processCompletedMessage(
  fullText: string,
  state: SharedState,
  emit: EmitFn,
  rpcCall: RpcFn,
): void {
  state.currentRunId = null;
  const cwd = state.cwd;
  const results: string[] = [];
  const readAttachments: { id: string; dataUrl: string; mimeType: string }[] = [];
  let hadFileOps = false;
  const processedPaths = state.processedFilePaths;
  let totalOps = 0;

  function safePath(relPath: string): string | null {
    if (!cwd) return null;
    const abs = path.resolve(cwd, relPath);
    if (!abs.startsWith(cwd)) return null;
    return abs;
  }

  let m: RegExpExecArray | null;

  const readPattern = /<read_file\s+path="([^"]+)"\s*\/>/g;
  while ((m = readPattern.exec(fullText)) !== null) {
    const relPath = m[1];
    const dedupeKey = `read:${relPath}`;
    if (processedPaths.has(dedupeKey) || totalOps >= MAX_FILE_OPS_PER_TURN) continue;
    processedPaths.add(dedupeKey);
    totalOps++;
    hadFileOps = true;
    const toolUseId = `openclaw-read-${crypto.randomUUID().slice(0, 8)}`;
    emit("tool:start", { toolUseId, toolName: "Read", input: { file_path: relPath } });
    const abs = safePath(relPath);
    if (!abs) {
      results.push(`Read ${relPath}: path outside project`);
      emit("tool:result", { toolUseId, toolName: "Read", result: { error: "path outside project" } });
      continue;
    }
    try {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_FILE_READ_SIZE) {
        results.push(`Read ${relPath}: too large (${stat.size} bytes)`);
        emit("tool:result", { toolUseId, toolName: "Read", result: { error: `file too large (${stat.size} bytes)` } });
        continue;
      }
      const fileContent = fs.readFileSync(abs, "utf-8");
      readAttachments.push(fileToAttachment(relPath, fileContent));
      results.push(`Read ${relPath}: OK (${stat.size} bytes)`);
      log("OPENCLAW_FILE_READ", { file: relPath, size: stat.size });
      emit("tool:result", { toolUseId, toolName: "Read", result: { content: fileContent.slice(0, 500) + (fileContent.length > 500 ? "\n..." : "") } });
    } catch {
      results.push(`Read ${relPath}: file not found`);
      emit("tool:result", { toolUseId, toolName: "Read", result: { error: "file not found" } });
    }
  }

  const writePattern = /<write_file\s+path="([^"]+)">([\s\S]*?)<\/write_file>/g;
  while ((m = writePattern.exec(fullText)) !== null) {
    const relPath = m[1];
    const dedupeKey = `write:${relPath}`;
    if (processedPaths.has(dedupeKey) || totalOps >= MAX_FILE_OPS_PER_TURN) continue;
    processedPaths.add(dedupeKey);
    totalOps++;
    hadFileOps = true;
    const fileContent = m[2].replace(/^\n/, "");
    const toolUseId = `openclaw-write-${crypto.randomUUID().slice(0, 8)}`;
    emit("tool:start", { toolUseId, toolName: "Write", input: { file_path: relPath, content: fileContent } });
    const abs = safePath(relPath);
    if (!abs) {
      results.push(`Write ${relPath}: path outside project`);
      emit("tool:result", { toolUseId, toolName: "Write", result: { error: "path outside project" } });
      continue;
    }
    try {
      const dir = path.dirname(abs);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(abs, fileContent, "utf-8");
      results.push(`Write ${relPath}: OK (${fileContent.length} bytes)`);
      log("OPENCLAW_FILE_WRITE", { file: relPath, size: fileContent.length });
      emit("tool:result", { toolUseId, toolName: "Write", result: { status: "ok", bytesWritten: fileContent.length } });
    } catch (err) {
      const errMsg2 = (err as Error).message;
      results.push(`Write ${relPath}: ${errMsg2}`);
      emit("tool:result", { toolUseId, toolName: "Write", result: { error: errMsg2 } });
    }
  }

  const editPattern = /<edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/g;
  while ((m = editPattern.exec(fullText)) !== null) {
    const relPath = m[1];
    const dedupeKey = `edit:${relPath}`;
    if (processedPaths.has(dedupeKey) || totalOps >= MAX_FILE_OPS_PER_TURN) continue;
    processedPaths.add(dedupeKey);
    totalOps++;
    hadFileOps = true;
    const editBody = m[2];
    const toolUseId = `openclaw-edit-${crypto.randomUUID().slice(0, 8)}`;
    const abs = safePath(relPath);
    if (!abs) {
      emit("tool:start", { toolUseId, toolName: "Edit", input: { file_path: relPath } });
      results.push(`Edit ${relPath}: path outside project`);
      emit("tool:result", { toolUseId, toolName: "Edit", result: { error: "path outside project" } });
      continue;
    }
    try {
      let fileContent = fs.readFileSync(abs, "utf-8");
      const blockPattern = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
      let blockMatch: RegExpExecArray | null;
      let replacements = 0;
      const allOldParts: string[] = [];
      const allNewParts: string[] = [];
      while ((blockMatch = blockPattern.exec(editBody)) !== null) {
        const search = blockMatch[1];
        const replace = blockMatch[2];
        if (fileContent.includes(search)) {
          fileContent = fileContent.replace(search, replace);
          allOldParts.push(search);
          allNewParts.push(replace);
          replacements++;
        }
      }
      if (replacements > 0) {
        fs.writeFileSync(abs, fileContent, "utf-8");
        const oldStr = allOldParts.join("\n...\n");
        const newStr = allNewParts.join("\n...\n");
        emit("tool:start", { toolUseId, toolName: "Edit", input: { file_path: relPath, old_string: oldStr, new_string: newStr } });
        results.push(`Edit ${relPath}: OK (${replacements} replacement${replacements > 1 ? "s" : ""})`);
        log("OPENCLAW_FILE_EDIT", { file: relPath, replacements });
        emit("tool:result", { toolUseId, toolName: "Edit", result: { status: "ok", replacements, oldString: oldStr, newString: newStr, filePath: relPath } });
      } else {
        results.push(`Edit ${relPath}: no matching blocks found`);
        log("OPENCLAW_FILE_EDIT_SKIP", { file: relPath, reason: "no matching SEARCH blocks" });
      }
    } catch (err) {
      const errMsg2 = (err as Error).message;
      results.push(`Edit ${relPath}: ${errMsg2}`);
      log("OPENCLAW_FILE_EDIT_ERR", { file: relPath, error: errMsg2 });
    }
  }

  const deletePattern = /<delete_file\s+path="([^"]+)"\s*\/>/g;
  while ((m = deletePattern.exec(fullText)) !== null) {
    const relPath = m[1];
    const dedupeKey = `delete:${relPath}`;
    if (processedPaths.has(dedupeKey) || totalOps >= MAX_FILE_OPS_PER_TURN) continue;
    processedPaths.add(dedupeKey);
    totalOps++;
    hadFileOps = true;
    const toolUseId = `openclaw-delete-${crypto.randomUUID().slice(0, 8)}`;
    emit("tool:start", { toolUseId, toolName: "Delete", input: { file_path: relPath } });
    const abs = safePath(relPath);
    if (!abs) {
      results.push(`Delete ${relPath}: path outside project`);
      emit("tool:result", { toolUseId, toolName: "Delete", result: { error: "path outside project" } });
      continue;
    }
    try {
      fs.unlinkSync(abs);
      results.push(`Delete ${relPath}: OK`);
      log("OPENCLAW_FILE_DELETE", { file: relPath });
      emit("tool:result", { toolUseId, toolName: "Delete", result: { status: "ok" } });
    } catch (err) {
      const errMsg2 = (err as Error).message;
      results.push(`Delete ${relPath}: ${errMsg2}`);
      emit("tool:result", { toolUseId, toolName: "Delete", result: { error: errMsg2 } });
    }
  }

  const cleanedText = stripFileTagsForDisplay(fullText);

  if (hadFileOps && results.length > 0) {
    emit("chat:final", { message: cleanedText });

    const feedbackParams: Record<string, unknown> = {
      sessionKey: state.sessionKey,
      message: results.join("\n"),
      deliver: false,
      idempotencyKey: crypto.randomUUID(),
    };
    if (readAttachments.length > 0) feedbackParams.attachments = readAttachments;

    state.chatBuffer = "";
    state.lastEmittedCleanLength = 0;
    state.processedFilePaths.clear();

    rpcCall("chat.send", feedbackParams).then((result) => {
      state.currentRunId = ((result as Record<string, unknown>)?.runId as string) ?? null;
      state.processedCurrentTurn = false;
    }).catch((err) => {
      log("OPENCLAW_FILE_SEND_ERR", (err as Error).message);
    });
  } else {
    emit("chat:final", { message: cleanedText });
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

  if (msg.type === "req" && msg.id && msg.method) {
    const method = msg.method as string;
    const params = (msg.params ?? {}) as Record<string, unknown>;

    if (method === "tool.execute" || method === "tool.call") {
      const tool = (params.tool ?? params.name ?? params.toolName) as string;
      const input = (params.input ?? params.args ?? params.params ?? {}) as Record<string, unknown>;
      emitToSessions("tool:start", { toolUseId: msg.id, toolName: tool, input });
      handleToolRequest(msg.id as string, tool, input).then(() => {
        emitToSessions("tool:result", { toolUseId: msg.id, toolName: tool, result: {} });
      });
      return;
    }

    if (method === "file.read" || method === "file.write" || method === "file.edit" ||
        method === "file.list" || method === "file.search" || method === "shell.exec") {
      const toolMap: Record<string, string> = {
        "file.read": "read_file", "file.write": "write_file", "file.edit": "edit_file",
        "file.list": "list_files", "file.search": "search", "shell.exec": "shell",
      };
      emitToSessions("tool:start", { toolUseId: msg.id, toolName: method, input: params });
      handleToolRequest(msg.id as string, toolMap[method], params).then(() => {
        emitToSessions("tool:result", { toolUseId: msg.id, toolName: method, result: {} });
      });
      return;
    }
  }

  if (msg.method === "chat" && msg.params) {
    return;
  }

  if (msg.type === "event") {
    const event = msg.event as string;
    const payload = (msg.payload ?? {}) as Record<string, unknown>;
    if (payload.sessionKey && payload.sessionKey !== shared.sessionKey) return;
    const data = (payload.data ?? {}) as Record<string, unknown>;

    if (event === "tick" || event === "health" || event === "presence" || event === "heartbeat" || event === "connect.challenge" || event === "chat") return;

    if (event === "agent") {
      const stream = payload.stream as string;
      if (stream === "lifecycle") {
        const phase = data.phase as string;
        if (phase === "start") {
          shared.processedCurrentTurn = false;
          emitToSessions("lifecycle:start", {});
        }
        else if (phase === "error") emitToSessions("chat:error", { message: (data.error as string) ?? "Agent error" });
        else if (phase === "end" || phase === "done") {
          if (shared.chatBuffer.length > 0 && !shared.processedCurrentTurn) {
            shared.processedCurrentTurn = true;
            processCompletedMessage(shared.chatBuffer, shared, emitToSessions, rpc);
          } else {
            emitToSessions("lifecycle:end", {});
          }
        }
      } else if (stream === "thinking") {
        emitToSessions("thinking:delta", { text: (data.text ?? data.delta ?? "") as string });
      } else if (stream === "thinking_done") {
        emitToSessions("thinking:done", {});
      } else if (stream === "assistant") {
        const delta = (data.delta ?? "") as string;
        if (delta && !shared.processedCurrentTurn) {
          shared.chatBuffer += delta;
          const cleaned = stripFileTagsForDisplay(shared.chatBuffer);
          if (cleaned.length > shared.lastEmittedCleanLength) {
            shared.lastEmittedCleanLength = cleaned.length;
            emitToSessions("chat:delta", { text: cleaned });
          }
        }
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
  const sessionKey = shared?.sessionKey || `agent:${agentId}:editor`;

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
      cwd: null,
      chatBuffer: "",
      lastEmittedCleanLength: 0,
      processedCurrentTurn: false,
      processedFilePaths: new Set(),
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

const MAX_FILE_READ_SIZE = 512 * 1024;
const MAX_SHELL_OUTPUT = 256 * 1024;
const SHELL_TIMEOUT = 30_000;

function resolvePath(filePath: string): string | null {
  if (!shared?.cwd) return null;
  const resolved = path.resolve(shared.cwd, filePath);
  if (!resolved.startsWith(shared.cwd)) return null;
  return resolved;
}

function sendResponse(id: string, result: unknown, error?: string): void {
  if (!shared?.ws || shared.ws.readyState !== WebSocket.OPEN) return;
  const frame: Record<string, unknown> = { type: "res", id };
  if (error) {
    frame.ok = false;
    frame.error = { message: error };
  } else {
    frame.ok = true;
    frame.result = result;
  }
  shared.ws.send(JSON.stringify(frame));
}

async function handleToolRequest(id: string, tool: string, input: Record<string, unknown>): Promise<void> {
  try {
    switch (tool) {
      case "read_file":
      case "Read": {
        const filePath = (input.file_path ?? input.path) as string;
        const resolved = resolvePath(filePath);
        if (!resolved) { sendResponse(id, null, `Invalid path: ${filePath}`); return; }
        const stat = fs.statSync(resolved);
        if (stat.size > MAX_FILE_READ_SIZE) { sendResponse(id, null, `File too large: ${stat.size} bytes`); return; }
        const content = fs.readFileSync(resolved, "utf-8");
        sendResponse(id, { content, size: stat.size });
        return;
      }

      case "write_file":
      case "Write": {
        const filePath = (input.file_path ?? input.path) as string;
        const content = (input.content ?? input.text) as string;
        const resolved = resolvePath(filePath);
        if (!resolved) { sendResponse(id, null, `Invalid path: ${filePath}`); return; }
        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(resolved, content, "utf-8");
        sendResponse(id, { written: true, path: filePath });
        return;
      }

      case "edit_file":
      case "Edit": {
        const filePath = (input.file_path ?? input.path) as string;
        const oldStr = (input.old_string ?? input.old) as string;
        const newStr = (input.new_string ?? input.new) as string;
        const resolved = resolvePath(filePath);
        if (!resolved) { sendResponse(id, null, `Invalid path: ${filePath}`); return; }
        if (!fs.existsSync(resolved)) { sendResponse(id, null, `File not found: ${filePath}`); return; }
        const original = fs.readFileSync(resolved, "utf-8");
        if (!original.includes(oldStr)) { sendResponse(id, null, "old_string not found in file"); return; }
        const updated = original.replace(oldStr, newStr);
        fs.writeFileSync(resolved, updated, "utf-8");
        sendResponse(id, { edited: true, path: filePath });
        return;
      }

      case "list_files":
      case "Glob": {
        const pattern = (input.pattern ?? input.glob ?? "") as string;
        const cwd = shared!.cwd!;
        try {
          const files = await listFilesGit(cwd);
          const filtered = pattern ? files.filter(f => f.includes(pattern.replace(/\*/g, ""))) : files;
          sendResponse(id, { files: filtered.slice(0, 500) });
        } catch {
          sendResponse(id, { files: [] });
        }
        return;
      }

      case "search":
      case "Grep": {
        const searchPattern = (input.pattern ?? input.query) as string;
        const searchPath = (input.path ?? input.file_path ?? ".") as string;
        const cwd = shared!.cwd!;
        const resolved = path.resolve(cwd, searchPath);
        if (!resolved.startsWith(cwd)) { sendResponse(id, null, `Invalid path: ${searchPath}`); return; }
        await new Promise<void>((resolve) => {
          execFile("grep", ["-rn", "--include=*.{ts,tsx,js,jsx,py,go,rs,java,rb,css,html,json,yaml,yml,md,sh}", "-l", searchPattern, resolved], { maxBuffer: MAX_SHELL_OUTPUT, timeout: SHELL_TIMEOUT }, (err, stdout) => {
            if (err && !stdout) {
              sendResponse(id, { matches: [] });
            } else {
              const matches = stdout.trim().split("\n").filter(Boolean).map(f => path.relative(cwd, f)).slice(0, 100);
              sendResponse(id, { matches });
            }
            resolve();
          });
        });
        return;
      }

      case "shell":
      case "Bash": {
        const command = (input.command ?? input.cmd) as string;
        if (!command) { sendResponse(id, null, "No command provided"); return; }
        const cwd = shared!.cwd!;
        emitToSessions("tool:start", { toolName: "Bash", input: { command } });
        await new Promise<void>((resolve) => {
          exec(command, { cwd, maxBuffer: MAX_SHELL_OUTPUT, timeout: SHELL_TIMEOUT }, (err, stdout, stderr) => {
            const output = stdout + (stderr ? `\n${stderr}` : "");
            sendResponse(id, {
              stdout: stdout.slice(0, MAX_SHELL_OUTPUT),
              stderr: stderr.slice(0, MAX_SHELL_OUTPUT),
              exitCode: err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0,
            });
            emitToSessions("tool:result", { toolName: "Bash", result: { output: output.slice(0, 2000) } });
            resolve();
          });
        });
        return;
      }

      default:
        sendResponse(id, null, `Unknown tool: ${tool}`);
    }
  } catch (err) {
    sendResponse(id, null, (err as Error).message);
  }
}

const CONTEXT_FILES = ["README.md", "package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml", "go.mod"];
const MAX_CONTEXT_FILE_SIZE = 1500;
const MAX_TREE_DEPTH = 4;

const EXT_MIME: Record<string, string> = {
  ts: "text/typescript", tsx: "text/typescript",
  js: "text/javascript", jsx: "text/javascript",
  py: "text/x-python", json: "application/json",
  html: "text/html", css: "text/css",
  md: "text/markdown", yaml: "text/yaml", yml: "text/yaml",
  sh: "text/x-shellscript", bash: "text/x-shellscript",
  rs: "text/x-rust", go: "text/x-go",
  java: "text/x-java", cpp: "text/x-c++src", c: "text/x-csrc",
  rb: "text/x-ruby", swift: "text/x-swift",
  toml: "text/plain", mod: "text/plain", sql: "text/plain",
  xml: "text/xml", svg: "image/svg+xml", txt: "text/plain",
};

const CODE_EXTENSIONS = new Set(Object.keys(EXT_MIME));

function fileToAttachment(filePath: string, content: string): { id: string; dataUrl: string; mimeType: string } {
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  const mimeType = EXT_MIME[ext] ?? "text/plain";
  return {
    id: crypto.randomUUID(),
    dataUrl: `data:${mimeType};base64,${Buffer.from(content, "utf-8").toString("base64")}`,
    mimeType,
  };
}


function listFilesGit(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim().split("\n").filter(Boolean).sort());
    });
  });
}

function buildTreeFromPaths(files: string[], maxDepth: number): string {
  const tree: Map<string, Set<string>> = new Map();
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 0; i < Math.min(parts.length, maxDepth); i++) {
      const dir = parts.slice(0, i).join("/") || ".";
      const entry = parts[i] + (i < parts.length - 1 ? "/" : "");
      if (!tree.has(dir)) tree.set(dir, new Set());
      tree.get(dir)!.add(entry);
    }
  }

  function render(dir: string, prefix: string, depth: number): string {
    if (depth >= maxDepth) return "";
    const entries = tree.get(dir);
    if (!entries) return "";
    let result = "";
    const sorted = [...entries].sort((a, b) => {
      const aDir = a.endsWith("/");
      const bDir = b.endsWith("/");
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });
    for (const entry of sorted) {
      result += `${prefix}${entry}\n`;
      if (entry.endsWith("/")) {
        const childDir = dir === "." ? entry.slice(0, -1) : `${dir}/${entry.slice(0, -1)}`;
        result += render(childDir, prefix + "  ", depth + 1);
      }
    }
    return result;
  }

  return render(".", "", 0);
}


const injectedSessions = new Set<string>();

export const openclawSessions = new Map<string, boolean>();

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("openclaw:start", async (_event, options: {
    cwd: string;
    gatewayUrl?: string;
    model?: string;
    skills?: string[];
  }) => {
    const sessionId = crypto.randomUUID();
    try {
      await ensureConnection(getMainWindow);

      const agentId = getAgentId();
      shared!.sessionKey = `agent:${agentId}:editor-${sessionId.slice(0, 8)}`;
      injectedSessions.clear();

      shared!.activeSessionIds.add(sessionId);
      openclawSessions.set(sessionId, true);
      if (options.cwd) shared!.cwd = options.cwd;
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
      shared!.chatBuffer = "";
      shared!.lastEmittedCleanLength = 0;
      shared!.processedCurrentTurn = false;
      shared!.processedFilePaths.clear();

      const attachments: { id: string; dataUrl: string; mimeType: string }[] = [];

      let contextPrefix = "";
      const sessionKey = shared!.sessionKey;
      if (shared!.cwd) {
        const isFirstMessage = !injectedSessions.has(sessionKey);
        injectedSessions.add(sessionKey);
        try {
          const cwd = shared!.cwd;

          const toolInstructions = [
            "You have FULL ACCESS to read, write, edit, and delete files in this project. Use these tags in your responses and the editor will execute them automatically:",
            "",
            "READ a file:",
            '<read_file path="src/demo.tsx"/>',
            "",
            "WRITE/CREATE a file (full content):",
            '<write_file path="src/new-file.ts">',
            "file content here",
            "</write_file>",
            "",
            "EDIT a file (search and replace):",
            '<edit_file path="src/demo.tsx">',
            "<<<<<<< SEARCH",
            "old code to find",
            "=======",
            "new code to replace with",
            ">>>>>>> REPLACE",
            "</edit_file>",
            "",
            "DELETE a file:",
            '<delete_file path="src/old-file.ts"/>',
            "",
            "Rules:",
            "- Always use paths relative to the project root.",
            "- You can use multiple tags in a single response.",
            "- For edit_file, the SEARCH block must match the file content exactly (including whitespace).",
            "- For edit_file, you can include multiple SEARCH/REPLACE blocks in one tag.",
            "- NEVER tell the user to manually run commands, copy/paste, or edit files. ALWAYS use these tags.",
          ].join("\n");

          if (isFirstMessage) {
            let fileTree = "";
            try {
              const files = await listFilesGit(cwd);
              fileTree = buildTreeFromPaths(files, MAX_TREE_DEPTH);
            } catch {}

            const contextParts: string[] = [];
            for (const file of CONTEXT_FILES) {
              const filePath = path.join(cwd, file);
              try {
                const stat = fs.statSync(filePath);
                if (!stat.isFile()) continue;
                contextParts.push(`--- ${file} ---\n${fs.readFileSync(filePath, "utf-8").slice(0, MAX_CONTEXT_FILE_SIZE)}`);
              } catch { continue; }
            }

            contextPrefix = [
              `[SYSTEM] You are connected to the user's local code editor. The project "${path.basename(cwd)}" is open at ${cwd}.`,
              "",
              "Project file tree:",
              fileTree,
              contextParts.length > 0 ? contextParts.join("\n\n") : "",
              "",
              toolInstructions,
              "[END SYSTEM]",
              "",
            ].join("\n");
          } else {
            contextPrefix = [
              `[SYSTEM] Reminder: You are connected to the user's local code editor. Project "${path.basename(cwd)}" at ${cwd}.`,
              "",
              toolInstructions,
              "[END SYSTEM]",
              "",
            ].join("\n");
          }

          log("OPENCLAW_CONTEXT_INJECTED", { cwd, prefixLength: contextPrefix.length, isFirstMessage });
        } catch (err) {
          log("OPENCLAW_CONTEXT_ERR", (err as Error).message);
        }
      }
      const cleanText = text.replace(/<file path="([^"]+)">\n([\s\S]*?)\n<\/file>/g, (_match, filePath: string, content: string) => {
        attachments.push(fileToAttachment(filePath, content));
        return "";
      }).replace(/<folder path="([^"]+)">\n([\s\S]*?)\n<\/folder>/g, (_match, folderPath: string, tree: string) => {
        attachments.push(fileToAttachment(folderPath, `Directory listing: ${folderPath}\n\n${tree}`));
        return "";
      }).replace(/\n{3,}/g, "\n\n").trim();

      const params: Record<string, unknown> = {
        sessionKey: shared!.sessionKey,
        message: contextPrefix + (cleanText || text),
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
