import { ipcMain } from "electron";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import { reportError } from "../lib/error-utils";

interface SessionPreview {
  firstUserMessage: string;
  model: string;
  timestamp: string;
}

interface UIMessage {
  id: string;
  role: string;
  content: string;
  thinking?: string;
  thinkingComplete?: boolean;
  isStreaming?: boolean;
  timestamp: number;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  subagentSteps?: unknown[];
  subagentStatus?: string;
}

function getCCProjectDir(projectPath: string): string {
  const hash = projectPath.replace(/\//g, "-");
  return path.join(os.homedir(), ".claude", "projects", hash);
}

function extractSessionPreview(filePath: string): SessionPreview | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    let firstUserMessage: string | null = null;
    let model: string | null = null;
    let timestamp: string | null = null;
    let scanned = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      scanned++;
      if (scanned > 100) break;

      try {
        const obj = JSON.parse(line);

        if (
          obj.type === "user" &&
          !obj.isMeta &&
          !obj.isSidechain &&
          typeof obj.message?.content === "string" &&
          obj.message.content.trim()
        ) {
          if (!firstUserMessage) {
            const raw = obj.message.content.trim();
            firstUserMessage = raw.length > 80 ? raw.slice(0, 77) + "..." : raw;
            timestamp = obj.timestamp;
          }
        }

        if (obj.type === "assistant" && !obj.isSidechain && !model) {
          model = obj.message?.model;
        }

        if (firstUserMessage && model) break;
      } catch {
        continue;
      }
    }

    if (!firstUserMessage) return null;

    return {
      firstUserMessage,
      model: model || "unknown",
      timestamp: timestamp || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function parseJsonlToUIMessages(filePath: string): UIMessage[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  const parsed: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      continue;
    }
  }

  const mainThread = parsed.filter((msg) => {
    if (msg.isSidechain) return false;
    if (msg.isMeta) return false;
    if (msg.type !== "user" && msg.type !== "assistant") return false;
    return true;
  });

  const uiMessages: UIMessage[] = [];
  let pendingThinking: { thinking: string; uuid: string } | null = null;

  for (const msg of mainThread) {
    const ts = msg.timestamp ? new Date(msg.timestamp as string).getTime() : Date.now();
    const message = msg.message as Record<string, unknown> | undefined;

    if (msg.type === "user") {
      pendingThinking = null;
      const msgContent = message?.content;

      if (typeof msgContent === "string" && msgContent.trim()) {
        uiMessages.push({
          id: `imported-user-${(msg.uuid as string) || crypto.randomUUID()}`,
          role: "user",
          content: msgContent,
          timestamp: ts,
        });
      } else if (Array.isArray(msgContent)) {
        for (const item of msgContent) {
          if (item.type === "tool_result") {
            const resultContent =
              typeof item.content === "string"
                ? item.content
                : Array.isArray(item.content)
                  ? item.content.map((c: { text?: string }) => c.text || "").join("\n")
                  : "";

            const rawResult = (msg.toolUseResult || msg.tool_use_result) as Record<string, unknown> | undefined;
            const toolResult = rawResult
              ? { ...rawResult }
              : { stdout: resultContent };
            const isError = !!item.is_error;
            const toolUseId = item.tool_use_id as string | undefined;

            // Link result back to matching tool_call so UI shows completed state
            if (toolUseId) {
              const toolCallMsg = uiMessages.find(
                (m) => m.id === `tool-${toolUseId}` && m.role === "tool_call",
              );
              if (toolCallMsg) {
                toolCallMsg.toolResult = toolResult;
                if (isError) (toolCallMsg as UIMessage & { toolError?: boolean }).toolError = true;
              }
            }

            uiMessages.push({
              id: `imported-result-${(msg.uuid as string) || crypto.randomUUID()}-${toolUseId || ""}`,
              role: "tool_result",
              content: resultContent,
              toolResult,
              timestamp: ts,
            });
          }
        }
      }
    } else if (msg.type === "assistant") {
      const blocks = (message?.content as Array<Record<string, unknown>>) || [];

      for (const block of blocks) {
        if (block.type === "thinking") {
          pendingThinking = { thinking: block.thinking as string, uuid: msg.uuid as string };
        } else if (block.type === "text" && (block.text as string)?.trim()) {
          uiMessages.push({
            id: `imported-assistant-${(msg.uuid as string) || crypto.randomUUID()}`,
            role: "assistant",
            content: block.text as string,
            thinking: pendingThinking?.thinking || undefined,
            thinkingComplete: pendingThinking ? true : undefined,
            isStreaming: false,
            timestamp: ts,
          });
          pendingThinking = null;
        } else if (block.type === "tool_use") {
          if (pendingThinking) {
            uiMessages.push({
              id: `imported-thinking-${pendingThinking.uuid || crypto.randomUUID()}`,
              role: "assistant",
              content: "",
              thinking: pendingThinking.thinking,
              thinkingComplete: true,
              isStreaming: false,
              timestamp: ts,
            });
            pendingThinking = null;
          }

          const isTask = block.name === "Task";
          uiMessages.push({
            id: `tool-${block.id}`,
            role: "tool_call",
            content: "",
            toolName: block.name as string,
            toolInput: block.input,
            timestamp: ts,
            ...(isTask ? { subagentSteps: [], subagentStatus: "completed" } : {}),
          });
        }
      }
    }
  }

  return uiMessages;
}

export function register(): void {
  ipcMain.handle("cc-sessions:list", async (_event, projectPath: string) => {
    try {
      const projectDir = getCCProjectDir(projectPath);
      if (!fs.existsSync(projectDir)) return [];

      const jsonlFiles = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
      const result: Array<{
        sessionId: string;
        preview: string;
        model: string;
        timestamp: string;
        fileModified: number;
      }> = [];

      for (const file of jsonlFiles) {
        const sessionId = file.slice(0, -6);
        const filePath = path.join(projectDir, file);
        const stat = fs.statSync(filePath);
        const preview = extractSessionPreview(filePath);
        if (!preview) continue;

        result.push({
          sessionId,
          preview: preview.firstUserMessage,
          model: preview.model,
          timestamp: preview.timestamp,
          fileModified: stat.mtimeMs,
        });
      }

      result.sort((a, b) => b.fileModified - a.fileModified);
      return result;
    } catch (err) {
      reportError("CC_SESSIONS:LIST_ERR", err);
      return [];
    }
  });

  ipcMain.handle("cc-sessions:import", async (_event, projectPath: string, ccSessionId: string) => {
    try {
      const projectDir = getCCProjectDir(projectPath);
      const filePath = path.join(projectDir, `${ccSessionId}.jsonl`);

      if (!fs.existsSync(filePath)) {
        return { error: "Session file not found" };
      }

      const messages = parseJsonlToUIMessages(filePath);
      return { messages, ccSessionId };
    } catch (err) {
      const errMsg = reportError("CC_SESSIONS:IMPORT_ERR", err);
      return { error: errMsg };
    }
  });
}
