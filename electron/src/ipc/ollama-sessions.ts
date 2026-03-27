import { BrowserWindow, ipcMain } from "electron";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { exec, execFile } from "child_process";
import { safeSend } from "../lib/safe-send";
import { getAppSetting } from "../lib/app-settings";
import { log } from "../lib/logger";
import { triggerIndex, compressConversation } from "../lib/rag/index";
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
  return `You are a coding assistant. You have tools to read/write/edit files. CWD: ${cwd}

HOW IT WORKS:
You output an XML tag → the system executes it → returns the result → you continue.

CRITICAL RULES:
1. You do NOT know any file contents. You MUST call <read_file> to see a file. NEVER write file content from memory — it will be wrong.
2. NEVER say "I cannot" or "I don't have access" — you have all tools.
3. Respond in the SAME language as the user. Portuguese→Portuguese, English→English.
4. When using a tool, output ONLY the XML tag. No other text on the same turn.
5. After getting tool results, answer the user's question or confirm the change.
6. XML tags must be bare text — NEVER inside \`\`\`code blocks\`\`\`.

AVAILABLE TOOLS:
<list_files path="."/>
<read_file path="relative/path"/>
<search_files pattern="text" path="."/>
<write_file path="file">full content here</write_file>
<edit_file path="file">
<<<<<<< SEARCH
exact old text (copy from file)
=======
new replacement text
>>>>>>> REPLACE
</edit_file>
<delete_file path="file"/>
<run_shell command="ls -la"/>

DECISION TREE:
User asks about a file → <read_file path="that file"/>
User asks to change a file → <read_file> first, then <edit_file> with EXACT text from the file
User asks to create a file → <write_file path="new-file">content</write_file>
Don't know what files exist → <list_files path="."/>
Looking for specific code → <search_files pattern="keyword" path="."/>
Need to run a command → <run_shell command="the command"/>
You already have tool results → answer the user's question

EDIT RULES:
The SEARCH block must match the file EXACTLY (same whitespace, same punctuation).
Always <read_file> first to get the exact content, then <edit_file>.
Multiple changes? Use multiple <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks.

EXAMPLE — read:
User: "what's in package.json?"
You: <read_file path="package.json"/>
[system returns file content]
You: The package.json has project "my-app" with React 19...

EXAMPLE — edit:
User: "add a test script to package.json"
You: <read_file path="package.json"/>
[system returns: ..."scripts": { "dev": "vite", "build": "vite build" }...]
You: <edit_file path="package.json">
<<<<<<< SEARCH
    "build": "vite build"
  },
=======
    "build": "vite build",
    "test": "vitest"
  },
>>>>>>> REPLACE
</edit_file>
[system confirms edit]
You: Done! Added "test": "vitest" to scripts.`;
}

// ── Content invention detection ──────────────────────────────────────────────

/**
 * Detect when the model is inventing/hallucinating file content instead of
 * using <read_file>. Common patterns:
 * - Model outputs a code block that looks like file content
 * - Model describes a file's contents without having read it
 * - User asked about a file and model answered without reading
 */
function looksLikeInventedContent(response: string, userMessage: string): boolean {
  // Check if the user asked about a specific file
  const fileRe = /[\w./-]+\.(ts|tsx|js|jsx|mjs|py|go|rs|css|json|md|yaml|yml|gitignore|env|toml|lock)\b/g;
  const userMentionedFiles = userMessage.match(fileRe);
  if (!userMentionedFiles || userMentionedFiles.length === 0) return false;

  // If response contains a code block with 5+ lines, it's likely invented
  const codeBlockRe = /```[\s\S]*?\n([\s\S]{200,}?)\n```/;
  if (codeBlockRe.test(response)) return true;

  // If response contains JSON-like or code-like structure (braces/brackets)
  // and user asked about a file, model is probably inventing
  const hasStructuredContent = (response.match(/[{}[\]]/g) ?? []).length > 6;
  if (hasStructuredContent && response.length > 300) return true;

  return false;
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
  // Strip code fences wrapping tool tags
  text = text.replace(
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
  // Normalize single quotes to double quotes in tool tags so regexes match
  text = text.replace(
    /<(read_file|write_file|edit_file|delete_file|list_files|search_files|run_shell|web_search)\s+([^>]*?)>/g,
    (_match, tag: string, attrs: string) => {
      const normalized = attrs.replace(/='([^']*)'/g, '="$1"');
      return `<${tag} ${normalized}>`;
    },
  );
  return text;
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
    log("OLLAMA_EVENT", `tool:start ${toolName} id=${toolUseId}`);
    safeSend(getMainWindow, "ollama:event", {
      _sessionId: sessionId, type: "tool:start",
      payload: { toolUseId, toolName, input }, _seq: 0,
    });
  }
  function emitToolResult(toolUseId: string, toolName: string, result: Record<string, unknown>) {
    log("OLLAMA_EVENT", `tool:result ${toolName} id=${toolUseId} error=${!!(result as { error?: unknown }).error}`);
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
      // Accept various formats small models produce:
      // <<<<<<< SEARCH / ======= / >>>>>>> REPLACE (standard)
      // <<< SEARCH / === / >>> REPLACE (abbreviated)
      // Also tolerate extra whitespace and missing labels
      const blockRe = /<{3,7}\s*SEARCH\s*\n([\s\S]*?)\n={3,7}\s*\n([\s\S]*?)\n>{3,7}\s*REPLACE/g;
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
      emitToolResult(id, "Glob", { filenames: filtered, numFiles: filtered.length, mode: "files_with_matches" });
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
      emitToolResult(id, "Grep", { filenames: matches, numFiles: matches.length, mode: "files_with_matches" });
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
    const isWebQuery = /\b(pesquise na web|busque na web|search the web|busca online|web search|na internet|on the internet|look up online|pesquisa|pesquisar|buscar)\b/i.test(text);
    const isShellQuery = /\b(rode|execute|run|roda)\s+(o\s+comando|command|cmd|o\s+script)\b/i.test(text);

    try {
      if (isWebQuery) {
        // Web queries: search ourselves and inject results as context.
        // Small models refuse to "search the internet" due to fine-tuning,
        // so we do it for them and ask the model to summarize.
        const searchQuery = text
          .replace(/\b(pesquise na web|busque na web|search the web|busca online|web search|na internet|on the internet|look up online|pesquisa|pesquisar|buscar)\b/gi, "")
          .replace(/\b(sobre|about|for|por|de|do|da)\b/gi, "")
          .trim() || text;
        const searchId = `ollama-web-${crypto.randomUUID().slice(0, 8)}`;
        emit(getMainWindow, sessionId, "tool:start", { toolUseId: searchId, toolName: "WebSearch", input: { query: searchQuery } });
        try {
          const searchResult = await webSearch(searchQuery);
          const formatted = formatWebResults(searchResult);
          log("OLLAMA_WEB", `query="${searchQuery}" results=${searchResult.results.length}`);
          emit(getMainWindow, sessionId, "tool:result", {
            toolUseId: searchId, toolName: "WebSearch",
            result: { query: searchQuery, abstract: searchResult.abstract, abstractUrl: searchResult.abstractUrl, results: searchResult.results },
          });
          session.messages.push({ role: "user", content: text });
          session.messages.push({
            role: "user",
            content: `Web search results for "${searchQuery}":\n\n${formatted}\n\nUsing ONLY the information above, answer the user's question. If the results are insufficient, say so.`,
          });
        } catch (searchErr) {
          log("OLLAMA_WEB", `search failed: ${(searchErr as Error).message}`);
          emit(getMainWindow, sessionId, "tool:result", {
            toolUseId: searchId, toolName: "WebSearch",
            result: { error: (searchErr as Error).message },
          });
          session.messages.push({ role: "user", content: text });
        }
      } else {
        session.messages.push({ role: "user", content: text });
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
          // No tool calls — check if the model is inventing file content
          // instead of using tools (common with small models on first turn)
          if (loopCount === 1 && looksLikeInventedContent(fullText, text)) {
            log("OLLAMA", "model invented content instead of using tools — re-prompting");
            session.messages.push({ role: "assistant", content: fullText });
            emit(getMainWindow, sessionId, "chat:clear-streaming", {});
            session.messages.push({
              role: "user",
              content: "STOP. You are guessing file content. You MUST use <read_file path=\"...\"/> to see real file content. Try again. Output ONLY the XML tag.",
            });
            emit(getMainWindow, sessionId, "lifecycle:start", {});
            continue;
          }
          // This is the final response
          session.messages.push({ role: "assistant", content: fullText });
          emit(getMainWindow, sessionId, "chat:final", { message: fullText });
          break;
        }

        // Tool calls were made — store cleaned text and feed results back
        session.messages.push({ role: "assistant", content: fullText });
        if (cleanedText) {
          // Model wrote text AND used tools — finalize the streaming message
          // but keep isProcessing=true (we're continuing the loop).
          // Use chat:mid-final which doesn't set isProcessing=false.
          emit(getMainWindow, sessionId, "chat:mid-final", { message: cleanedText });
        } else {
          // Model only emitted tool tags with no prose — remove the empty
          // streaming assistant bubble rather than leaving a blank message.
          emit(getMainWindow, sessionId, "chat:clear-streaming", {});
        }

        // Build feedback — compact, direct, includes user's original request.
        const feedbackParts: string[] = ["Tool results:"];
        for (const r of results) {
          feedbackParts.push(r.result);
          if (r.attachment) {
            feedbackParts.push(`\n${r.attachment.path}:\n\`\`\`\n${r.attachment.content}\n\`\`\``);
          }
        }
        // Remind the model of the original request and what to do next
        feedbackParts.push(`\nOriginal request: "${text}"`);
        feedbackParts.push("Now answer or apply the change. If you need to edit, use <edit_file> with EXACT text from above. Respond in the user's language.");

        session.messages.push({ role: "user", content: feedbackParts.join("\n") });

        // Emit lifecycle:start for the next iteration (continuation turn)
        emit(getMainWindow, sessionId, "lifecycle:start", {});
      }

      if (loopCount >= MAX_TOOL_LOOPS) {
        emit(getMainWindow, sessionId, "chat:error", { message: "Limite de chamadas de ferramentas atingido (6 loops)" });
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
