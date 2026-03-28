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
import { filterFiles } from "../lib/harnssignore";

interface OllamaMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface SessionState {
  filesRead: string[];
  filesModified: string[];
  filesCreated: string[];
  originalRequest: string;
  toolCallCount: number;
  recentToolSignatures: string[];
  pendingPages: Map<string, string[]>;
}

interface OllamaSession {
  messages: OllamaMessage[];
  cwd: string;
  model: string;
  contextSize: number;
  abortController: AbortController | null;
  state: SessionState;
}

const sessions = new Map<string, OllamaSession>();

const MAX_FILE_READ_BYTES = 200_000;
const LOOP_WARN_THRESHOLD = 6;
const MAX_TOOL_LOOPS = 12;
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

const PAGE_SIZE = 50;
const TREE_COLLAPSE_THRESHOLD = 30;

function filesToTree(files: string[]): string {
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const lastSlash = file.lastIndexOf("/");
    const dir = lastSlash === -1 ? "." : file.slice(0, lastSlash);
    const name = file.slice(lastSlash + 1);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(name);
  }

  const lines: string[] = [];

  const groupByExt = (names: string[]): string[] => {
    const extMap = new Map<string, string[]>();
    for (const name of names.sort()) {
      const dotIdx = name.lastIndexOf(".");
      const ext = dotIdx !== -1 ? name.slice(dotIdx) : "";
      const base = dotIdx !== -1 ? name.slice(0, dotIdx) : name;
      if (!extMap.has(ext)) extMap.set(ext, []);
      extMap.get(ext)!.push(base);
    }
    const parts: string[] = [];
    for (const [ext, bases] of extMap) {
      if (bases.length === 1) {
        parts.push(`${bases[0]}${ext}`);
      } else {
        parts.push(`[${bases.join(",")}]${ext}`);
      }
    }
    return parts;
  };

  const mergeDirs = (dirs: string[]): Map<string, string[]> => {
    const parentMap = new Map<string, Map<string, string[]>>();
    for (const dir of dirs) {
      const lastSlash = dir.lastIndexOf("/");
      if (lastSlash === -1) continue;
      const parent = dir.slice(0, lastSlash);
      const child = dir.slice(lastSlash + 1);
      const childFiles = byDir.get(dir)!;
      if (childFiles.length === 1 && childFiles[0] === "index.ts") {
        if (!parentMap.has(parent)) parentMap.set(parent, new Map());
        const pm = parentMap.get(parent)!;
        if (!pm.has("index.ts")) pm.set("index.ts", []);
        pm.get("index.ts")!.push(child);
      }
    }
    return new Map([...parentMap.entries()].filter(([, v]) => v.size > 0).map(([k, v]) => [k, [...v.values()].flat()]));
  };

  const sortedDirs = [...byDir.keys()].sort();
  const indexOnlyDirs = mergeDirs(sortedDirs);
  const rendered = new Set<string>();

  for (const dir of sortedDirs) {
    if (rendered.has(dir)) continue;
    const names = byDir.get(dir)!;

    const parentMerge = [...indexOnlyDirs.entries()].find(([parent]) => dir.startsWith(parent + "/") || dir === parent);
    if (parentMerge) {
      const [parent, children] = parentMerge;
      if (dir !== parent && names.length === 1 && names[0] === "index.ts") {
        continue;
      }
    }

    if (indexOnlyDirs.has(dir)) {
      const children = indexOnlyDirs.get(dir)!;
      const remaining = names.filter((n) => n !== "index.ts" || !children.includes(dir.split("/").pop()!));
      if (remaining.length > 0) {
        lines.push(`${dir}/ ${groupByExt(remaining).join(", ")}`);
      }
      lines.push(`${dir}/[${children.sort().join(",")}]/index.ts`);
      for (const child of children) {
        rendered.add(`${dir}/${child}`);
      }
    } else {
      const grouped = groupByExt(names);
      lines.push(dir === "." ? grouped.join(", ") : `${dir}/ ${grouped.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("Expand [a,b,c] to get individual paths. Example: src/[foo,bar].ts = src/foo.ts, src/bar.ts");
  return lines.join("\n");
}

function estimateTokens(messages: OllamaMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += m.content.length;
  return Math.ceil(chars / 4);
}

async function fetchModelContextSize(model: string): Promise<number> {
  try {
    const response = await fetch(`${getBaseUrl()}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      log("OLLAMA", `api/show HTTP ${response.status} for ${model}, using default 32768`);
      return 32768;
    }
    const data = (await response.json()) as { model_info?: Record<string, unknown>; parameters?: string };
    if (data.model_info) {
      for (const [key, val] of Object.entries(data.model_info)) {
        if (key.endsWith(".context_length") && typeof val === "number" && val > 0) {
          log("OLLAMA", `model ${model} ${key}=${val} (from api/show)`);
          return val;
        }
      }
    }
    const numCtxMatch = data.parameters?.match(/num_ctx\s+(\d+)/);
    if (numCtxMatch) {
      const numCtx = parseInt(numCtxMatch[1]);
      log("OLLAMA", `model ${model} num_ctx=${numCtx} (from parameters)`);
      return numCtx;
    }
    log("OLLAMA", `model ${model} no context_length in api/show, using default 32768`);
  } catch (err) {
    log("OLLAMA", `fetchModelContextSize failed: ${(err as Error).message}, using default 32768`);
  }
  return 32768;
}

function emitContextUsage(
  getMainWindow: () => BrowserWindow | null,
  sessionId: string,
  session: OllamaSession,
): void {
  const used = estimateTokens(session.messages);
  emit(getMainWindow, sessionId, "context:usage", { used, limit: session.contextSize });
}

function freshState(): SessionState {
  return { filesRead: [], filesModified: [], filesCreated: [], originalRequest: "", toolCallCount: 0, recentToolSignatures: [], pendingPages: new Map() };
}

function toolSignature(requests: ToolRequest[]): string {
  return requests.map((r) => `${r.tool}:${r.path ?? r.command ?? r.query ?? r.pattern ?? ""}`).sort().join("|");
}

function detectLoop(state: SessionState, requests: ToolRequest[]): boolean {
  const sig = toolSignature(requests);
  state.recentToolSignatures.push(sig);
  if (state.recentToolSignatures.length > 6) {
    state.recentToolSignatures.shift();
  }
  const recent = state.recentToolSignatures;
  if (recent.length < 3) return false;
  const last3 = recent.slice(-3);
  return last3[0] === last3[1] && last3[1] === last3[2];
}

// ── System prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(cwd: string): string {
  return `You are a coding assistant. CWD: ${cwd}

OUTPUT FORMAT — always respond with a JSON object:
{"tools":[...],"response":"..."}

- "tools": array of tool calls to execute (omit or use [] when just answering)
- "response": text for the user (omit when requesting tools, include when answering)

AVAILABLE TOOLS (8):
1. {"tools":[{"tool":"read_file","path":"relative/path"}]}
2. Write a file — JSON line then content block:
{"tools":[{"tool":"write_file","path":"relative/path"}]}
CONTENT:
full file content here
END_CONTENT
3. Edit a file — JSON line then SEARCH/REPLACE blocks:
{"tools":[{"tool":"edit_file","path":"relative/path"}]}
<<<<<<< SEARCH
exact old text (copied from file)
=======
new replacement text
>>>>>>> REPLACE
4. {"tools":[{"tool":"delete_file","path":"relative/path"}]}
5. {"tools":[{"tool":"list_files","path":"."}]}
6. {"tools":[{"tool":"search_files","pattern":"text","path":"."}]}
7. {"tools":[{"tool":"run_shell","command":"command here"}]}
8. {"tools":[{"tool":"web_search","query":"search terms"}]}
9. {"tools":[{"tool":"continue"}]}  — get next page of results when "has_more" is true

RULES:
1. Start your response with a JSON object on the first line. No markdown fences.
2. For write_file and edit_file, put file content AFTER the JSON line — never inside JSON strings.
3. You do NOT know any file contents. ALWAYS use read_file first. NEVER guess.
4. For edit_file, SEARCH block must match the file EXACTLY (same whitespace, same punctuation).
5. Always read_file before edit_file to get exact content.
6. Respond in the SAME language as the user.
7. When you have the info you need, include "response" with your answer and no "tools".
8. NEVER say "I cannot" or "I don't have access" — you have all tools.
9. You can request multiple tools at once in the "tools" array.

DECISION TREE:
- User asks about a file -> {"tools":[{"tool":"read_file","path":"that_file"}]}
- User asks to change a file -> read_file first, then edit_file with EXACT text
- User asks to create a file -> write_file with CONTENT block
- Don't know what files exist -> {"tools":[{"tool":"list_files","path":"."}]}
- Looking for specific code -> {"tools":[{"tool":"search_files","pattern":"keyword","path":"."}]}
- Need to run a command -> {"tools":[{"tool":"run_shell","command":"the command"}]}
- You already have tool results -> {"response":"your answer here"}

EXAMPLES:

User: "what's in package.json?"
{"tools":[{"tool":"read_file","path":"package.json"}]}

[system returns file content]
{"response":"The package.json has project my-app with React 19..."}

User: "add a test script to package.json"
{"tools":[{"tool":"read_file","path":"package.json"}]}

[system returns: "scripts": { "dev": "vite", "build": "vite build" }]
{"tools":[{"tool":"edit_file","path":"package.json"}]}
<<<<<<< SEARCH
    "build": "vite build"
  }
=======
    "build": "vite build",
    "test": "vitest"
  }
>>>>>>> REPLACE

[system confirms edit]
{"response":"Done! Added test: vitest to scripts."}

User: "create a hello.ts file"
{"tools":[{"tool":"write_file","path":"hello.ts"}]}
CONTENT:
export function hello() {
  console.log("Hello, world!");
}
END_CONTENT

[system confirms write]
{"response":"Created hello.ts with a hello() function."}

User: "list files in src/"
{"tools":[{"tool":"list_files","path":"src/"}]}`;
}

// ── JSON response parsing ───────────────────────────────────────────────────────

interface ToolRequest {
  tool: string;
  path?: string;
  content?: string;
  edits?: Array<{ search: string; replace: string }>;
  pattern?: string;
  command?: string;
  query?: string;
  reason?: string;
}

interface ModelResponse {
  intent?: string;
  tools?: ToolRequest[];
  response?: string;
}

function parseModelResponse(text: string): { parsed: ModelResponse | null; trailing: string } {
  let cleaned = text.trim();

  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  cleaned = cleaned.trim();

  const jsonLineMatch = cleaned.match(/^(\{[^\n]*\})\s*\n?([\s\S]*)$/);
  if (jsonLineMatch) {
    try {
      const parsed = JSON.parse(jsonLineMatch[1]) as ModelResponse;
      return { parsed, trailing: jsonLineMatch[2] || "" };
    } catch {}
  }

  try {
    return { parsed: JSON.parse(cleaned), trailing: "" };
  } catch {}

  const jsonMatch = cleaned.match(/(\{[\s\S]*?\})\s*([\s\S]*)$/);
  if (jsonMatch) {
    try {
      return { parsed: JSON.parse(jsonMatch[1]), trailing: jsonMatch[2] || "" };
    } catch {}

    try {
      const fixed = jsonMatch[1]
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/'/g, '"');
      return { parsed: JSON.parse(fixed), trailing: jsonMatch[2] || "" };
    } catch {}
  }

  return { parsed: null, trailing: "" };
}

function enrichToolsFromTrailing(tools: ToolRequest[], trailing: string): void {
  if (!trailing.trim()) return;

  for (const tool of tools) {
    if (tool.tool === "edit_file" && (!tool.edits || tool.edits.length === 0)) {
      const blockRe = /<{3,7}\s*SEARCH\s*\n([\s\S]*?)\n={3,7}\s*\n([\s\S]*?)\n>{3,7}\s*REPLACE/g;
      const edits: Array<{ search: string; replace: string }> = [];
      let bm: RegExpExecArray | null;
      while ((bm = blockRe.exec(trailing)) !== null) {
        edits.push({ search: bm[1], replace: bm[2] });
      }
      if (edits.length > 0) {
        tool.edits = edits;
      }
    }

    if (tool.tool === "write_file" && !tool.content) {
      const contentMatch = trailing.match(/CONTENT:\s*\n([\s\S]*?)(?:\nEND_CONTENT|$)/);
      if (contentMatch) {
        tool.content = contentMatch[1].replace(/\n$/, "");
      }
    }
  }
}

function hasToolRequests(parsed: ModelResponse | null): parsed is ModelResponse & { tools: ToolRequest[] } {
  return !!parsed && Array.isArray(parsed.tools) && parsed.tools.length > 0;
}

// ── Legacy XML fallback ─────────────────────────────────────────────────────────

function extractXmlToolTags(text: string): ToolRequest[] {
  const tools: ToolRequest[] = [];

  text = text.replace(
    /```(?:xml|html|plaintext)?\s*\n([\s\S]*?)\n```/g,
    (_match, inner: string) => {
      const trimmed = inner.trim();
      if (/^<(read_file|write_file|edit_file|delete_file|list_files|search_files|run_shell|web_search)\b/.test(trimmed)) {
        return trimmed;
      }
      return _match;
    },
  );

  text = text.replace(
    /<(read_file|write_file|edit_file|delete_file|list_files|search_files|run_shell|web_search)\s+([^>]*?)>/g,
    (_match, tag: string, attrs: string) => {
      const normalized = attrs.replace(/='([^']*)'/g, '="$1"');
      return `<${tag} ${normalized}>`;
    },
  );

  let m: RegExpExecArray | null;

  const readRe = /<read_file\s+path="([^"]+)"\s*\/>/g;
  while ((m = readRe.exec(text)) !== null) {
    tools.push({ tool: "read_file", path: m[1] });
  }

  const writeRe = /<write_file\s+path="([^"]+)">([\s\S]*?)<\/write_file>/g;
  while ((m = writeRe.exec(text)) !== null) {
    tools.push({ tool: "write_file", path: m[1], content: m[2].replace(/^\n/, "") });
  }

  const editRe = /<edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/g;
  while ((m = editRe.exec(text)) !== null) {
    const body = m[2];
    const blockRe = /<{3,7}\s*SEARCH\s*\n([\s\S]*?)\n={3,7}\s*\n([\s\S]*?)\n>{3,7}\s*REPLACE/g;
    const edits: Array<{ search: string; replace: string }> = [];
    let bm: RegExpExecArray | null;
    while ((bm = blockRe.exec(body)) !== null) {
      edits.push({ search: bm[1], replace: bm[2] });
    }
    if (edits.length > 0) {
      tools.push({ tool: "edit_file", path: m[1], edits });
    }
  }

  const deleteRe = /<delete_file\s+path="([^"]+)"\s*\/>/g;
  while ((m = deleteRe.exec(text)) !== null) {
    tools.push({ tool: "delete_file", path: m[1] });
  }

  const listRe = /<list_files(?:\s+path="([^"]+)")?(?:\s+pattern="([^"]+)")?\s*\/>/g;
  while ((m = listRe.exec(text)) !== null) {
    tools.push({ tool: "list_files", path: m[1] || ".", pattern: m[2] });
  }

  const searchRe = /<search_files\s+pattern="([^"]+)"(?:\s+path="([^"]+)")?\s*\/>/g;
  while ((m = searchRe.exec(text)) !== null) {
    tools.push({ tool: "search_files", pattern: m[1], path: m[2] || "." });
  }

  const shellRe = /<run_shell\s+command="([^"]+)"\s*\/>/g;
  while ((m = shellRe.exec(text)) !== null) {
    tools.push({ tool: "run_shell", command: m[1] });
  }

  const webSearchRe = /<web_search\s+query="([^"]+)"\s*\/>/g;
  while ((m = webSearchRe.exec(text)) !== null) {
    tools.push({ tool: "web_search", query: m[1] });
  }

  return tools;
}

// ── Content invention detection ──────────────────────────────────────────────

function looksLikeInventedContent(response: string, userMessage: string): boolean {
  const fileRe = /[\w./-]+\.(ts|tsx|js|jsx|mjs|py|go|rs|css|json|md|yaml|yml|gitignore|env|toml|lock)\b/g;
  const userMentionedFiles = userMessage.match(fileRe);
  if (!userMentionedFiles || userMentionedFiles.length === 0) return false;

  const codeBlockRe = /```[\s\S]*?\n([\s\S]{200,}?)\n```/;
  if (codeBlockRe.test(response)) return true;

  const hasStructuredContent = (response.match(/[{}[\]]/g) ?? []).length > 6;
  if (hasStructuredContent && response.length > 300) {
    const { parsed } = parseModelResponse(response);
    if (parsed && (hasToolRequests(parsed) || parsed.response)) return false;
    return true;
  }

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
  return listFilesGit(cwd).then((rawFiles) => {
    const files = filterFiles(rawFiles, cwd);
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

async function executeToolRequests(
  toolRequests: ToolRequest[],
  cwd: string,
  sessionState: SessionState,
  getMainWindow: () => BrowserWindow | null,
  sessionId: string,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
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

  for (const req of toolRequests) {
    if (ops >= MAX_TOOL_OPS) break;
    ops++;
    sessionState.toolCallCount++;

    switch (req.tool) {
      case "read_file": {
        const rel = req.path ?? "";
        const id = `ollama-read-${crypto.randomUUID().slice(0, 8)}`;
        emitToolStart(id, "Read", { file_path: rel });
        const abs = safePath(cwd, rel);
        if (!abs) {
          const r = "Error: path outside project";
          results.push({ toolName: "Read", input: { file_path: rel }, result: `Read ${rel}: ${r}` });
          emitToolResult(id, "Read", { error: r });
          break;
        }
        try {
          const stat = fs.statSync(abs);
          if (stat.size > MAX_FILE_READ_BYTES) {
            const r = `file too large (${stat.size} bytes, max ${MAX_FILE_READ_BYTES})`;
            results.push({ toolName: "Read", input: { file_path: rel }, result: `Read ${rel}: ${r}` });
            emitToolResult(id, "Read", { error: r });
            break;
          }
          const content = fs.readFileSync(abs, "utf-8");
          log("OLLAMA_TOOL", `read_file ${rel} (${stat.size} bytes)`);
          if (!sessionState.filesRead.includes(rel)) sessionState.filesRead.push(rel);
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
        break;
      }

      case "write_file": {
        const rel = req.path ?? "";
        const content = req.content ?? "";
        const id = `ollama-write-${crypto.randomUUID().slice(0, 8)}`;
        emitToolStart(id, "Write", { file_path: rel });
        const abs = safePath(cwd, rel);
        if (!abs) {
          const r = "path outside project";
          results.push({ toolName: "Write", input: { file_path: rel }, result: `Write ${rel}: ${r}` });
          emitToolResult(id, "Write", { error: r });
          break;
        }
        try {
          const dir = path.dirname(abs);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(abs, content, "utf-8");
          log("OLLAMA_TOOL", `write_file ${rel} (${content.length} chars)`);
          if (!sessionState.filesCreated.includes(rel)) sessionState.filesCreated.push(rel);
          results.push({ toolName: "Write", input: { file_path: rel }, result: `Write ${rel}: OK (${content.length} bytes)` });
          emitToolResult(id, "Write", { status: "ok", bytesWritten: content.length });
        } catch (err) {
          const r = (err as Error).message;
          results.push({ toolName: "Write", input: { file_path: rel }, result: `Write ${rel}: ${r}` });
          emitToolResult(id, "Write", { error: r });
        }
        break;
      }

      case "edit_file": {
        const rel = req.path ?? "";
        const id = `ollama-edit-${crypto.randomUUID().slice(0, 8)}`;
        const abs = safePath(cwd, rel);
        if (!abs) {
          emitToolStart(id, "Edit", { file_path: rel });
          const r = "path outside project";
          results.push({ toolName: "Edit", input: { file_path: rel }, result: `Edit ${rel}: ${r}` });
          emitToolResult(id, "Edit", { error: r });
          break;
        }
        try {
          let fileContent = fs.readFileSync(abs, "utf-8");
          const edits = req.edits ?? [];
          let replacements = 0;
          const oldParts: string[] = [];
          const newParts: string[] = [];
          for (const edit of edits) {
            if (fileContent.includes(edit.search)) {
              fileContent = fileContent.replace(edit.search, edit.replace);
              oldParts.push(edit.search);
              newParts.push(edit.replace);
              replacements++;
            }
          }
          if (replacements > 0) {
            fs.writeFileSync(abs, fileContent, "utf-8");
            const oldStr = oldParts.join("\n...\n");
            const newStr = newParts.join("\n...\n");
            emitToolStart(id, "Edit", { file_path: rel, old_string: oldStr, new_string: newStr });
            log("OLLAMA_TOOL", `edit_file ${rel} (${replacements} replacements)`);
            if (!sessionState.filesModified.includes(rel)) sessionState.filesModified.push(rel);
            results.push({ toolName: "Edit", input: { file_path: rel }, result: `Edit ${rel}: OK (${replacements} replacement${replacements > 1 ? "s" : ""})` });
            emitToolResult(id, "Edit", { status: "ok", replacements, oldString: oldStr, newString: newStr, filePath: rel });
          } else {
            emitToolStart(id, "Edit", { file_path: rel });
            results.push({ toolName: "Edit", input: { file_path: rel }, result: `Edit ${rel}: no matching search blocks found — read the file first to get exact content` });
            emitToolResult(id, "Edit", { error: "no matching blocks" });
          }
        } catch (err) {
          emitToolStart(id, "Edit", { file_path: rel });
          const r = (err as Error).message;
          results.push({ toolName: "Edit", input: { file_path: rel }, result: `Edit ${rel}: ${r}` });
          emitToolResult(id, "Edit", { error: r });
        }
        break;
      }

      case "delete_file": {
        const rel = req.path ?? "";
        const id = `ollama-delete-${crypto.randomUUID().slice(0, 8)}`;
        emitToolStart(id, "Delete", { file_path: rel });
        const abs = safePath(cwd, rel);
        if (!abs) {
          const r = "path outside project";
          results.push({ toolName: "Delete", input: { file_path: rel }, result: `Delete ${rel}: ${r}` });
          emitToolResult(id, "Delete", { error: r });
          break;
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
        break;
      }

      case "list_files": {
        const rel = req.path || ".";
        const pattern = req.pattern || "";
        const id = `ollama-glob-${crypto.randomUUID().slice(0, 8)}`;
        emitToolStart(id, "Glob", { path: rel, pattern });
        try {
          const rawFiles = await listFilesGit(cwd);
          const normalizedBase = rel === "." ? "" : `${rel.replace(/\/$/, "")}/`;
          const allFiltered = filterFiles(rawFiles, cwd)
            .filter((file) => !normalizedBase || file === rel || file.startsWith(normalizedBase))
            .filter((file) => !pattern || file.includes(pattern.replace(/\*/g, "")));

          if (allFiltered.length > TREE_COLLAPSE_THRESHOLD) {
            const tree = filesToTree(allFiltered);
            const summary = `List ${rel}: ${allFiltered.length} files (tree view)`;
            results.push({
              toolName: "Glob", input: { path: rel, pattern }, result: summary,
              attachment: { path: `tree:${rel}`, content: tree },
            });
            emitToolResult(id, "Glob", {
              filenames: allFiltered.slice(0, PAGE_SIZE), numFiles: allFiltered.length,
              showing: Math.min(PAGE_SIZE, allFiltered.length),
              has_more: allFiltered.length > PAGE_SIZE,
              mode: "files_with_matches",
            });

            if (allFiltered.length > PAGE_SIZE) {
              sessionState.pendingPages.set(`list:${rel}:${pattern}`, allFiltered.slice(PAGE_SIZE));
            }
          } else {
            const summary = `List ${rel}: OK (${allFiltered.length} file${allFiltered.length === 1 ? "" : "s"})`;
            results.push({ toolName: "Glob", input: { path: rel, pattern }, result: summary });
            emitToolResult(id, "Glob", {
              filenames: allFiltered, numFiles: allFiltered.length,
              showing: allFiltered.length, has_more: false,
              mode: "files_with_matches",
            });
          }
        } catch (err) {
          const error = (err as Error).message;
          results.push({ toolName: "Glob", input: { path: rel, pattern }, result: `List ${rel}: ${error}` });
          emitToolResult(id, "Glob", { error });
        }
        break;
      }

      case "search_files": {
        const pattern = req.pattern ?? "";
        const rel = req.path || ".";
        const id = `ollama-grep-${crypto.randomUUID().slice(0, 8)}`;
        emitToolStart(id, "Grep", { pattern, path: rel });
        try {
          const allMatches = await searchFiles(pattern, cwd, rel);
          const page = allMatches.slice(0, PAGE_SIZE);
          const remaining = allMatches.slice(PAGE_SIZE);
          const hasMore = remaining.length > 0;

          if (hasMore) {
            const pageKey = `search:${rel}:${pattern}`;
            sessionState.pendingPages.set(pageKey, remaining);
          }

          const summary = hasMore
            ? `Search "${pattern}" in ${rel}: showing ${page.length} of ${allMatches.length} matches (use "continue" to see more)`
            : `Search "${pattern}" in ${rel}: OK (${page.length} match${page.length === 1 ? "" : "es"})`;

          results.push({ toolName: "Grep", input: { pattern, path: rel }, result: summary });
          emitToolResult(id, "Grep", {
            filenames: page, numFiles: allMatches.length,
            showing: page.length, has_more: hasMore,
            mode: "files_with_matches",
          });
        } catch (err) {
          const error = (err as Error).message;
          results.push({ toolName: "Grep", input: { pattern, path: rel }, result: `Search "${pattern}" in ${rel}: ${error}` });
          emitToolResult(id, "Grep", { error });
        }
        break;
      }

      case "continue": {
        const id = `ollama-continue-${crypto.randomUUID().slice(0, 8)}`;
        const entries = [...sessionState.pendingPages.entries()];
        if (entries.length === 0) {
          emitToolStart(id, "Continue", {});
          results.push({ toolName: "Continue", input: {}, result: "No pending pages to continue" });
          emitToolResult(id, "Continue", { error: "nothing to continue" });
          break;
        }

        const [pageKey, remaining] = entries[0];
        const page = remaining.slice(0, PAGE_SIZE);
        const rest = remaining.slice(PAGE_SIZE);

        if (rest.length > 0) {
          sessionState.pendingPages.set(pageKey, rest);
        } else {
          sessionState.pendingPages.delete(pageKey);
        }

        const hasMore = rest.length > 0;
        const toolName = pageKey.startsWith("list:") ? "Glob" : "Grep";
        emitToolStart(id, toolName, { continued: true });

        const summary = hasMore
          ? `Continued ${pageKey}: showing ${page.length} more (${rest.length} remaining, use "continue" again)`
          : `Continued ${pageKey}: last ${page.length} items`;

        results.push({ toolName, input: { continued: true }, result: summary });
        emitToolResult(id, toolName, {
          filenames: page, showing: page.length,
          remaining: rest.length, has_more: hasMore,
          mode: "files_with_matches",
        });
        break;
      }

      case "web_search": {
        const query = req.query ?? "";
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
        break;
      }

      case "run_shell": {
        const command = req.command ?? "";
        const id = `ollama-bash-${crypto.randomUUID().slice(0, 8)}`;
        emitToolStart(id, "Bash", { command });
        const shellResult = await runShell(command, cwd);
        const summary = `Shell "${command}": exit ${shellResult.exitCode}`;
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
        break;
      }
    }
  }

  return results;
}

// ── Build structured feedback ───────────────────────────────────────────────────

function buildToolFeedback(results: ToolResult[], sessionState: SessionState): string {
  const feedback: Record<string, unknown> = {
    type: "tool_results",
    results: results.map((r) => {
      const entry: Record<string, unknown> = {
        tool: r.toolName,
        status: r.result,
      };
      if (r.attachment) {
        entry.content = r.attachment.content;
        entry.path = r.attachment.path;
      }
      return entry;
    }),
    session: {
      files_read: sessionState.filesRead,
      files_modified: sessionState.filesModified,
      files_created: sessionState.filesCreated,
      total_tool_calls: sessionState.toolCallCount,
      original_request: sessionState.originalRequest,
    },
    instruction: "Now answer or apply changes. For edits use exact text from tool results. If you just edited or wrote a file, verify the change is correct and has no syntax errors — if you suspect a problem, use read_file to check. Respond in JSON. Use the user's language.",
  };
  return JSON.stringify(feedback, null, 2);
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
      stream_options: { include_usage: true },
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
  let isToolCall: boolean | null = null;

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
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };

        if (parsed.usage) {
          const used = parsed.usage.prompt_tokens ?? 0;
          const generated = parsed.usage.completion_tokens ?? 0;
          emit(getMainWindow, sessionId, "context:usage", {
            used: used + generated,
            limit: session.contextSize,
            promptTokens: used,
            completionTokens: generated,
          });
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;

          if (isToolCall === null) {
            const trimmedFull = fullText.trimStart();
            if (trimmedFull.startsWith("{") || trimmedFull.startsWith("<")) {
              isToolCall = true;
            } else if (trimmedFull.length > 2) {
              isToolCall = false;
            }
          }

          if (isToolCall !== true) {
            emit(getMainWindow, sessionId, "chat:delta", { text: fullText });
          }
        }
      } catch {
      }
    }
  }

  return fullText;
}

// ── Extract display text from model response ────────────────────────────────────

function extractDisplayText(fullText: string, parsed: ModelResponse | null): string {
  if (parsed?.response) {
    return parsed.response
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/END_CONTENT\s*$/g, "")
      .replace(/^[\s`"',;]+/, "")
      .replace(/[\s`"',;]+$/, "")
      .trim();
  }

  let cleaned = fullText;

  try {
    const jsonMatch = cleaned.match(/^\s*\{[^\n]*\}/m);
    if (jsonMatch) {
      cleaned = cleaned.replace(jsonMatch[0], "");
    }
  } catch {}

  cleaned = cleaned
    .replace(/<{3,7}\s*SEARCH\s*\n[\s\S]*?\n>{3,7}\s*REPLACE/g, "")
    .replace(/CONTENT:\s*\n[\s\S]*?(?:\nEND_CONTENT|$)/g, "")
    .replace(/<read_file\s+path="[^"]+"\s*\/>/g, "")
    .replace(/<write_file\s+path="[^"]+">([\s\S]*?)<\/write_file>/g, "")
    .replace(/<edit_file\s+path="[^"]+">([\s\S]*?)<\/edit_file>/g, "")
    .replace(/<delete_file\s+path="[^"]+"\s*\/>/g, "")
    .replace(/<list_files(?:\s+path="[^"]+")?(?:\s+pattern="[^"]+")?\s*\/>/g, "")
    .replace(/<search_files\s+pattern="[^"]+"(?:\s+path="[^"]+")?\s*\/>/g, "")
    .replace(/<run_shell\s+command="[^"]+"\s*\/>/g, "")
    .replace(/<web_search\s+query="[^"]+"\s*\/>/g, "")
    .replace(/^\s*[,;]\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

// ── IPC registration ───────────────────────────────────────────────────────────

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("ollama:start", async (_event, { cwd, model }: { cwd: string; model?: string }) => {
    const sessionId = crypto.randomUUID();
    const sessionModel = model || getDefaultModel();
    const contextSize = await fetchModelContextSize(sessionModel);
    sessions.set(sessionId, {
      messages: [{ role: "system", content: buildSystemPrompt(cwd) }],
      cwd,
      model: sessionModel,
      contextSize,
      abortController: null,
      state: freshState(),
    });

    triggerIndex(cwd);

    return { sessionId, model: sessionModel };
  });

  ipcMain.handle("ollama:send", async (_event, { sessionId, text, cwd, model }: { sessionId: string; text: string; cwd?: string; model?: string }) => {
    let session = sessions.get(sessionId);
    if (!session && cwd) {
      const sessionModel = model || getDefaultModel();
      session = {
        messages: [{ role: "system", content: buildSystemPrompt(cwd) }],
        cwd,
        model: sessionModel,
        contextSize: await fetchModelContextSize(sessionModel),
        abortController: null,
        state: freshState(),
      };
      sessions.set(sessionId, session);
      triggerIndex(cwd);
      log("OLLAMA", `auto-revived session ${sessionId} (cwd=${cwd}, model=${sessionModel})`);
    }
    if (!session) return { error: "Session expired — please start a new chat" };

    session.state.originalRequest = text;

    const isWebQuery = /\b(pesquise na web|busque na web|search the web|busca online|web search|na internet|on the internet|look up online|pesquisa|pesquisar|buscar)\b/i.test(text);

    try {
      if (isWebQuery) {
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
            content: `Web search results for "${searchQuery}":\n\n${formatted}\n\nUsing ONLY the information above, answer the user's question. If the results are insufficient, say so. Respond in JSON format.`,
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
      log("RAG", `failed, using plain message: ${(err as Error).message}`);
      session.messages.push({ role: "user", content: text });
    }

    const controller = new AbortController();
    session.abortController = controller;

    emit(getMainWindow, sessionId, "lifecycle:start", {});
    emitContextUsage(getMainWindow, sessionId, session);

    try {
      let loopCount = 0;

      while (loopCount < MAX_TOOL_LOOPS) {
        loopCount++;

        const fullText = await streamOllamaResponse(session, controller, getMainWindow, sessionId);

        const { parsed, trailing } = parseModelResponse(fullText);
        let toolRequests: ToolRequest[] = [];

        if (hasToolRequests(parsed)) {
          toolRequests = parsed.tools;
          enrichToolsFromTrailing(toolRequests, trailing);
          log("OLLAMA", `JSON protocol: ${toolRequests.length} tool(s) requested`);
        } else {
          toolRequests = extractXmlToolTags(fullText);
          if (toolRequests.length > 0) {
            log("OLLAMA", `XML fallback: ${toolRequests.length} tool(s) detected`);
          }
        }

        if (toolRequests.length === 0) {
          if (loopCount === 1 && looksLikeInventedContent(fullText, text)) {
            log("OLLAMA", "model invented content instead of using tools — re-prompting");
            session.messages.push({ role: "assistant", content: fullText });
            emit(getMainWindow, sessionId, "chat:clear-streaming", {});
            session.messages.push({
              role: "user",
              content: JSON.stringify({
                type: "correction",
                error: "You are guessing file content. You MUST use read_file to see real content.",
                instruction: "Try again. Output ONLY a JSON object with tools array.",
                example: '{"tools":[{"tool":"read_file","path":"the_file"}]}',
              }),
            });
            emit(getMainWindow, sessionId, "lifecycle:start", {});
        emitContextUsage(getMainWindow, sessionId, session);
            continue;
          }

          let finalDisplay = extractDisplayText(fullText, parsed);
          if (!finalDisplay && !parsed) {
            const jsonMatch = fullText.match(/\{\s*"response"\s*:\s*"([\s\S]*?)"\s*\}$/);
            if (jsonMatch) {
              finalDisplay = jsonMatch[1]
                .replace(/\\n/g, "\n")
                .replace(/\\t/g, "\t")
                .replace(/\\"/g, '"')
                .replace(/^[\s`"',;]+/, "")
                .replace(/[\s`"',;]+$/, "")
                .trim();
            }
          }
          session.messages.push({ role: "assistant", content: fullText });
          emit(getMainWindow, sessionId, "chat:final", { message: finalDisplay || fullText });
          break;
        }

        session.messages.push({ role: "assistant", content: fullText });

        const displayText = extractDisplayText(fullText, parsed);
        if (displayText) {
          emit(getMainWindow, sessionId, "chat:mid-final", { message: displayText });
        } else {
          emit(getMainWindow, sessionId, "chat:clear-streaming", {});
        }

        const results = await executeToolRequests(toolRequests, session.cwd, session.state, getMainWindow, sessionId);

        const feedback = buildToolFeedback(results, session.state);
        const isLoop = detectLoop(session.state, toolRequests);

        if (isLoop) {
          log("OLLAMA", `repetitive loop detected at iteration ${loopCount} — asking model to reconsider`);
          const loopWarning = JSON.stringify({
            type: "loop_warning",
            message: "You are repeating the same tool calls with the same arguments. You are stuck in a loop.",
            instruction: "Stop and think from a different perspective. Summarize what you have done so far, what is not working, and try a completely different approach. If you have enough information, just answer the user's question now.",
            repeated_tool: toolSignature(toolRequests),
            loops_used: loopCount,
            tools_called: session.state.toolCallCount,
            files_read: session.state.filesRead,
            files_modified: session.state.filesModified,
            original_request: session.state.originalRequest,
          });
          session.messages.push({ role: "user", content: feedback + "\n\n" + loopWarning });
        } else {
          session.messages.push({ role: "user", content: feedback });
        }

        emit(getMainWindow, sessionId, "lifecycle:start", {});
        emitContextUsage(getMainWindow, sessionId, session);
      }

      if (loopCount >= MAX_TOOL_LOOPS) {
        log("OLLAMA", `hard limit reached (${MAX_TOOL_LOOPS})`);
        emit(getMainWindow, sessionId, "chat:final", {
          message: session.messages.filter((m) => m.role === "assistant").pop()?.content ?? "",
        });
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
