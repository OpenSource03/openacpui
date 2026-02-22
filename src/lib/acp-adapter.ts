export class ACPStreamingBuffer {
  messageId: string | null = null;
  private textChunks: string[] = [];
  private thinkingChunks: string[] = [];
  thinkingComplete = false;

  appendText(text: string): void { this.textChunks.push(text); }
  appendThinking(text: string): void { this.thinkingChunks.push(text); }

  getText(): string { return this.textChunks.join(""); }
  getThinking(): string { return this.thinkingChunks.join(""); }

  reset(): void {
    this.messageId = null;
    this.textChunks = [];
    this.thinkingChunks = [];
    this.thinkingComplete = false;
  }
}

export function normalizeToolInput(rawInput: unknown): Record<string, unknown> {
  if (rawInput !== null && rawInput !== undefined && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }
  return {};
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
      search: "Grep",
      think: "Think",
      fetch: "WebFetch",
    };
    return kindMap[kind] ?? title;
  }
  return title;
}
