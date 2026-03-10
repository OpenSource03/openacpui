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
    // Even with non-object rawInput (e.g., edit patch text), extract file_path from locations
    if (kind && locations?.length) {
      if (kind === "edit" || kind === "read" || kind === "delete") {
        return { file_path: locations[0].path };
      }
    }
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
    case "think": {
      const todos = parseTodosFromUnknown(raw.todos);
      if (todos) return { todos };
      return raw;
    }

    case "read": {
      const filePath = locations?.[0]?.path
        ?? (typeof raw.filePath === "string" ? raw.filePath : null)
        ?? (firstParsed?.path ? resolveRelativePath(firstParsed.path, raw.cwd as string | undefined) : null);
      if (filePath) {
        const result: Record<string, unknown> = { file_path: filePath };
        // Preserve line range info for display (ACP agents send these)
        if (typeof raw.startLineNumberBaseOne === "number") result.startLine = raw.startLineNumberBaseOne;
        if (typeof raw.endLineNumberBaseOne === "number") result.endLine = raw.endLineNumberBaseOne;
        return result;
      }
      // Can't determine file path — fall back to Bash-like display
      return shellCommand ? { command: shellCommand } : raw;
    }

    case "execute":
      // Subagent/task calls — normalize to Task-like input shape
      if (typeof raw.agentName === "string" || typeof raw.task === "string") {
        const result: Record<string, unknown> = {};
        if (typeof raw.agentName === "string") result.subagent_type = raw.agentName;
        if (typeof raw.task === "string") { result.description = raw.task; result.prompt = raw.task; }
        return result;
      }
      return shellCommand ? { command: shellCommand } : raw;

    case "search":
      // ACP agents may send structured search input instead of shell commands
      if (typeof raw.query === "string") {
        const result: Record<string, unknown> = { pattern: raw.query };
        if (typeof raw.includePattern === "string") result.glob = raw.includePattern;
        if (typeof raw.path === "string") result.path = raw.path;
        return result;
      }
      // Shell-command-based search (rg, find, etc.) — normalize to Bash shape
      return shellCommand ? { command: shellCommand } : raw;

    case "edit": {
      // file_path from locations; old_string/new_string come from content[] via normalizeToolResult
      const filePath = locations?.[0]?.path
        ?? (typeof raw.filePath === "string" ? raw.filePath : null)
        ?? (firstParsed?.path ? resolveRelativePath(firstParsed.path, raw.cwd as string | undefined) : null);
      const result: Record<string, unknown> = {};
      if (filePath) result.file_path = filePath;
      if (typeof raw.old_string === "string") result.old_string = raw.old_string;
      if (typeof raw.new_string === "string") result.new_string = raw.new_string;
      // Preserve content for create_file (Write renderer uses toolInput.content)
      if (typeof raw.content === "string" && !result.old_string && !result.new_string) {
        result.content = raw.content;
      }
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

export function mergeToolInput(
  existingInput: Record<string, unknown> | undefined,
  rawInput: unknown,
  kind?: string,
  locations?: Array<{ path: string; line?: number }>,
): Record<string, unknown> | undefined {
  const normalized = normalizeToolInput(rawInput, kind, locations);
  if (Object.keys(normalized).length === 0) {
    return existingInput;
  }
  if (!existingInput || Object.keys(existingInput).length === 0) {
    return normalized;
  }

  // ACP tool_call events are often partial and tool_call_update later adds the
  // actual file path, pattern, or command. Merge so renderers keep both.
  return {
    ...existingInput,
    ...normalized,
  };
}

/** Resolve a relative path against cwd. Returns as-is if already absolute or cwd missing. */
function resolveRelativePath(path: string, cwd?: string | null): string {
  if (path.startsWith("/") || !cwd) return path;
  return `${cwd.replace(/\/$/, "")}/${path}`;
}

function parseTodosFromUnknown(value: unknown): Array<{ content: string; status: "pending" | "completed" }> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const todos: Array<{ content: string; status: "pending" | "completed" }> = [];
  for (const line of value.split("\n")) {
    const match = line.match(/^\s*-\s*\[(x|X| )\]\s+(.+)$/);
    if (!match) continue;
    todos.push({
      content: match[2].trim(),
      status: match[1].toLowerCase() === "x" ? "completed" : "pending",
    });
  }
  return todos.length > 0 ? todos : null;
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
    const textContent = content
      .map(extractACPContentText)
      .filter((text): text is string => !!text)
      .join("\n");
    if (textContent && typeof result.content !== "string") {
      result.content = textContent;
    }
  }

  if (typeof result.output === "string" && typeof result.content !== "string") {
    result.content = result.output;
  }

  if (typeof result.filePath !== "string" || !result.filePath) {
    const parsedPath = extractEditedFilePath(result);
    if (parsedPath) result.filePath = parsedPath;
  }

  // ACP agents put file contents / search results in `content` but renderers check `stdout`.
  // Copy content to stdout so ReadContent, SearchContent, formatResult() all pick it up.
  if (!result.file && !result.stdout && typeof result.content === "string") {
    result.stdout = result.content;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function isDiffContent(item: unknown): item is { type: "diff"; path: string; oldText: string; newText: string } {
  return typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "diff";
}

function extractACPContentText(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (typeof item !== "object" || item === null) return null;
  const record = item as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (typeof record.content === "object" && record.content !== null) {
    const nested = record.content as Record<string, unknown>;
    if (typeof nested.text === "string") return nested.text;
  }
  return null;
}

function extractEditedFilePath(result: Record<string, unknown>): string | null {
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

export function deriveToolName(
  title: string,
  kind?: string,
  rawInput?: unknown,
): string {
  const input = (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput))
    ? rawInput as Record<string, unknown>
    : null;

  if (kind) {
    if (kind === "think") {
      if (title === "update_todo" || input?.todos != null) return "TodoWrite";
      return "Think";
    }
    if (kind === "read" && typeof input?.pattern === "string") {
      return "Glob";
    }
    if (kind === "search") {
      const titleLower = title.toLowerCase();
      if (titleLower === "glob" || titleLower === "find" || titleLower === "fd" || titleLower === "file_search") {
        return "Glob";
      }
      if (titleLower === "grep" || titleLower === "rg" || titleLower === "ripgrep" || titleLower === "codebase_search") {
        return "Grep";
      }
    }
    // ACP "other" kind — route based on title (rg → Grep, find/fd → Glob)
    if (kind === "other") {
      const titleLower = title.toLowerCase();
      if (titleLower === "task") return "Task";
      if (titleLower === "agent") return "Agent";
      if (titleLower === "rg" || titleLower === "ripgrep") return "Grep";
      if (titleLower === "find" || titleLower === "fd") return "Glob";
      return title;
    }
    // Title-based resolution: ACP agents use descriptive tool titles
    // that map more precisely than the coarse `kind` categories.
    const titleLower = title.toLowerCase();
    const titleMap: Record<string, string> = {
      run_subagent: "Task",
      grep_search: "Grep",
      file_search: "Glob",
      codebase_search: "Grep",
      create_file: "Write",
      create_new_file: "Write",
      write_file: "Write",
      write_to_file: "Write",
      insert_text: "Edit",
      replace_in_file: "Edit",
      edit_file: "Edit",
      read_file: "Read",
      list_dir: "Read",
    };
    if (titleMap[titleLower]) return titleMap[titleLower];

    const kindMap: Record<string, string> = {
      read: "Read",
      edit: "Edit",
      delete: "Write",
      execute: "Bash",
      search: "Bash", // ACP search runs shell commands (rg, find, etc.)
      fetch: "WebFetch",
    };
    return kindMap[kind] ?? title;
  }
  return title;
}
