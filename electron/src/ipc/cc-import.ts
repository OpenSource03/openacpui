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

/**
 * Schema of the per-cwd index file Claude Code maintains under
 * `~/.claude/projects/{cwdHash}/sessions-index.json`. We treat every field as
 * best-effort — older CLI versions may omit some, and the file is a CLI
 * implementation detail that could change between releases. The reader below
 * validates each entry and skips anything that doesn't have the bare minimum
 * (a sessionId).
 */
interface CCSessionIndexEntry {
  sessionId?: unknown;
  fullPath?: unknown;
  fileMtime?: unknown;
  firstPrompt?: unknown;
  summary?: unknown;
  messageCount?: unknown;
  created?: unknown;
  modified?: unknown;
  gitBranch?: unknown;
  projectPath?: unknown;
  isSidechain?: unknown;
}

interface CCSessionIndexFile {
  version?: unknown;
  entries?: unknown;
}

/** Flat shape returned to the renderer. One entry per session file. */
interface AllSessionsEntry {
  sessionId: string;
  cwdHash: string;
  projectPath: string | null;
  firstPrompt: string | null;
  summary: string | null;
  messageCount: number | null;
  modified: number;
  created: number | null;
  gitBranch: string | null;
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

/**
 * Extract the working directory recorded in a Claude Code JSONL session file.
 *
 * Claude Code writes `cwd` into every session event; we return the first one
 * we find. The enclosing directory name under ~/.claude/projects/ is derived
 * from cwd by replacing "/" with "-", but that transform is lossy (paths that
 * already contain "-" round-trip ambiguously), so we always read the cwd
 * straight out of the JSONL instead of parsing the dir name.
 */
function extractCwdFromJsonl(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    let scanned = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      if (scanned++ > 50) break;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.cwd === "string" && obj.cwd) return obj.cwd;
      } catch {
        continue;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Coerce a CLI-written timestamp to epoch ms. CLI versions disagree on
 * whether `modified`/`created` are ISO strings or numeric epochs, so we
 * accept both shapes. Returns null when the value is missing or unparseable.
 */
function parseTs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Single-pass cwd + first-user-message reader used by the fallback path of
 * `cc-sessions:list-all`. Scans up to 100 lines once per file instead of the
 * old extractSessionPreview + extractCwdFromJsonl pair, which read the same
 * file twice — costly when a cwd has hundreds of large transcripts and the
 * sessions-index.json is missing/malformed. Stays async + non-blocking so
 * Promise.all over many files actually overlaps the disk reads instead of
 * pinning the main process.
 */
async function extractSessionMeta(filePath: string): Promise<{
  cwd: string | null;
  firstUserMessage: string | null;
  isSidechain: boolean;
}> {
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    let cwd: string | null = null;
    let firstUserMessage: string | null = null;
    let isSidechain = false;
    let scanned = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      if (scanned++ > 100) break;
      try {
        const obj = JSON.parse(line);
        if (!cwd && typeof obj.cwd === "string" && obj.cwd) cwd = obj.cwd;
        // Any line tagged as sidechain marks the whole transcript — CLI
        // doesn't mix main + sub-agent in one file, so the first hit is
        // enough.
        if (!isSidechain && isTruthyFlag(obj.isSidechain)) isSidechain = true;
        if (
          !firstUserMessage &&
          obj.type === "user" &&
          !obj.isMeta &&
          !obj.isSidechain &&
          typeof obj.message?.content === "string" &&
          obj.message.content.trim()
        ) {
          const raw = obj.message.content.trim();
          firstUserMessage = raw.length > 80 ? raw.slice(0, 77) + "..." : raw;
        }
        if (cwd && firstUserMessage && isSidechain) break;
      } catch {
        continue;
      }
    }
    return { cwd, firstUserMessage, isSidechain };
  } catch {
    return { cwd: null, firstUserMessage: null, isSidechain: false };
  }
}

/**
 * Schema-drift-tolerant truthy check. CLI typically writes `isSidechain: true`
 * but historic dumps and adjacent tools have used `"true"`/`"1"`/`1`/`"TRUE"`
 * — accept all of them so sub-agent transcripts never sneak into the
 * resumable list.
 */
function isTruthyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1";
  }
  return false;
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

  /**
   * List every Claude Code session across every project the user has touched.
   *
   * Reads `~/.claude/projects/* /sessions-index.json` (CLI's own session
   * index) and flattens the entries into a single list. Falls back per-cwd to
   * scanning `.jsonl` files when the index is missing — older CLI versions or
   * fresh installs may not have written one yet.
   *
   * Sidechain sessions (subagent transcripts) are filtered out — they aren't
   * directly resumable.
   */
  ipcMain.handle("cc-sessions:list-all", async () => {
    try {
      const root = path.join(os.homedir(), ".claude", "projects");
      if (!fs.existsSync(root)) return [];

      const subdirs = await fs.promises.readdir(root, { withFileTypes: true });
      const all: AllSessionsEntry[] = [];

      for (const dir of subdirs) {
        if (!dir.isDirectory()) continue;
        const cwdHash = dir.name;
        const dirPath = path.join(root, cwdHash);
        const indexPath = path.join(dirPath, "sessions-index.json");

        let usedIndex = false;
        if (fs.existsSync(indexPath)) {
          try {
            const raw = await fs.promises.readFile(indexPath, "utf-8");
            const parsed = JSON.parse(raw) as CCSessionIndexFile;
            // Only treat the index as authoritative when its `entries` is the
            // expected array shape. Anything else (missing key, schema drift,
            // wrong type) falls through to the JSONL scan so we still surface
            // the cwd's sessions instead of silently dropping it.
            if (Array.isArray(parsed.entries)) {
              // The index can outlive the JSONL files (CLI deletes the .jsonl
              // but doesn't always rewrite the index). Build a one-time set of
              // present session ids per cwd so we can skip stale entries
              // without a per-row stat.
              let presentIds: Set<string>;
              try {
                const files = await fs.promises.readdir(dirPath);
                presentIds = new Set(
                  files.filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)),
                );
              } catch {
                presentIds = new Set();
              }

              for (const e of parsed.entries as CCSessionIndexEntry[]) {
                if (typeof e.sessionId !== "string" || !e.sessionId) continue;
                // Defensive: CLI typically writes a boolean, but accept any
                // truthy string/number form too so a schema-shift can't leak
                // sidechain transcripts into the resumable list.
                if (isTruthyFlag(e.isSidechain)) continue;
                if (!presentIds.has(e.sessionId)) continue;

                // Accept either type for both fields — older CLI versions
                // wrote epoch numbers into `modified`, newer write ISO; same
                // story for `fileMtime`. Convert string→ms via Date.parse.
                const modifiedNum = parseTs(e.modified) ?? parseTs(e.fileMtime);
                if (modifiedNum === null) continue;

                const createdNum = parseTs(e.created);

                all.push({
                  sessionId: e.sessionId,
                  cwdHash,
                  projectPath: typeof e.projectPath === "string" ? e.projectPath : null,
                  firstPrompt: typeof e.firstPrompt === "string" ? e.firstPrompt : null,
                  summary: typeof e.summary === "string" && e.summary ? e.summary : null,
                  messageCount: typeof e.messageCount === "number" ? e.messageCount : null,
                  modified: modifiedNum,
                  created: createdNum,
                  gitBranch: typeof e.gitBranch === "string" && e.gitBranch ? e.gitBranch : null,
                });
              }
              usedIndex = true;
            }
          } catch {
            // Malformed index — fall through to jsonl scan below.
          }
        }

        if (usedIndex) continue;

        // Fallback: no/broken index, scan .jsonl files directly. We do a
        // single bounded read per file (extractSessionMeta) to grab cwd +
        // first-prompt in one pass — the previous version called
        // extractSessionPreview AND extractCwdFromJsonl, which read the same
        // file twice and could freeze the IPC for users with hundreds of
        // sessions sharing a broken index. We also stat in parallel so the
        // dir scan doesn't serialize on disk latency.
        try {
          const files = (await fs.promises.readdir(dirPath)).filter((f) => f.endsWith(".jsonl"));
          const rows = await Promise.all(
            files.map(async (f) => {
              const sessionId = f.slice(0, -6);
              const filePath = path.join(dirPath, f);
              try {
                const [stat, meta] = await Promise.all([
                  fs.promises.stat(filePath),
                  extractSessionMeta(filePath),
                ]);
                if (meta.isSidechain) return null;
                return {
                  sessionId,
                  cwdHash,
                  projectPath: meta.cwd,
                  firstPrompt: meta.firstUserMessage,
                  summary: null as string | null,
                  messageCount: null as number | null,
                  modified: stat.mtimeMs,
                  created: null as number | null,
                  gitBranch: null as string | null,
                } satisfies AllSessionsEntry;
              } catch {
                return null;
              }
            }),
          );
          for (const r of rows) if (r) all.push(r);
        } catch {
          continue;
        }
      }

      all.sort((a, b) => b.modified - a.modified);
      return all;
    } catch (err) {
      reportError("CC_SESSIONS:LIST_ALL_ERR", err);
      return [];
    }
  });

  /**
   * Find a Claude Code session across every project by its sessionId.
   * Returns the cwd recorded in the JSONL + a preview so the renderer can
   * route the import to the right Harnss project (creating one if needed).
   */
  ipcMain.handle("cc-sessions:find-by-id", async (_event, sessionId: string) => {
    try {
      const trimmed = sessionId.trim();
      if (!trimmed) return { error: "Empty session id" };
      // Path-traversal guard: CC session ids are UUID v4. Reject anything
      // that doesn't match the canonical shape so we never construct a
      // `path.join(root, dir, "../something.jsonl")` from user input.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
        return { error: "Not a valid Claude Code session id (expected UUID)" };
      }

      const root = path.join(os.homedir(), ".claude", "projects");
      if (!fs.existsSync(root)) return { found: false };

      const subdirs = await fs.promises.readdir(root, { withFileTypes: true });
      for (const entry of subdirs) {
        if (!entry.isDirectory()) continue;
        const filePath = path.join(root, entry.name, `${trimmed}.jsonl`);
        if (!fs.existsSync(filePath)) continue;

        const cwd = extractCwdFromJsonl(filePath);
        const preview = extractSessionPreview(filePath);
        return {
          found: true,
          ccSessionId: trimmed,
          cwd,
          // Fallback is LOSSY: reversing "/" ↔ "-" collapses any real "-" in
          // the path. We return it only when the JSONL has no cwd field, and
          // flag it so the UI can warn the user that the auto-resolved path
          // may be wrong.
          cwdFallbackFromDirName: cwd ? undefined : entry.name.replace(/-/g, "/"),
          cwdIsApproximate: !cwd,
          preview: preview?.firstUserMessage ?? null,
          model: preview?.model ?? null,
          timestamp: preview?.timestamp ?? null,
        };
      }

      return { found: false };
    } catch (err) {
      const errMsg = reportError("CC_SESSIONS:FIND_BY_ID_ERR", err, { sessionId });
      return { error: errMsg };
    }
  });
}
