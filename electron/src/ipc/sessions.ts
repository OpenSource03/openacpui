import { ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { getDataDir, getProjectSessionsDir, getSessionFilePath } from "../lib/data-dir";
import { log } from "../lib/logger";

interface SessionMeta {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  /** Timestamp of the most recent message — used for sidebar sort order */
  lastMessageAt: number;
  model?: string;
  totalCost?: number;
  engine?: "claude" | "acp";
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

export function register(): void {
  ipcMain.handle("sessions:save", (_event, data: { projectId: string; id: string; createdAt?: number; messages?: Array<{ timestamp?: number }> }) => {
    try {
      const filePath = getSessionFilePath(data.projectId, data.id);
      // Compute lastMessageAt from messages so sessions:list can sort by latest activity
      let lastMessageAt = (data as Record<string, unknown>).lastMessageAt as number | undefined;
      if (!lastMessageAt && Array.isArray(data.messages) && data.messages.length > 0) {
        const lastMsg = data.messages[data.messages.length - 1];
        lastMessageAt = lastMsg?.timestamp || data.createdAt || 0;
      }
      const enriched = { ...data, lastMessageAt: lastMessageAt || data.createdAt || 0 };
      fs.writeFileSync(filePath, JSON.stringify(enriched, null, 2), "utf-8");
      return { ok: true };
    } catch (err) {
      log("SESSIONS:SAVE_ERR", (err as Error).message);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("sessions:load", (_event, projectId: string, sessionId: string) => {
    try {
      const filePath = getSessionFilePath(projectId, sessionId);
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (err) {
      log("SESSIONS:LOAD_ERR", (err as Error).message);
      return null;
    }
  });

  ipcMain.handle("sessions:list", (_event, projectId: string) => {
    try {
      const dir = getProjectSessionsDir(projectId);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      const list: SessionMeta[] = [];
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(dir, file), "utf-8");
          const data = JSON.parse(raw);
          // Derive lastMessageAt: stored field → last message timestamp → createdAt
          let lastMessageAt: number = data.lastMessageAt || 0;
          if (!lastMessageAt && Array.isArray(data.messages) && data.messages.length > 0) {
            const lastMsg = data.messages[data.messages.length - 1];
            lastMessageAt = lastMsg?.timestamp || 0;
          }
          if (!lastMessageAt) lastMessageAt = data.createdAt || 0;

          list.push({
            id: data.id,
            projectId: data.projectId,
            title: data.title || "Untitled",
            createdAt: data.createdAt || 0,
            lastMessageAt,
            model: data.model,
            totalCost: data.totalCost || 0,
            engine: data.engine,
          });
        } catch {
          // Skip corrupted files
        }
      }
      // Sort by most recent activity (latest message), not creation time
      list.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      return list;
    } catch (err) {
      log("SESSIONS:LIST_ERR", (err as Error).message);
      return [];
    }
  });

  ipcMain.handle("sessions:delete", (_event, projectId: string, sessionId: string) => {
    try {
      const filePath = getSessionFilePath(projectId, sessionId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return { ok: true };
    } catch (err) {
      log("SESSIONS:DELETE_ERR", (err as Error).message);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("sessions:search", (_event, { projectIds, query }: { projectIds: string[]; query: string }): SearchResult => {
    try {
      const lowerQuery = query.toLowerCase();
      const messageResults: SearchResult["messageResults"] = [];
      const sessionResults: SearchResult["sessionResults"] = [];

      for (const projectId of projectIds) {
        const dir = path.join(getDataDir(), "sessions", projectId);
        if (!fs.existsSync(dir)) continue;

        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            const stat = fs.statSync(filePath);
            if (stat.size > 5 * 1024 * 1024) continue;

            const raw = fs.readFileSync(filePath, "utf-8");
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
      log("SESSIONS:SEARCH_ERR", (err as Error).message);
      return { messageResults: [], sessionResults: [] };
    }
  });
}
