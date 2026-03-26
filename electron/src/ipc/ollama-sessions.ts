import { BrowserWindow, ipcMain } from "electron";
import crypto from "crypto";
import { safeSend } from "../lib/safe-send";
import { getAppSetting } from "../lib/app-settings";

interface OllamaMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface OllamaSession {
  messages: OllamaMessage[];
  cwd: string;
  abortController: AbortController | null;
}

const sessions = new Map<string, OllamaSession>();

function getBaseUrl(): string {
  return (getAppSetting("ollamaBaseUrl") || "http://localhost:11434").replace(/\/$/, "");
}

function getDefaultModel(): string {
  return getAppSetting("ollamaDefaultModel") || "llama3";
}

function emit(
  getMainWindow: () => BrowserWindow | null,
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
): void {
  safeSend(getMainWindow, "ollama:event", { _sessionId: sessionId, type, payload, _seq: 0 });
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("ollama:start", async (_event, { cwd }: { cwd: string }) => {
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { messages: [], cwd, abortController: null });
    return { sessionId };
  });

  ipcMain.handle("ollama:send", async (_event, { sessionId, text }: { sessionId: string; text: string }) => {
    const session = sessions.get(sessionId);
    if (!session) return { error: "Session not found" };

    session.messages.push({ role: "user", content: text });

    const controller = new AbortController();
    session.abortController = controller;

    emit(getMainWindow, sessionId, "lifecycle:start", {});

    try {
      const response = await fetch(`${getBaseUrl()}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: getDefaultModel(),
          messages: session.messages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => `HTTP ${response.status}`);
        emit(getMainWindow, sessionId, "chat:error", { message: errText });
        return { ok: true };
      }

      if (!response.body) {
        emit(getMainWindow, sessionId, "chat:error", { message: "No response body from Ollama" });
        return { ok: true };
      }

      const reader = (response.body as unknown as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              emit(getMainWindow, sessionId, "chat:delta", { text: fullText });
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }

      session.messages.push({ role: "assistant", content: fullText });
      emit(getMainWindow, sessionId, "chat:final", { message: fullText });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // User interrupted — emit final with whatever we got
        const last = session.messages.at(-1);
        const partial = last?.role === "assistant" ? last.content : "";
        emit(getMainWindow, sessionId, "chat:final", { message: partial });
      } else {
        emit(getMainWindow, sessionId, "chat:error", {
          message: (err as Error).message || "Ollama request failed",
        });
      }
    } finally {
      session.abortController = null;
    }

    return { ok: true };
  });

  ipcMain.handle("ollama:stop", async (_event, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.abortController?.abort();
      sessions.delete(sessionId);
    }
    safeSend(getMainWindow, "ollama:exit", { _sessionId: sessionId });
    return { ok: true };
  });

  ipcMain.handle("ollama:interrupt", async (_event, sessionId: string) => {
    const session = sessions.get(sessionId);
    session?.abortController?.abort();
    return { ok: true };
  });

  ipcMain.handle("ollama:status", async () => {
    try {
      const response = await fetch(`${getBaseUrl()}/api/version`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return { available: true };
      return { available: false, error: `HTTP ${response.status}` };
    } catch (err) {
      return { available: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("ollama:list-models", async () => {
    try {
      const response = await fetch(`${getBaseUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return { ok: false, models: [], error: `HTTP ${response.status}` };
      const data = await response.json() as { models?: Array<{ name: string }> };
      return { ok: true, models: (data.models ?? []).map((m) => m.name) };
    } catch (err) {
      return { ok: false, models: [], error: (err as Error).message };
    }
  });
}
