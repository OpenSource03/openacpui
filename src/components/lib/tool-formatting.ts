import type { UIMessage, SubagentToolStep } from "@/types";
import { getMcpCompactSummary } from "@/components/McpToolContent";
import { getTodoItems } from "@/lib/todo-utils";

// ── Compact summary for collapsed tool line ──

export function formatCompactSummary(message: UIMessage): string {
  const input = message.toolInput;
  const toolName = message.toolName ?? "";
  const result = message.toolResult;
  const filePathFromResult = extractResultFilePath(result);
  if (!input) {
    return filePathFromResult ? filePathFromResult.split("/").pop() ?? filePathFromResult : "";
  }

  // Plan mode tools — extract plan title from markdown heading
  if (toolName === "ExitPlanMode") {
    const plan = String(input.plan ?? "");
    const titleMatch = plan.match(/^#\s+(.+)$/m);
    return titleMatch?.[1] ?? "implementation plan";
  }
  if (toolName === "EnterPlanMode") return "";

  // AskUserQuestion — show the full question text as compact summary
  if (toolName === "AskUserQuestion") {
    const questions = input.questions as Array<{ question: string; header: string }> | undefined;
    if (questions && questions.length > 0) {
      return questions[0].question;
    }
    return "";
  }

  // MCP tools (mcp__Server__tool) or ACP tools (Tool: Server/tool) — delegate to specialized summaries
  if (toolName.startsWith("mcp__") || toolName.startsWith("Tool: ")) {
    const mcpSummary = getMcpCompactSummary(toolName, input);
    if (mcpSummary) return mcpSummary;
    // Fallback: show the MCP tool's short name
    if (toolName.startsWith("mcp__")) {
      const parts = toolName.split("__");
      return parts.length >= 3 ? parts.slice(2).join("__") : toolName;
    }
    const slashParts = toolName.slice(6).split("/");
    return slashParts.length >= 2 ? slashParts.slice(1).join("/") : toolName;
  }

  if (toolName === "TodoWrite" && input.todos != null) {
    const todos = getTodoItems(input.todos);
    const completed = todos.filter((t) => t.status === "completed").length;
    return `${completed}/${todos.length} completed`;
  }
  // ToolSearch — show query and match count
  if (toolName === "ToolSearch") {
    const query = String(input.query ?? "");
    const display = query.startsWith("select:") ? query.slice(7) : query;
    return display.slice(0, 60);
  }

  if (input.command) return String(input.command).split("\n")[0];
  if (input.file_path) return String(input.file_path).split("/").pop() ?? "";
  if (filePathFromResult) return filePathFromResult.split("/").pop() ?? filePathFromResult;
  if (input.pattern) {
    const pat = String(input.pattern);
    const glob = input.glob ? ` in ${String(input.glob)}` : "";
    const suffix = getSearchResultSuffix(result);
    return pat + glob + suffix;
  }
  if (input.query) return String(input.query).slice(0, 60);
  if (input.url) {
    try {
      return new URL(String(input.url)).hostname;
    } catch {
      return String(input.url).slice(0, 60);
    }
  }
  return "";
}

/** Derive a short suffix like " → 3 files" from structured Grep/Glob results. */
function getSearchResultSuffix(result: UIMessage["toolResult"]): string {
  if (!result || !("mode" in result)) return "";
  const numFiles = "numFiles" in result ? Number(result.numFiles) : 0;
  const numLines = "numLines" in result ? Number(result.numLines) : 0;
  const mode = String(result.mode);
  if (mode === "files_with_matches" && numFiles > 0) return ` → ${numFiles} file${numFiles !== 1 ? "s" : ""}`;
  if (mode === "content" && numLines > 0) return ` → ${numLines} line${numLines !== 1 ? "s" : ""}`;
  if (numFiles === 0 && numLines === 0) return " → no matches";
  return "";
}

function extractResultFilePath(result: UIMessage["toolResult"]): string | null {
  if (!result) return null;
  if (typeof result.filePath === "string" && result.filePath) return result.filePath;
  if (result.file?.filePath) return result.file.filePath;
  if (typeof result.content === "string") {
    const modifiedMatch = result.content.match(/Modified\s+\d+\s+file\(s\):\s+([^\n]+)/i);
    if (modifiedMatch?.[1]) return modifiedMatch[1].trim();
  }
  if (typeof result.detailedContent === "string") {
    const diffMatch = result.detailedContent.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    if (diffMatch?.[2]) return diffMatch[2].trim();
  }
  return null;
}

// ── Task formatting ──

export function formatTaskTitle(message: UIMessage): string {
  const input = message.toolInput;
  if (!input) return "Task";
  const desc = String(input.description ?? "");
  const agentType = String(input.subagent_type ?? input.subagentType ?? "");
  if (agentType && desc) return `${agentType}: ${desc}`;
  if (desc) return `Task: ${desc}`;
  return "Task";
}

export function formatTaskRunningTitle(message: UIMessage): string {
  const input = message.toolInput;
  if (!input) return "Running agent...";
  const agentType = String(input.subagent_type ?? input.subagentType ?? "");
  const desc = String(input.description ?? "");
  if (agentType) return `Running ${agentType}...`;
  if (desc) return `Running: ${desc}`;
  return "Running agent...";
}

export function formatTaskSummary(message: UIMessage): string {
  const input = message.toolInput;
  if (!input) return "task";
  const agentType = String(input.subagent_type ?? input.subagentType ?? "");
  const desc = String(input.description ?? "");
  if (agentType && desc) return `${agentType} to ${desc}`;
  if (agentType) return agentType;
  if (desc) return desc;
  return "task";
}

export function formatLatestStep(steps: SubagentToolStep[]): string {
  const last = steps[steps.length - 1];
  if (!last) return "";
  return `${last.toolName} ${formatStepSummary(last)}`;
}

export function formatStepSummary(step: SubagentToolStep): string {
  const input = step.toolInput;
  if (input.file_path) return String(input.file_path).split("/").pop() ?? "";
  if (input.command) return String(input.command).split("\n")[0].slice(0, 60);
  if (input.pattern) return String(input.pattern);
  if (input.description) return String(input.description).slice(0, 90);
  return "";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTaskResult(content: string | Array<{ type: string; text: string }>): string {
  const raw = typeof content === "string"
    ? content
    : content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return stripTaskResultWrapper(raw);
}

function stripTaskResultWrapper(text: string): string {
  const hasResumePrefix = /^task_id:\s+\S+\s+\(for resuming to continue this task if needed\)/m.test(text);
  if (!hasResumePrefix) return text;
  return text
    .replace(/\n\n<task_result>\n\n/, "\n\n")
    .replace(/\n<\/task_result>\s*$/, "")
    .trimEnd();
}

export function formatInput(input: Record<string, unknown>): string {
  if (input.file_path && Object.keys(input).length <= 3) {
    const parts = [`file: ${input.file_path}`];
    if (input.command) parts.push(`command: ${input.command}`);
    return parts.join("\n");
  }
  if (input.command && Object.keys(input).length === 1) {
    return String(input.command);
  }
  return JSON.stringify(input, null, 2);
}

export function formatBashResult(result: UIMessage["toolResult"]): string {
  if (!result) return "";
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (!result.stdout && typeof result.content === "string") {
    parts.push(result.content);
  }
  if (!result.stdout && Array.isArray(result.content)) {
    parts.push(result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"));
  }
  if (result.stderr) parts.push(result.stderr);
  return parts.join("\n") || "(no output)";
}

/** Check if a tool result is the synthetic `{ status: "completed" }` marker
 *  created by closePendingTools (ACP fast-tool fallback). */
export function isCompletionSentinel(result: UIMessage["toolResult"]): boolean {
  if (!result) return false;
  const keys = Object.keys(result);
  return keys.length === 1 && result.status === "completed";
}

export function formatResult(result: UIMessage["toolResult"]): string {
  if (!result) return "";

  // Synthetic completion marker from closePendingTools — no real output
  if (isCompletionSentinel(result)) return "";

  if (result.file) {
    const { filePath, numLines, totalLines } = result.file;
    return `${filePath} (${numLines}/${totalLines} lines)`;
  }

  if (result.stdout !== undefined) {
    const parts: string[] = [];
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr: ${result.stderr}`);
    return parts.join("\n") || "(no output)";
  }

  if (result.filePath && result.newString !== undefined) {
    return `Edited ${result.filePath}`;
  }

  if (result.isAsync) {
    return `Launched agent ${result.agentId ?? ""} (${result.status})`;
  }

  return JSON.stringify(result, null, 2);
}

// ── Shared helper: extract text from toolResult (stdout → string content → array content) ──

export function extractResultText(result: UIMessage["toolResult"]): string {
  if (!result) return "";
  if (result.stdout) return result.stdout;
  if (typeof result.content === "string") return result.content;
  if (Array.isArray(result.content)) {
    return result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  }
  return "";
}

// ── Search link parsing ──

/** Parse the `Links: [{title, url}...]` JSON embedded in WebSearch stdout */
export function parseSearchLinks(text: string): Array<{ title: string; url: string }> {
  const match = text.match(/Links:\s*(\[[\s\S]*?\])\n/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]);
  } catch {
    return [];
  }
}

// ── Generic helpers ──

export function firstDefinedString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string") return value;
  }
  return "";
}
