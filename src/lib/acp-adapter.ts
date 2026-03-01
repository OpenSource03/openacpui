export { SimpleStreamingBuffer as ACPStreamingBuffer } from "./streaming-buffer";

/**
 * Normalize ACP tool input into Claude SDK-compatible shape so ToolCall.tsx
 * renderers (BashContent, ReadContent, EditContent, etc.) work identically.
 *
 * ACP agents like Codex wrap every operation in a shell command:
 *   rawInput = { command: ["/bin/zsh", "-lc", "cat file.ts"], parsed_cmd: [...], cwd }
 * Claude SDK sends structured fields:
 *   { command: "cat file.ts" } or { file_path: "/path" }
 *
 * When `kind` is provided, we detect the ACP shell-command shape and transform it.
 * If the input already has SDK-style fields, we pass through unchanged.
 */
export function normalizeToolInput(
  rawInput: unknown,
  kind?: string,
  locations?: Array<{ path: string; line?: number }>,
): Record<string, unknown> {
  if (rawInput === null || rawInput === undefined || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return {};
  }

  const raw = rawInput as Record<string, unknown>;

  // Already SDK-shaped — pass through (handles agents that send standard fields).
  // Use truthiness checks (not just typeof) to avoid matching empty strings
  // that ACP agents might send alongside their shell-command structure.
  if ((typeof raw.file_path === "string" && raw.file_path)
    || (typeof raw.pattern === "string" && raw.pattern)
    || (typeof raw.command === "string" && raw.command)) {
    return raw;
  }

  // No kind = not a typed ACP tool call, passthrough
  if (!kind) return raw;

  const parsedCmds = raw.parsed_cmd as Array<{
    type?: string;
    cmd?: string;
    name?: string;
    path?: string;
  }> | undefined;
  const firstParsed = parsedCmds?.[0];
  const shellCommand = extractShellCommand(raw.command);

  switch (kind) {
    case "read": {
      const filePath = locations?.[0]?.path
        ?? (firstParsed?.path ? resolveRelativePath(firstParsed.path, raw.cwd as string | undefined) : null);
      if (filePath) return { file_path: filePath };
      // Can't determine file path — fall back to Bash-like display
      return shellCommand ? { command: shellCommand } : raw;
    }

    case "execute":
      return shellCommand ? { command: shellCommand } : raw;

    case "search":
      // ACP search is a shell command (rg, find, etc.) — normalize to Bash shape
      return shellCommand ? { command: shellCommand } : raw;

    case "edit": {
      // file_path from locations; old_string/new_string come from content[] via normalizeToolResult
      const filePath = locations?.[0]?.path
        ?? (firstParsed?.path ? resolveRelativePath(firstParsed.path, raw.cwd as string | undefined) : null);
      const result: Record<string, unknown> = {};
      if (filePath) result.file_path = filePath;
      if (typeof raw.old_string === "string") result.old_string = raw.old_string;
      if (typeof raw.new_string === "string") result.new_string = raw.new_string;
      return Object.keys(result).length > 0 ? result : (shellCommand ? { command: shellCommand } : raw);
    }

    case "delete": {
      const filePath = locations?.[0]?.path ?? null;
      if (filePath) return { file_path: filePath, content: "(deleted)" };
      return shellCommand ? { command: shellCommand } : raw;
    }

    case "fetch": {
      if (typeof raw.url === "string") return { url: raw.url };
      // Try to extract URL from the shell command
      if (shellCommand) {
        const urlMatch = shellCommand.match(/https?:\/\/\S+/);
        if (urlMatch) return { url: urlMatch[0] };
      }
      return raw;
    }

    default:
      return raw;
  }
}

/**
 * Extract the actual command string from ACP's command array.
 * ACP sends: ["/bin/zsh", "-lc", "cat src/file.ts"] — we want "cat src/file.ts".
 */
function extractShellCommand(command: unknown): string | null {
  if (typeof command === "string") return command;
  if (!Array.isArray(command)) return null;
  // Pattern: [shell, flag, actualCommand] e.g. ["/bin/zsh", "-lc", "cat file.ts"]
  // or [shell, script] e.g. ["python", "script.py"]
  // Always return the last element if it's a string — that's the actual command.
  const last = command[command.length - 1];
  if (command.length >= 1 && typeof last === "string") return last;
  return null;
}

/** Resolve a relative path against cwd. Returns as-is if already absolute or cwd missing. */
function resolveRelativePath(path: string, cwd?: string | null): string {
  if (path.startsWith("/") || !cwd) return path;
  return `${cwd.replace(/\/$/, "")}/${path}`;
}

export function normalizeToolResult(rawOutput: unknown, content?: unknown[]): Record<string, unknown> | undefined {
  if (!rawOutput && (!content || content.length === 0)) return undefined;

  const result: Record<string, unknown> = {};

  if (rawOutput && typeof rawOutput === "object") {
    Object.assign(result, rawOutput);
  } else if (typeof rawOutput === "string") {
    result.content = rawOutput;
  }

  if (content) {
    for (const item of content) {
      if (isDiffContent(item)) {
        result.filePath = item.path;
        result.oldString = item.oldText;
        result.newString = item.newText;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function isDiffContent(item: unknown): item is { type: "diff"; path: string; oldText: string; newText: string } {
  return typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "diff";
}

/**
 * Pick the best auto-response option from agent-provided permission options.
 * Returns the optionId to auto-select, or null if no matching allow option exists
 * (which means the request should fall through to the manual permission prompt).
 */
export function pickAutoResponseOption(
  options: Array<{ optionId: string; kind: string }>,
  behavior: "ask" | "auto_accept" | "allow_all",
): string | null {
  if (behavior === "ask") return null;

  if (behavior === "allow_all") {
    // Prefer allow_always for blanket approval, fall back to allow_once
    return (options.find(o => o.kind === "allow_always")
         ?? options.find(o => o.kind === "allow_once"))?.optionId ?? null;
  }

  if (behavior === "auto_accept") {
    // Per-tool approval only — use allow_once
    return options.find(o => o.kind === "allow_once")?.optionId ?? null;
  }

  return null;
}

export function deriveToolName(title: string, kind?: string): string {
  if (kind) {
    const kindMap: Record<string, string> = {
      read: "Read",
      edit: "Edit",
      delete: "Write",
      execute: "Bash",
      search: "Bash", // ACP search runs shell commands (rg, find, etc.)
      think: "Think",
      fetch: "WebFetch",
    };
    return kindMap[kind] ?? title;
  }
  return title;
}
