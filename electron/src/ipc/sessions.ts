import { ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { getDataDir, getProjectSessionsDir, getSessionFilePath } from "../lib/data-dir";
import { reportError } from "../lib/error-utils";

interface SessionMeta {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  /** Timestamp of the most recent user message — used for sidebar sort order */
  lastMessageAt: number;
  model?: string;
  planMode?: boolean;
  totalCost?: number;
  engine?: "claude" | "acp" | "codex";
  codexThreadId?: string;
}

interface SearchResult {
  messageResults: Array<{
    sessionId: string;
    projectId: string;
    sessionTitle: string;
    messageId: string;
    snippet: string;
    timestamp: number;
  }>;
  sessionResults: Array<{
    sessionId: string;
    projectId: string;
    title: string;
    createdAt: number;
  }>;
}

function getLastUserMessageTimestamp(messages?: Array<{ role?: string; timestamp?: number }>): number | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user" && typeof msg.timestamp === "number") return msg.timestamp;
  }
  return undefined;
}

function getMetaFilePath(projectId: string, sessionId: string): string {
  return getSessionFilePath(projectId, sessionId).replace(/\.json$/, ".meta.json");
}

function extractSessionMeta(data: Record<string, unknown>, lastMessageAt: number): SessionMeta {
  return {
    id: data.id as string,
    projectId: data.projectId as string,
    title: (data.title as string) || "Untitled",
    createdAt: (data.createdAt as number) || 0,
    lastMessageAt,
    model: data.model as string | undefined,
    planMode: data.planMode as boolean | undefined,
    totalCost: (data.totalCost as number) || 0,
    engine: data.engine as SessionMeta["engine"],
    codexThreadId: data.codexThreadId as string | undefined,
  };
}

export function register(): void {
  ipcMain.handle("sessions:save", async (_event, data: { projectId: string; id: string; createdAt?: number; messages?: Array<{ role?: string; timestamp?: number }> }) => {
    try {
      const filePath = getSessionFilePath(data.projectId, data.id);
      const providedLastMessageAt = (data as Record<string, unknown>).lastMessageAt;
      const normalizedProvidedLastMessageAt =
        typeof providedLastMessageAt === "number" ? providedLastMessageAt : undefined;
      // Always prefer the latest user message timestamp when messages are present.
      const lastMessageAt =
        getLastUserMessageTimestamp(data.messages) ??
        normalizedProvidedLastMessageAt ??
        data.createdAt ??
        0;
      const enriched = { ...data, lastMessageAt };

      // Write main session file (no pretty-printing for smaller file size)
      const writeMain = fs.promises.writeFile(filePath, JSON.stringify(enriched), "utf-8");

      // Write metadata sidecar (fire-and-forget alongside main write)
      const meta = extractSessionMeta(enriched as unknown as Record<string, unknown>, lastMessageAt);
      const metaPath = getMetaFilePath(data.projectId, data.id);
      const writeMeta = fs.promises.writeFile(metaPath, JSON.stringify(meta), "utf-8").catch((err) => {
        reportError("SESSIONS:META_WRITE_ERR", err, { sessionId: data.id });
      });

      await Promise.all([writeMain, writeMeta]);
      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:SAVE_ERR", err, { sessionId: data.id });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:load", async (_event, projectId: string, sessionId: string) => {
    try {
      const filePath = getSessionFilePath(projectId, sessionId);
      try {
        await fs.promises.access(filePath);
      } catch {
        return null;
      }
      return JSON.parse(await fs.promises.readFile(filePath, "utf-8"));
    } catch (err) {
      reportError("SESSIONS:LOAD_ERR", err, { projectId, sessionId });
      return null;
    }
  });

  ipcMain.handle("sessions:list", async (_event, projectId: string) => {
    try {
      const dir = getProjectSessionsDir(projectId);
      const allFiles = await fs.promises.readdir(dir);

      // Prefer .meta.json sidecar files for fast listing
      const metaFiles = allFiles.filter((f) => f.endsWith(".meta.json"));
      const metaBasenames = new Set(metaFiles.map((f) => f.replace(/\.meta\.json$/, "")));

      // Find .json files that lack a .meta.json sidecar (migration path)
      const fullParseFiles = allFiles.filter(
        (f) => f.endsWith(".json") && !f.endsWith(".meta.json") && !metaBasenames.has(f.replace(/\.json$/, ""))
      );

      const items = await Promise.all([
        // Fast path: read small sidecar files
        ...metaFiles.map(async (file): Promise<SessionMeta | null> => {
          try {
            const raw = await fs.promises.readFile(path.join(dir, file), "utf-8");
            const data = JSON.parse(raw) as SessionMeta;
            return data;
          } catch {
            return null;
          }
        }),
        // Fallback: full-file parse for sessions without sidecar
        ...fullParseFiles.map(async (file): Promise<SessionMeta | null> => {
          try {
            const raw = await fs.promises.readFile(path.join(dir, file), "utf-8");
            const data = JSON.parse(raw) as Record<string, unknown>;
            const lastMessageAt: number =
              getLastUserMessageTimestamp(data.messages as Array<{ role?: string; timestamp?: number }>) ??
              (typeof data.lastMessageAt === "number" ? data.lastMessageAt : undefined) ??
              (data.createdAt as number) ??
              0;

            return extractSessionMeta(data, lastMessageAt);
          } catch {
            return null;
          }
        }),
      ]);

      const list: SessionMeta[] = items.filter((item): item is SessionMeta => item !== null);
      // Sort by most recent user activity, not creation time.
      list.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      return list;
    } catch (err) {
      reportError("SESSIONS:LIST_ERR", err, { projectId });
      return [];
    }
  });

  ipcMain.handle("sessions:delete", async (_event, projectId: string, sessionId: string) => {
    try {
      const filePath = getSessionFilePath(projectId, sessionId);
      const metaPath = getMetaFilePath(projectId, sessionId);

      // Delete both main file and sidecar, ignoring ENOENT
      await Promise.all([
        fs.promises.unlink(filePath).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== "ENOENT") throw err;
        }),
        fs.promises.unlink(metaPath).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== "ENOENT") throw err;
        }),
      ]);
      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:DELETE_ERR", err, { projectId, sessionId });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:search", async (_event, { projectIds, query }: { projectIds: string[]; query: string }): Promise<SearchResult> => {
    try {
      const lowerQuery = query.toLowerCase();
      const messageResults: SearchResult["messageResults"] = [];
      const sessionResults: SearchResult["sessionResults"] = [];

      for (const projectId of projectIds) {
        const dir = path.join(getDataDir(), "sessions", projectId);
        try {
          await fs.promises.access(dir);
        } catch {
          continue;
        }

        const allFiles = await fs.promises.readdir(dir);
        const files = allFiles.filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"));
        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            const stat = await fs.promises.stat(filePath);
            if (stat.size > 5 * 1024 * 1024) continue;

            const raw = await fs.promises.readFile(filePath, "utf-8");
            const data = JSON.parse(raw);
            const sessionTitle = data.title || "Untitled";
            const sessionId = data.id;

            if (sessionTitle.toLowerCase().includes(lowerQuery)) {
              sessionResults.push({
                sessionId,
                projectId,
                title: sessionTitle,
                createdAt: data.createdAt || 0,
              });
            }

            if (messageResults.length >= 10) continue;
            const messages = data.messages || [];
            for (const msg of messages) {
              if (messageResults.length >= 10) break;
              if (msg.role !== "user" && msg.role !== "assistant") continue;
              if (!msg.content || typeof msg.content !== "string") continue;

              const idx = msg.content.toLowerCase().indexOf(lowerQuery);
              if (idx === -1) continue;

              const start = Math.max(0, idx - 30);
              const end = Math.min(msg.content.length, idx + query.length + 50);
              let snippet = msg.content.slice(start, end);
              if (start > 0) snippet = "..." + snippet;
              if (end < msg.content.length) snippet = snippet + "...";

              messageResults.push({
                sessionId,
                projectId,
                sessionTitle,
                messageId: msg.id,
                snippet,
                timestamp: msg.timestamp || data.createdAt || 0,
              });
            }
          } catch {
            // Skip corrupted files
          }
        }
      }

      return { messageResults, sessionResults };
    } catch (err) {
      reportError("SESSIONS:SEARCH_ERR", err, { query });
      return { messageResults: [], sessionResults: [] };
    }
  });
}
