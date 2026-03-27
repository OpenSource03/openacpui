import { BrowserWindow, ipcMain } from "electron";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { exec, execFile } from "child_process";
import { safeSend } from "../lib/safe-send";
import { getAppSetting } from "../lib/app-settings";
import { log } from "../lib/logger";
import { augmentWithRag, triggerIndex, compressConversation } from "../lib/rag/index";
import { webSearch, formatWebResults } from "../lib/rag/web-search";

interface OllamaMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface OllamaSession {
  messages: OllamaMessage[];
  cwd: string;
  model: string;
  abortController: AbortController | null;
}

const sessions = new Map<string, OllamaSession>();

const MAX_FILE_READ_BYTES = 200_000; // 200 KB
const MAX_TOOL_LOOPS = 6; // prevent infinite loops
const MAX_TOOL_OPS = MAX_TOOL_LOOPS * 2;
const MAX_SHELL_OUTPUT_BYTES = 16_000;
const SHELL_TIMEOUT_MS = 15_000;
const MAX_LIST_FILES = 500;
const MAX_SEARCH_MATCHES = 100;
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

// ── System prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(cwd: string): string {
  return `You are an autonomous coding agent. Your responses are machine-parsed — a program reads them and executes any tool tags you emit.

Working directory: ${cwd}

## Tools

The system intercepts these XML tags and executes them. Results are fed back automatically.

<read_file path="relative/path/to/file.ts"/>
→ Returns file contents.

<write_file path="relative/path/to/file.ts">
full file content
</write_file>
→ Creates or overwrites a file.

<edit_file path="relative/path/to/file.ts">
<<<<<<< SEARCH
exact existing text
=======
replacement text
>>>>>>> REPLACE
</edit_file>
→ Replaces exact text blocks. SEARCH must match exactly (whitespace included). Multiple SEARCH/REPLACE blocks allowed per call.

<delete_file path="relative/path/to/file.ts"/>
→ Deletes a file.

<list_files path="relative/path" pattern="optional-substring"/>
→ Lists tracked and unignored files under a path.

<search_files pattern="text to find" path="relative/path"/>
→ Returns files containing the pattern.

<run_shell command="pnpm test --filter foo"/>
→ Runs a shell command in the project and returns stdout/stderr.

<web_search query="react memo typescript example"/>
→ Searches DuckDuckGo and returns results with URLs. Use when you need external docs or API references.

All paths are relative to: ${cwd}

## Behavior rules

- ACT immediately — do NOT explain what you are about to do. Do it.
- NEVER narrate, announce, or describe tool usage. Just emit the tag.
- NEVER say "I will read…", "Let me check…", "I'll now edit…" — skip straight to the tag.
- Chain tool calls: emit multiple tags per response when needed.
- Read a file before editing it so SEARCH blocks match exactly.
- When all work is done, output ONE sentence summarizing what changed. Nothing else.

## CRITICAL — Tag formatting

Tags MUST appear as bare XML in your response. NEVER wrap them in code fences or backticks.

WRONG — will not execute:
\`\`\`xml
<read_file path="src/index.ts"/>
\`\`\`

RIGHT — executes immediately:
<read_file path="src/index.ts"/>`;
}

// ── Tool execution ─────────────────────────────────────────────────────────────

function safePath(cwd: string, relPath: string): string | null {
  const abs = path.resolve(cwd, relPath);
  if (!abs.startsWith(cwd + path.sep) && abs !== cwd) return null;
  return abs;
}

interface ToolResult {
  toolName: string;
  input: Record<string, unknown>;
  result: string;
  attachment?: { path: string; content: string };
}

function stripCodeFencedToolTags(text: string): string {
  return text.replace(
    /```(?:xml|html|plaintext)?\s*\n([\s\S]*?)\n```/g,
    (_match, inner: string) => {
      const trimmed = inner.trim();
      if (
        /^<(read_file|write_file|edit_file|delete_file|list_files|search_files|run_shell|web_search)\b/.test(trimmed)
      ) {
        return trimmed;
      }
      return _match;
    },
  );
}

function trimOutput(text: string, max = MAX_SHELL_OUTPUT_BYTES): string {
  return text.length > max ? `${text.slice(0, max)}\n...` : text;
}

function listFilesGit(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout.trim().split("\n").filter(Boolean).sort());
    });
  });
}

function runShell(command: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: SHELL_TIMEOUT_MS, maxBuffer: MAX_SHELL_OUTPUT_BYTES }, (err, stdout, stderr) => {
      const exitCode = typeof err?.code === "number" ? err.code : err ? 1 : 0;
      resolve({
        stdout: trimOutput(stdout),
        stderr: trimOutput(stderr),
        exitCode,
      });
    });
  });
}

function searchFiles(pattern: string, cwd: string, relPath: string): Promise<string[]> {
  const resolved = path.resolve(cwd, relPath || ".");
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    return Promise.reject(new Error("path outside project"));
  }
  return listFilesGit(cwd).then((files) => {
    const normalizedBase = relPath === "." ? "" : `${relPath.replace(/\/$/, "")}/`;
    const matches: string[] = [];
    for (const file of files) {
      if (normalizedBase && file !== relPath && !file.startsWith(normalizedBase)) {
        continue;
      }
      const abs = safePath(cwd, file);
      if (!abs) continue;
      try {
        const stat = fs.statSync(abs);
        if (!stat.isFile() || stat.size > MAX_FILE_READ_BYTES) continue;
        const content = fs.readFileSync(abs, "utf-8");
        if (content.includes(pattern)) {
          matches.push(file);
        }
      } catch {
      }
      if (matches.length >= MAX_SEARCH_MATCHES) break;
    }
    return matches;
  });
}

async function executeToolTags(
  fullText: string,
  cwd: string,
  getMainWindow: () => BrowserWindow | null,
  sessionId: string,
): Promise<{ results: ToolResult[]; cleanedText: string }> {
  fullText = stripCodeFencedToolTags(fullText);

  const results: ToolResult[] = [];
  const processed = new Set<string>();
  let ops = 0;

  function emitToolStart(toolUseId: string, toolName: string, input: Record<string, unknown>) {
    safeSend(getMainWindow, "ollama:event", {
      _sessionId: sessionId, type: "tool:start",
      payload: { toolUseId, toolName, input }, _seq: 0,
    });
  }
  function emitToolResult(toolUseId: string, toolName: string, result: Record<string, unknown>) {
    safeSend(getMainWindow, "ollama:event", {
      _sessionId: sessionId, type: "tool:result",
      payload: { toolUseId, toolName, result }, _seq: 0,
    });
  }

  const readRe = /<read_file\s+path="([^"]+)"\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = readRe.exec(fullText)) !== null) {
    const rel = m[1];
    const key = `read:${rel}`;
    if (processed.has(key) || ops >= MAX_TOOL_OPS) continue;
    processed.add(key); ops++;
    const id = `ollama-read-${crypto.randomUUID().slice(0, 8)}`;
    emitToolStart(id, "Read", { file_path: rel });
    const abs = safePath(cwd, rel);
    if (!abs) {
      const r = "Error: path outside project";
      results.push({ toolName: "Read", input: { file_path: rel }, result: `Read ${rel}: ${r}` });
      emitToolResult(id, "Read", { error: r });
      continue;
    }
    try {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_FILE_READ_BYTES) {
        const r = `file too large (${stat.size} bytes, max ${MAX_FILE_READ_BYTES})`;
        results.push({ toolName: "Read", input: { file_path: rel }, result: `Read ${rel}: ${r}` });
        emitToolResult(id, "Read", { error: r });
        continue;
      }
      const content = fs.readFileSync(abs, "utf-8");
      log("OLLAMA_TOOL", `read_file ${rel} (${stat.size} bytes)`);
      results.push({
        toolName: "Read", input: { file_path: rel },
        result: `Read ${rel}: OK (${stat.size} bytes)`,
        attachment: { path: rel, content },
      });
      emitToolResult(id, "Read", { content: content.slice(0, 300) + (content.length > 300 ? "\n..." : "") });
    } catch {
      const r = "file not found";
      results.push({ toolName: "Read", input: { file_path: rel }, result: `Read ${rel}: ${r}` });
      emitToolResult(id, "Read", { error: r });
    }
  }

  const writeRe = /<write_file\s+path="([^"]+)">([\s\S]*?)<\/write_file>/g;
  while ((m = writeRe.exec(fullText)) !== null) {
    const rel = m[1];
    const key = `write:${rel}`;
    if (processed.has(key) || ops >= MAX_TOOL_OPS) continue;
    processed.add(key); ops++;
    const content = m[2].replace(/^\n/, "");
    const id = `ollama-write-${crypto.randomUUID().slice(0, 8)}`;
    emitToolStart(id, "Write", { file_path: rel });
    const abs = safePath(cwd, rel);
    if (!abs) {
      const r = "path outside project";
      results.push({ toolName: "Write", input: { file_path: rel }, result: `Write ${rel}: ${r}` });
      emitToolResult(id, "Write", { error: r });
      continue;
    }
    try {
      const dir = path.dirname(abs);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(abs, content, "utf-8");
      log("OLLAMA_TOOL", `write_file ${rel} (${content.length} chars)`);
      results.push({ toolName: "Write", input: { file_path: rel }, result: `Write ${rel}: OK (${content.length} bytes)` });
      emitToolResult(id, "Write", { status: "ok", bytesWritten: content.length });
    } catch (err) {
      const r = (err as Error).message;
      results.push({ toolName: "Write", input: { file_path: rel }, result: `Write ${rel}: ${r}` });
      emitToolResult(id, "Write", { error: r });
    }
  }

  const editRe = /<edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/g;
  while ((m = editRe.exec(fullText)) !== null) {
    const rel = m[1];
    const key = `edit:${rel}`;
    if (processed.has(key) || ops >= MAX_TOOL_OPS) continue;
    processed.add(key); ops++;
    const body = m[2];
    const id = `ollama-edit-${crypto.randomUUID().slice(0, 8)}`;
    const abs = safePath(cwd, rel);
    if (!abs) {
      emitToolStart(id, "Edit", { file_path: rel });
      const r = "path outside project";
      results.push({ toolName: "Edit", input: { file_path: rel }, result: `Edit ${rel}: ${r}` });
      emitToolResult(id, "Edit", { error: r });
      continue;
    }
    try {
      let fileContent = fs.readFileSync(abs, "utf-8");
      const blockRe = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
      let bm: RegExpExecArray | null;
      let replacements = 0;
      const oldParts: string[] = [];
      const newParts: string[] = [];
      while ((bm = blockRe.exec(body)) !== null) {
        const search = bm[1];
        const replace = bm[2];
        if (fileContent.includes(search)) {
          fileContent = fileContent.replace(search, replace);
          oldParts.push(search);
          newParts.push(replace);
          replacements++;
        }
      }
      if (replacements > 0) {
        fs.writeFileSync(abs, fileContent, "utf-8");
        const oldStr = oldParts.join("\n...\n");
        const newStr = newParts.join("\n...\n");
        emitToolStart(id, "Edit", { file_path: rel, old_string: oldStr, new_string: newStr });
        log("OLLAMA_TOOL", `edit_file ${rel} (${replacements} replacements)`);
        results.push({ toolName: "Edit", input: { file_path: rel }, result: `Edit ${rel}: OK (${replacements} replacement${replacements > 1 ? "s" : ""})` });
        emitToolResult(id, "Edit", { status: "ok", replacements, oldString: oldStr, newString: newStr, filePath: rel });
      } else {
        emitToolStart(id, "Edit", { file_path: rel });
        results.push({ toolName: "Edit", input: { file_path: rel }, result: `Edit ${rel}: no matching SEARCH blocks found — read the file first to get exact content` });
        emitToolResult(id, "Edit", { error: "no matching blocks" });
      }
    } catch (err) {
      emitToolStart(id, "Edit", { file_path: rel });
      const r = (err as Error).message;
      results.push({ toolName: "Edit", input: { file_path: rel }, result: `Edit ${rel}: ${r}` });
      emitToolResult(id, "Edit", { error: r });
    }
  }

  const deleteRe = /<delete_file\s+path="([^"]+)"\s*\/>/g;
  while ((m = deleteRe.exec(fullText)) !== null) {
    const rel = m[1];
    const key = `delete:${rel}`;
    if (processed.has(key) || ops >= MAX_TOOL_OPS) continue;
    processed.add(key); ops++;
    const id = `ollama-delete-${crypto.randomUUID().slice(0, 8)}`;
    emitToolStart(id, "Delete", { file_path: rel });
    const abs = safePath(cwd, rel);
    if (!abs) {
      const r = "path outside project";
      results.push({ toolName: "Delete", input: { file_path: rel }, result: `Delete ${rel}: ${r}` });
      emitToolResult(id, "Delete", { error: r });
      continue;
    }
    try {
      fs.unlinkSync(abs);
      log("OLLAMA_TOOL", `delete_file ${rel}`);
      results.push({ toolName: "Delete", input: { file_path: rel }, result: `Delete ${rel}: OK` });
      emitToolResult(id, "Delete", { status: "ok" });
    } catch (err) {
      const r = (err as Error).message;
      results.push({ toolName: "Delete", input: { file_path: rel }, result: `Delete ${rel}: ${r}` });
      emitToolResult(id, "Delete", { error: r });
    }
  }

  const listRe = /<list_files(?:\s+path="([^"]+)")?(?:\s+pattern="([^"]+)")?\s*\/>/g;
  while ((m = listRe.exec(fullText)) !== null) {
    const rel = m[1] || ".";
    const pattern = m[2] || "";
    const key = `list:${rel}:${pattern}`;
    if (processed.has(key) || ops >= MAX_TOOL_OPS) continue;
    processed.add(key); ops++;
    const id = `ollama-glob-${crypto.randomUUID().slice(0, 8)}`;
    emitToolStart(id, "Glob", { path: rel, pattern });
    try {
      const files = await listFilesGit(cwd);
      const normalizedBase = rel === "." ? "" : `${rel.replace(/\/$/, "")}/`;
      const filtered = files
        .filter((file) => !normalizedBase || file === rel || file.startsWith(normalizedBase))
        .filter((file) => !pattern || file.includes(pattern.replace(/\*/g, "")))
        .slice(0, MAX_LIST_FILES);
      results.push({
        toolName: "Glob",
        input: { path: rel, pattern },
        result: `List ${rel}: OK (${filtered.length} file${filtered.length === 1 ? "" : "s"})`,
      });
      emitToolResult(id, "Glob", { files: filtered });
    } catch (err) {
      const error = (err as Error).message;
      results.push({ toolName: "Glob", input: { path: rel, pattern }, result: `List ${rel}: ${error}` });
      emitToolResult(id, "Glob", { error });
    }
  }

  const searchRe = /<search_files\s+pattern="([^"]+)"(?:\s+path="([^"]+)")?\s*\/>/g;
  while ((m = searchRe.exec(fullText)) !== null) {
    const pattern = m[1];
    const rel = m[2] || ".";
    const key = `search:${rel}:${pattern}`;
    if (processed.has(key) || ops >= MAX_TOOL_OPS) continue;
    processed.add(key); ops++;
    const id = `ollama-grep-${crypto.randomUUID().slice(0, 8)}`;
    emitToolStart(id, "Grep", { pattern, path: rel });
    try {
      const matches = await searchFiles(pattern, cwd, rel);
      results.push({
        toolName: "Grep",
        input: { pattern, path: rel },
        result: `Search ${pattern} in ${rel}: OK (${matches.length} match${matches.length === 1 ? "" : "es"})`,
      });
      emitToolResult(id, "Grep", { matches, mode: "files_with_matches" });
    } catch (err) {
      const error = (err as Error).message;
      results.push({ toolName: "Grep", input: { pattern, path: rel }, result: `Search ${pattern} in ${rel}: ${error}` });
      emitToolResult(id, "Grep", { error });
    }
  }

  const webSearchRe = /<web_search\s+query="([^"]+)"\s*\/>/g;
  while ((m = webSearchRe.exec(fullText)) !== null) {
    const query = m[1];
    const key = `web:${query}`;
    if (processed.has(key) || ops >= MAX_TOOL_OPS) continue;
    processed.add(key); ops++;
    const id = `ollama-web-${crypto.randomUUID().slice(0, 8)}`;
    emitToolStart(id, "WebSearch", { query });
    try {
      const searchResult = await webSearch(query);
      const formatted = formatWebResults(searchResult);
      log("OLLAMA_TOOL", `web_search "${query}" (${searchResult.results.length} results)`);
      results.push({ toolName: "WebSearch", input: { query }, result: formatted });
      emitToolResult(id, "WebSearch", {
        query,
        abstract: searchResult.abstract,
        abstractUrl: searchResult.abstractUrl,
        results: searchResult.results,
      });
    } catch (err) {
      const error = (err as Error).message;
      results.push({ toolName: "WebSearch", input: { query }, result: `Web search failed: ${error}` });
      emitToolResult(id, "WebSearch", { error });
    }
  }

  const shellRe = /<run_shell\s+command="([^"]+)"\s*\/>/g;
  while ((m = shellRe.exec(fullText)) !== null) {
    const command = m[1];
    const key = `shell:${command}`;
    if (processed.has(key) || ops >= MAX_TOOL_OPS) continue;
    processed.add(key); ops++;
    const id = `ollama-bash-${crypto.randomUUID().slice(0, 8)}`;
    emitToolStart(id, "Bash", { command });
    const shellResult = await runShell(command, cwd);
    const summary = `Shell ${command}: exit ${shellResult.exitCode}`;
    results.push({
      toolName: "Bash",
      input: { command },
      result: [summary, shellResult.stdout, shellResult.stderr].filter(Boolean).join("\n"),
    });
    emitToolResult(id, "Bash", {
      stdout: shellResult.stdout,
      stderr: shellResult.stderr,
      exitCode: shellResult.exitCode,
      output: [shellResult.stdout, shellResult.stderr].filter(Boolean).join("\n"),
    });
  }

  let cleanedText = fullText
    .replace(/<read_file\s+path="[^"]+"\s*\/>/g, "")
    .replace(/<write_file\s+path="[^"]+">([\s\S]*?)<\/write_file>/g, "")
    .replace(/<edit_file\s+path="[^"]+">([\s\S]*?)<\/edit_file>/g, "")
    .replace(/<delete_file\s+path="[^"]+"\s*\/>/g, "")
    .replace(/<list_files(?:\s+path="[^"]+")?(?:\s+pattern="[^"]+")?\s*\/>/g, "")
    .replace(/<search_files\s+pattern="[^"]+"(?:\s+path="[^"]+")?\s*\/>/g, "")
    .replace(/<run_shell\s+command="[^"]+"\s*\/>/g, "")
    .replace(/<web_search\s+query="[^"]+"\s*\/>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { results, cleanedText };
}

// ── Streaming helper ───────────────────────────────────────────────────────────

async function streamOllamaResponse(
  session: OllamaSession,
  controller: AbortController,
  getMainWindow: () => BrowserWindow | null,
  sessionId: string,
): Promise<string> {
  const response = await fetch(`${getBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: session.model,
      messages: compressConversation(session.messages),
      stream: true,
      temperature: 0.1,
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(errText);
  }
  if (!response.body) throw new Error("No response body from Ollama");

  const reader = (response.body as unknown as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let sseBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";

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

  return fullText;
}

// ── IPC registration ───────────────────────────────────────────────────────────

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("ollama:start", async (_event, { cwd, model }: { cwd: string; model?: string }) => {
    const sessionId = crypto.randomUUID();
    const sessionModel = model || getDefaultModel();
    sessions.set(sessionId, {
      messages: [{ role: "system", content: buildSystemPrompt(cwd) }],
      cwd,
      model: sessionModel,
      abortController: null,
    });

    // Start indexing the project in background (non-blocking)
    // Index will be ready by the time the user sends a message
    triggerIndex(cwd);

    return { sessionId, model: sessionModel };
  });

  ipcMain.handle("ollama:send", async (_event, { sessionId, text }: { sessionId: string; text: string }) => {
    const session = sessions.get(sessionId);
    if (!session) return { error: "Session not found" };

    // ── RAG augmentation ──────────────────────────────────────────────────────
    // Two strategies depending on intent:
    //
    //  EXPLAIN/SEARCH/GENERAL → single augmented user message with file
    //    content between clear separators. Small models follow single-turn
    //    context reliably and ignore injected multi-turn history.
    //
    //  EDIT/FIX/REFACTOR → simulated tool turns (model "already read" files)
    //    so it produces structured edit_file output.
    //
    // If no context found → plain message, model explores via tools.
    try {
      const rag = await augmentWithRag(text, session.cwd);

      // Push original user message then inject simulated tool-result turns.
      // The model sees: user asked → it "read" the files → has real content.
      // This works for any language — the model decides whether to explain
      // or apply changes based on what the user actually asked.
      session.messages.push({ role: "user", content: text });
      for (const turn of rag.injectedTurns ?? []) {
        session.messages.push(turn);
      }

      if (rag.contextFileCount > 0) {
        emit(getMainWindow, sessionId, "rag:context", {
          fileCount: rag.contextFileCount,
          intent: rag.intent.type,
        });
        log("RAG", `files=${rag.contextFileCount} intent=${rag.intent.type}`);
      }
    } catch (err) {
      // Best-effort — never crash the session
      log("RAG", `failed, using plain message: ${(err as Error).message}`);
      session.messages.push({ role: "user", content: text });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const controller = new AbortController();
    session.abortController = controller;

    emit(getMainWindow, sessionId, "lifecycle:start", {});

    try {
      let loopCount = 0;

      while (loopCount < MAX_TOOL_LOOPS) {
        loopCount++;

        const fullText = await streamOllamaResponse(session, controller, getMainWindow, sessionId);

        // Parse and execute any tool tags in the response
        const { results, cleanedText } = await executeToolTags(fullText, session.cwd, getMainWindow, sessionId);

        if (results.length === 0) {
          // No tool calls — this is the final response
          session.messages.push({ role: "assistant", content: fullText });
          emit(getMainWindow, sessionId, "chat:final", { message: fullText });
          break;
        }

        // Tool calls were made — store cleaned text and feed results back
        session.messages.push({ role: "assistant", content: fullText });
        emit(getMainWindow, sessionId, "chat:final", { message: cleanedText });

        // Build feedback message with file contents for reads
        const feedbackParts: string[] = ["Tool results:"];
        for (const r of results) {
          feedbackParts.push(r.result);
          if (r.attachment) {
            feedbackParts.push(`\nContents of ${r.attachment.path}:\n\`\`\`\n${r.attachment.content}\n\`\`\``);
          }
        }
        feedbackParts.push("\nContinue working silently — emit the next tool tag, or output a one-sentence summary if the task is fully done.");

        session.messages.push({ role: "user", content: feedbackParts.join("\n") });

        // Emit lifecycle:start for the next iteration (continuation turn)
        emit(getMainWindow, sessionId, "lifecycle:start", {});
      }

      if (loopCount >= MAX_TOOL_LOOPS) {
        emit(getMainWindow, sessionId, "chat:error", { message: "Maximum tool loop depth reached" });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        const last = [...session.messages].reverse().find((m) => m.role === "assistant");
        emit(getMainWindow, sessionId, "chat:final", { message: last?.content ?? "" });
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
