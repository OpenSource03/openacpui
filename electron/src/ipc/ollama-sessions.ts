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
import { crawlUrl } from "../lib/rag/web-crawl";
import { filterFiles } from "../lib/harnssignore";
import { getMcpToolsForOllama, executeMcpTool, disconnectMcpBridge, type McpBridgeState } from "../lib/mcp-bridge";

// ── Types ──────────────────────────────────────────────────────────────────────

interface OllamaMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
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
  mcpBridge: McpBridgeState | null;
  mcpTools: Array<{ type: "function"; function: { name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] } } }>;
}

interface ToolResult {
  toolName: string;
  input: Record<string, unknown>;
  result: string;
  content: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const sessions = new Map<string, OllamaSession>();

const MAX_FILE_READ_BYTES = 200_000;
const MAX_TOOL_LOOPS = 12;
const MAX_TOOL_OPS = MAX_TOOL_LOOPS * 2;
const MAX_SHELL_OUTPUT_BYTES = 16_000;
const SHELL_TIMEOUT_MS = 15_000;
const MAX_LIST_FILES = 500;
const MAX_SEARCH_MATCHES = 100;
const PAGE_SIZE = 50;
const TREE_COLLAPSE_THRESHOLD = 30;

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

function freshState(): SessionState {
  return { filesRead: [], filesModified: [], filesCreated: [], originalRequest: "", toolCallCount: 0, recentToolSignatures: [], pendingPages: new Map() };
}

// ── Native tool definitions ────────────────────────────────────────────────────

const OLLAMA_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read the contents of a file. Always use this before editing a file.",
      parameters: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", description: "Relative file path" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Create or overwrite a file with new content.",
      parameters: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "Full file content" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description: "Replace exact text in a file. Use read_file first to get the exact content to search for.",
      parameters: {
        type: "object",
        required: ["path", "old_string", "new_string"],
        properties: {
          path: { type: "string", description: "Relative file path" },
          old_string: { type: "string", description: "Exact text to find (must match file content exactly)" },
          new_string: { type: "string", description: "Replacement text" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_file",
      description: "Delete a file.",
      parameters: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", description: "Relative file path" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description: "List files in a directory. Returns a tree view of the project structure.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path (default: '.')" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_files",
      description: "Search for text pattern in project files.",
      parameters: {
        type: "object",
        required: ["pattern"],
        properties: {
          pattern: { type: "string", description: "Text to search for" },
          path: { type: "string", description: "Directory to search in (default: '.')" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_shell",
      description: "Execute a shell command.",
      parameters: {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string", description: "Shell command to execute" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description: "Search the web for information.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Search query" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_url",
      description: "Read a web page and extract its content as markdown. Use after web_search to read a specific result page.",
      parameters: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "Full URL to read (https://...)" },
        },
      },
    },
  },
];

// ── System prompt (behavior only, no tool format) ──────────────────────────────

function buildSystemPrompt(cwd: string, skillContents?: string[], mcpToolNames?: string[]): string {
  let prompt = `You are a coding assistant with tools. CWD: ${cwd}

RULES:
1. You do NOT know any file contents. ALWAYS use read_file first. NEVER guess.
2. Always read_file before edit_file to get exact content.
3. For edit_file, old_string must match the file EXACTLY (same whitespace, same punctuation).
4. Respond in the SAME language as the user.
5. NEVER say "I cannot" or "I don't have access" — you have all tools.
6. You can call multiple tools at once.`;

  if (mcpToolNames && mcpToolNames.length > 0) {
    prompt += `\n\nYou also have MCP (external service) tools available. PREFER these over builtin tools when relevant:\n${mcpToolNames.map((n) => `- ${n}`).join("\n")}`;
  }

  if (skillContents && skillContents.length > 0) {
    prompt += "\n\n--- ACTIVE SKILLS ---\n\n" + skillContents.join("\n\n---\n\n");
  }

  return prompt;
}

// ── File tree (bracket notation) ───────────────────────────────────────────────

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

  const sortedDirs = [...byDir.keys()].sort();
  const indexOnlyChildren = new Map<string, string[]>();
  for (const dir of sortedDirs) {
    const names = byDir.get(dir)!;
    if (names.length === 1 && names[0] === "index.ts") {
      const lastSlash = dir.lastIndexOf("/");
      if (lastSlash !== -1) {
        const parent = dir.slice(0, lastSlash);
        const child = dir.slice(lastSlash + 1);
        if (!indexOnlyChildren.has(parent)) indexOnlyChildren.set(parent, []);
        indexOnlyChildren.get(parent)!.push(child);
      }
    }
  }

  const rendered = new Set<string>();
  for (const dir of sortedDirs) {
    if (rendered.has(dir)) continue;
    const names = byDir.get(dir)!;
    if (names.length === 1 && names[0] === "index.ts") {
      const lastSlash = dir.lastIndexOf("/");
      if (lastSlash !== -1) {
        const parent = dir.slice(0, lastSlash);
        if (indexOnlyChildren.has(parent)) continue;
      }
    }
    const merged = indexOnlyChildren.get(dir);
    if (merged && merged.length > 0) {
      const own = groupByExt(names);
      if (own.length > 0) lines.push(`${dir}/ ${own.join(", ")}`);
      lines.push(`${dir}/[${merged.sort().join(",")}]/index.ts`);
      for (const c of merged) rendered.add(`${dir}/${c}`);
    } else {
      const grouped = groupByExt(names);
      lines.push(dir === "." ? grouped.join(", ") : `${dir}/ ${grouped.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("Expand [a,b,c] to get paths. Example: src/[foo,bar].ts = src/foo.ts, src/bar.ts");
  return lines.join("\n");
}

// ── Loop detection ─────────────────────────────────────────────────────────────

function toolSignature(calls: OllamaToolCall[]): string {
  return calls.map((c) => `${c.function.name}:${(c.function.arguments as Record<string, unknown>).path ?? (c.function.arguments as Record<string, unknown>).command ?? (c.function.arguments as Record<string, unknown>).query ?? ""}`).sort().join("|");
}

function detectLoop(state: SessionState, calls: OllamaToolCall[]): boolean {
  const sig = toolSignature(calls);
  state.recentToolSignatures.push(sig);
  if (state.recentToolSignatures.length > 6) state.recentToolSignatures.shift();
  const recent = state.recentToolSignatures;
  if (recent.length < 3) return false;
  const last3 = recent.slice(-3);
  return last3[0] === last3[1] && last3[1] === last3[2];
}

// ── Context size ───────────────────────────────────────────────────────────────

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

function estimateTokens(messages: OllamaMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += m.content.length;
  return Math.ceil(chars / 4);
}

function emitContextUsage(getMainWindow: () => BrowserWindow | null, sessionId: string, session: OllamaSession): void {
  const used = estimateTokens(session.messages);
  emit(getMainWindow, sessionId, "context:usage", { used, limit: session.contextSize });
}

// ── Utility functions ──────────────────────────────────────────────────────────

function safePath(cwd: string, relPath: string): string | null {
  const abs = path.resolve(cwd, relPath);
  if (!abs.startsWith(cwd + path.sep) && abs !== cwd) return null;
  return abs;
}

function trimOutput(text: string, max = MAX_SHELL_OUTPUT_BYTES): string {
  return text.length > max ? `${text.slice(0, max)}\n...` : text;
}

function listFilesGit(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) { reject(err); return; }
      resolve(stdout.trim().split("\n").filter(Boolean).sort());
    });
  });
}

function runShell(command: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: SHELL_TIMEOUT_MS, maxBuffer: MAX_SHELL_OUTPUT_BYTES }, (err, stdout, stderr) => {
      const exitCode = typeof err?.code === "number" ? err.code : err ? 1 : 0;
      resolve({ stdout: trimOutput(stdout), stderr: trimOutput(stderr), exitCode });
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
      if (normalizedBase && file !== relPath && !file.startsWith(normalizedBase)) continue;
      const abs = safePath(cwd, file);
      if (!abs) continue;
      try {
        const stat = fs.statSync(abs);
        if (!stat.isFile() || stat.size > MAX_FILE_READ_BYTES) continue;
        const content = fs.readFileSync(abs, "utf-8");
        if (content.includes(pattern)) matches.push(file);
      } catch {}
      if (matches.length >= MAX_SEARCH_MATCHES) break;
    }
    return matches;
  });
}

// ── Tool execution ─────────────────────────────────────────────────────────────

async function executeToolCall(
  call: OllamaToolCall,
  cwd: string,
  sessionState: SessionState,
  getMainWindow: () => BrowserWindow | null,
  sessionId: string,
): Promise<ToolResult> {
  const name = call.function.name;
  const args = call.function.arguments as Record<string, string>;
  const toolId = `ollama-${name}-${crypto.randomUUID().slice(0, 8)}`;

  function emitStart(toolName: string, input: Record<string, unknown>) {
    log("OLLAMA_EVENT", `tool:start ${toolName} id=${toolId} args=${JSON.stringify(input)}`);
    safeSend(getMainWindow, "ollama:event", { _sessionId: sessionId, type: "tool:start", payload: { toolUseId: toolId, toolName, input }, _seq: 0 });
  }
  function emitResult(toolName: string, result: Record<string, unknown>) {
    log("OLLAMA_EVENT", `tool:result ${toolName} id=${toolId} error=${!!(result as { error?: unknown }).error}`);
    safeSend(getMainWindow, "ollama:event", { _sessionId: sessionId, type: "tool:result", payload: { toolUseId: toolId, toolName, result }, _seq: 0 });
  }

  sessionState.toolCallCount++;

  switch (name) {
    case "read_file": {
      const rel = args.path ?? "";
      emitStart("Read", { file_path: rel });
      const abs = safePath(cwd, rel);
      if (!abs) {
        emitResult("Read", { error: "path outside project" });
        return { toolName: "Read", input: { file_path: rel }, result: `Error: path outside project`, content: "Error: path outside project" };
      }
      try {
        const stat = fs.statSync(abs);
        if (stat.size > MAX_FILE_READ_BYTES) {
          const msg = `file too large (${stat.size} bytes)`;
          emitResult("Read", { error: msg });
          return { toolName: "Read", input: { file_path: rel }, result: msg, content: msg };
        }
        const content = fs.readFileSync(abs, "utf-8");
        log("OLLAMA_TOOL", `read_file ${rel} (${stat.size} bytes)`);
        if (!sessionState.filesRead.includes(rel)) sessionState.filesRead.push(rel);
        emitResult("Read", { content: content.slice(0, 300) + (content.length > 300 ? "\n..." : "") });
        return { toolName: "Read", input: { file_path: rel }, result: `Read ${rel}: OK (${stat.size} bytes)`, content };
      } catch {
        emitResult("Read", { error: "file not found" });
        return { toolName: "Read", input: { file_path: rel }, result: "file not found", content: "file not found" };
      }
    }

    case "write_file": {
      const rel = args.path ?? "";
      const fileContent = args.content ?? "";
      emitStart("Write", { file_path: rel });
      const abs = safePath(cwd, rel);
      if (!abs) {
        emitResult("Write", { error: "path outside project" });
        return { toolName: "Write", input: { file_path: rel }, result: "path outside project", content: "path outside project" };
      }
      try {
        const dir = path.dirname(abs);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(abs, fileContent, "utf-8");
        log("OLLAMA_TOOL", `write_file ${rel} (${fileContent.length} chars)`);
        if (!sessionState.filesCreated.includes(rel)) sessionState.filesCreated.push(rel);
        emitResult("Write", { status: "ok", bytesWritten: fileContent.length });
        return { toolName: "Write", input: { file_path: rel }, result: `Write ${rel}: OK (${fileContent.length} bytes)`, content: `File written: ${rel}` };
      } catch (err) {
        const msg = (err as Error).message;
        emitResult("Write", { error: msg });
        return { toolName: "Write", input: { file_path: rel }, result: msg, content: msg };
      }
    }

    case "edit_file": {
      const rel = args.path ?? "";
      const oldStr = args.old_string ?? "";
      const newStr = args.new_string ?? "";
      const abs = safePath(cwd, rel);
      if (!abs) {
        emitStart("Edit", { file_path: rel });
        emitResult("Edit", { error: "path outside project" });
        return { toolName: "Edit", input: { file_path: rel }, result: "path outside project", content: "path outside project" };
      }
      try {
        let fileContent = fs.readFileSync(abs, "utf-8");
        if (fileContent.includes(oldStr)) {
          fileContent = fileContent.replace(oldStr, newStr);
          fs.writeFileSync(abs, fileContent, "utf-8");
          emitStart("Edit", { file_path: rel, old_string: oldStr, new_string: newStr });
          log("OLLAMA_TOOL", `edit_file ${rel} (1 replacement)`);
          if (!sessionState.filesModified.includes(rel)) sessionState.filesModified.push(rel);
          emitResult("Edit", { status: "ok", replacements: 1, oldString: oldStr, newString: newStr, filePath: rel });
          return { toolName: "Edit", input: { file_path: rel }, result: `Edit ${rel}: OK (1 replacement)`, content: `File edited: ${rel}` };
        } else {
          emitStart("Edit", { file_path: rel });
          emitResult("Edit", { error: "old_string not found in file — read the file first to get exact content" });
          return { toolName: "Edit", input: { file_path: rel }, result: "old_string not found — read_file first", content: "old_string not found in file" };
        }
      } catch (err) {
        emitStart("Edit", { file_path: rel });
        const msg = (err as Error).message;
        emitResult("Edit", { error: msg });
        return { toolName: "Edit", input: { file_path: rel }, result: msg, content: msg };
      }
    }

    case "delete_file": {
      const rel = args.path ?? "";
      emitStart("Delete", { file_path: rel });
      const abs = safePath(cwd, rel);
      if (!abs) {
        emitResult("Delete", { error: "path outside project" });
        return { toolName: "Delete", input: { file_path: rel }, result: "path outside project", content: "path outside project" };
      }
      try {
        fs.unlinkSync(abs);
        log("OLLAMA_TOOL", `delete_file ${rel}`);
        emitResult("Delete", { status: "ok" });
        return { toolName: "Delete", input: { file_path: rel }, result: `Delete ${rel}: OK`, content: `File deleted: ${rel}` };
      } catch (err) {
        const msg = (err as Error).message;
        emitResult("Delete", { error: msg });
        return { toolName: "Delete", input: { file_path: rel }, result: msg, content: msg };
      }
    }

    case "list_files": {
      const rel = args.path || ".";
      emitStart("Glob", { path: rel });
      try {
        const rawFiles = await listFilesGit(cwd);
        const normalizedBase = rel === "." ? "" : `${rel.replace(/\/$/, "")}/`;
        const allFiltered = filterFiles(rawFiles, cwd)
          .filter((file) => !normalizedBase || file === rel || file.startsWith(normalizedBase));

        let content: string;
        if (allFiltered.length > TREE_COLLAPSE_THRESHOLD) {
          content = filesToTree(allFiltered);
        } else {
          content = allFiltered.join("\n");
        }

        if (allFiltered.length > PAGE_SIZE) {
          sessionState.pendingPages.set(`list:${rel}`, allFiltered.slice(PAGE_SIZE));
        }

        emitResult("Glob", { filenames: allFiltered.slice(0, PAGE_SIZE), numFiles: allFiltered.length, mode: "files_with_matches" });
        return { toolName: "Glob", input: { path: rel }, result: `List ${rel}: ${allFiltered.length} files`, content };
      } catch (err) {
        const msg = (err as Error).message;
        emitResult("Glob", { error: msg });
        return { toolName: "Glob", input: { path: rel }, result: msg, content: msg };
      }
    }

    case "search_files": {
      const pattern = args.pattern ?? "";
      const rel = args.path || ".";
      emitStart("Grep", { pattern, path: rel });
      try {
        const matches = await searchFiles(pattern, cwd, rel);
        const content = matches.length > 0 ? matches.join("\n") : "No matches found.";
        emitResult("Grep", { filenames: matches, numFiles: matches.length, mode: "files_with_matches" });
        return { toolName: "Grep", input: { pattern, path: rel }, result: `Search "${pattern}": ${matches.length} matches`, content };
      } catch (err) {
        const msg = (err as Error).message;
        emitResult("Grep", { error: msg });
        return { toolName: "Grep", input: { pattern, path: rel }, result: msg, content: msg };
      }
    }

    case "web_search": {
      const query = args.query ?? "";
      emitStart("WebSearch", { query });
      try {
        const searchResult = await webSearch(query);
        const formatted = formatWebResults(searchResult);
        log("OLLAMA_TOOL", `web_search "${query}" (${searchResult.results.length} results)`);
        emitResult("WebSearch", { query, abstract: searchResult.abstract, abstractUrl: searchResult.abstractUrl, results: searchResult.results });
        return { toolName: "WebSearch", input: { query }, result: `Web search: ${searchResult.results.length} results`, content: formatted };
      } catch (err) {
        const msg = (err as Error).message;
        emitResult("WebSearch", { error: msg });
        return { toolName: "WebSearch", input: { query }, result: msg, content: `Web search failed: ${msg}` };
      }
    }

    case "read_url": {
      const targetUrl = args.url ?? "";
      emitStart("WebFetch", { url: targetUrl });
      try {
        const crawlResult = await crawlUrl(targetUrl);
        const truncated = crawlResult.content.length > 50000
          ? crawlResult.content.slice(0, 50000) + "\n\n... (truncated, content too long)"
          : crawlResult.content;
        log("OLLAMA_TOOL", `read_url "${targetUrl}" (${crawlResult.content.length} chars, provider=${crawlResult.provider})`);
        emitResult("WebFetch", { url: targetUrl, title: crawlResult.title, contentLength: crawlResult.content.length, provider: crawlResult.provider });
        return { toolName: "WebFetch", input: { url: targetUrl }, result: `Read URL: ${crawlResult.title} (${crawlResult.content.length} chars)`, content: truncated };
      } catch (err) {
        const msg = (err as Error).message;
        emitResult("WebFetch", { error: msg });
        return { toolName: "WebFetch", input: { url: targetUrl }, result: msg, content: `Failed to read URL: ${msg}` };
      }
    }

    case "run_shell": {
      const command = args.command ?? "";
      emitStart("Bash", { command });
      const shellResult = await runShell(command, cwd);
      const output = [shellResult.stdout, shellResult.stderr].filter(Boolean).join("\n");
      emitResult("Bash", { stdout: shellResult.stdout, stderr: shellResult.stderr, exitCode: shellResult.exitCode, output });
      return { toolName: "Bash", input: { command }, result: `exit ${shellResult.exitCode}`, content: output || "(no output)" };
    }

    default: {
      return { toolName: name, input: args, result: `Unknown tool: ${name}`, content: `Unknown tool: ${name}` };
    }
  }
}

async function executeMcpToolCall(
  call: OllamaToolCall,
  session: OllamaSession,
  getMainWindow: () => BrowserWindow | null,
  sessionId: string,
): Promise<ToolResult> {
  const name = call.function.name;
  const args = call.function.arguments as Record<string, unknown>;
  const toolId = `ollama-mcp-${crypto.randomUUID().slice(0, 8)}`;
  const mapping = session.mcpBridge?.toolMap.get(name);
  const displayName = mapping ? `mcp__${mapping.serverName}__${mapping.originalName}` : name;

  safeSend(getMainWindow, "ollama:event", { _sessionId: sessionId, type: "tool:start", payload: { toolUseId: toolId, toolName: displayName, input: args }, _seq: 0 });

  try {
    const result = await executeMcpTool(session.mcpBridge!, name, args);
    safeSend(getMainWindow, "ollama:event", { _sessionId: sessionId, type: "tool:result", payload: { toolUseId: toolId, toolName: displayName, result: { content: result.slice(0, 500) + (result.length > 500 ? "\n..." : "") } }, _seq: 0 });
    return { toolName: displayName, input: args as Record<string, string>, result: `${displayName}: OK`, content: result };
  } catch (err) {
    const msg = (err as Error).message;
    safeSend(getMainWindow, "ollama:event", { _sessionId: sessionId, type: "tool:result", payload: { toolUseId: toolId, toolName: displayName, result: { error: msg } }, _seq: 0 });
    return { toolName: displayName, input: args as Record<string, string>, result: msg, content: `Error: ${msg}` };
  }
}

// ── Native streaming ───────────────────────────────────────────────────────────

interface StreamResult {
  content: string;
  thinking: string;
  toolCalls: OllamaToolCall[];
  promptTokens: number;
  completionTokens: number;
}

async function streamOllamaChat(
  session: OllamaSession,
  controller: AbortController,
  getMainWindow: () => BrowserWindow | null,
  sessionId: string,
): Promise<StreamResult> {
  const response = await fetch(`${getBaseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: session.model,
      messages: compressConversation(session.messages as Array<{ role: string; content: string }>),
      tools: [...OLLAMA_TOOLS, ...session.mcpTools],
      think: true,
      stream: true,
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
  let fullContent = "";
  let fullThinking = "";
  let buffer = "";
  let toolCalls: OllamaToolCall[] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as {
          message?: { role?: string; content?: string; thinking?: string; tool_calls?: OllamaToolCall[] };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };

        if (parsed.message?.thinking) {
          fullThinking += parsed.message.thinking;
          emit(getMainWindow, sessionId, "chat:thinking", { text: fullThinking });
        }

        if (parsed.message?.content) {
          fullContent += parsed.message.content;
          const visible = fullContent
            .replace(/<think>[\s\S]*?<\/think>/g, "")
            .replace(/<think>[\s\S]*$/, "")
            .trim();
          if (visible) {
            emit(getMainWindow, sessionId, "chat:delta", { text: visible });
          }
        }

        if (parsed.message?.tool_calls) {
          toolCalls = parsed.message.tool_calls;
        }

        if (parsed.done) {
          promptTokens = parsed.prompt_eval_count ?? 0;
          completionTokens = parsed.eval_count ?? 0;
          if (promptTokens > 0) {
            emit(getMainWindow, sessionId, "context:usage", {
              used: promptTokens + completionTokens,
              limit: session.contextSize,
              promptTokens,
              completionTokens,
            });
          }
        }
      } catch {}
    }
  }

  const cleanContent = fullContent
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\/?think>/g, "")
    .trim();

  return { content: cleanContent, thinking: fullThinking, toolCalls, promptTokens, completionTokens };
}

// ── IPC registration ───────────────────────────────────────────────────────────

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("ollama:start", async (_event, { cwd, model, projectId, activeSkills }: { cwd: string; model?: string; projectId?: string; activeSkills?: string[] }) => {
    const sessionId = crypto.randomUUID();
    const sessionModel = model || getDefaultModel();
    const contextSize = await fetchModelContextSize(sessionModel);

    let mcpBridge: McpBridgeState | null = null;
    let mcpTools: OllamaSession["mcpTools"] = [];

    if (projectId) {
      try {
        const result = await getMcpToolsForOllama(projectId);
        mcpBridge = result.state;
        mcpTools = result.tools;
        if (mcpTools.length > 0) {
          log("OLLAMA", `session ${sessionId}: ${mcpTools.length} MCP tool(s) loaded`);
        }
      } catch (err) {
        log("OLLAMA", `MCP init failed (continuing without): ${(err as Error).message}`);
      }
    }

    let skillContents: string[] = [];
    if (activeSkills && activeSkills.length > 0) {
      const skillsDir = path.join(cwd, ".harnss", "skills");
      for (const id of activeSkills) {
        const filePath = path.join(skillsDir, `${id}.md`);
        try {
          if (fs.existsSync(filePath)) {
            skillContents.push(fs.readFileSync(filePath, "utf-8"));
            log("OLLAMA", `skill loaded: ${id}`);
          }
        } catch {}
      }
      if (skillContents.length > 0) {
        log("OLLAMA", `${skillContents.length} skill(s) injected into system prompt`);
      }
    }

    const mcpToolNames = mcpTools.map((t) => `${t.function.name}: ${t.function.description}`);

    sessions.set(sessionId, {
      messages: [{ role: "system", content: buildSystemPrompt(cwd, skillContents, mcpToolNames) }],
      cwd,
      model: sessionModel,
      contextSize,
      abortController: null,
      state: freshState(),
      mcpBridge,
      mcpTools,
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
        mcpBridge: null,
        mcpTools: [],
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

        const streamResult = await streamOllamaChat(session, controller, getMainWindow, sessionId);

        if (streamResult.toolCalls.length === 0) {
          session.messages.push({ role: "assistant", content: streamResult.content });
          emit(getMainWindow, sessionId, "chat:final", { message: streamResult.content });
          break;
        }

        session.messages.push({
          role: "assistant",
          content: streamResult.content,
          tool_calls: streamResult.toolCalls,
        });

        if (streamResult.content) {
          emit(getMainWindow, sessionId, "chat:mid-final", { message: streamResult.content });
        } else {
          emit(getMainWindow, sessionId, "chat:clear-streaming", {});
        }

        let ops = 0;
        for (const call of streamResult.toolCalls) {
          if (ops >= MAX_TOOL_OPS) break;
          ops++;
          const isMcp = call.function.name.startsWith("mcp_") && session.mcpBridge?.toolMap.has(call.function.name);
          const result = isMcp
            ? await executeMcpToolCall(call, session, getMainWindow, sessionId)
            : await executeToolCall(call, session.cwd, session.state, getMainWindow, sessionId);
          session.messages.push({ role: "tool", content: result.content });
        }

        const isLoop = detectLoop(session.state, streamResult.toolCalls);
        if (isLoop) {
          log("OLLAMA", `repetitive loop detected at iteration ${loopCount} — asking model to reconsider`);
          session.messages.push({
            role: "user",
            content: "You are repeating the same tool calls. Stop and think from a different perspective. Summarize what you have done so far and try a completely different approach, or answer the user's question now.",
          });
        }

        emit(getMainWindow, sessionId, "lifecycle:start", {});
        emitContextUsage(getMainWindow, sessionId, session);
      }

      if (loopCount >= MAX_TOOL_LOOPS) {
        log("OLLAMA", `hard limit reached (${MAX_TOOL_LOOPS})`);
        const lastAssistant = session.messages.filter((m) => m.role === "assistant").pop()?.content ?? "";
        emit(getMainWindow, sessionId, "chat:final", { message: lastAssistant });
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
      if (session.mcpBridge) disconnectMcpBridge(session.mcpBridge);
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
