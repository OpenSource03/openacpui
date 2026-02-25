/**
 * Codex event adapter — translates Codex app-server notifications into UIMessages.
 *
 * The Codex protocol uses item-based events (item/started, item/completed, deltas).
 * Each item type maps to a UIMessage role + toolName for the existing ToolCall UI.
 */

import type { TodoItem, ModelInfo } from "@/types";
import type { CodexThreadItem } from "@/types/codex";
import type { Model as CodexModel } from "@/types/codex-protocol/v2/Model";

// ── Streaming buffer (reuses ACPStreamingBuffer pattern) ──

export class CodexStreamingBuffer {
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

// ── Item type → tool name mapping ──

/**
 * Map a Codex ThreadItem type to a tool name for the existing ToolCall.tsx renderers.
 * Returns null for item types that don't map to tool calls (agentMessage, reasoning, etc.).
 */
export function codexItemToToolName(item: CodexThreadItem): string | null {
  switch (item.type) {
    case "commandExecution":
      return "Bash";
    case "fileChange":
      return inferFileChangeTool(item);
    case "mcpToolCall":
      return `mcp__${item.server}__${item.tool}`;
    case "webSearch":
      return "WebSearch";
    case "imageView":
      return "Read"; // reuse Read renderer for image display
    default:
      return null;
  }
}

/** Infer whether a fileChange is a Write (new file) or Edit (modify existing). */
function inferFileChangeTool(item: Extract<CodexThreadItem, { type: "fileChange" }>): string {
  if (!item.changes || item.changes.length === 0) return "Edit";
  // If any change has kind "create", treat as Write
  const hasCreate = item.changes.some(
    (c) => (c as Record<string, unknown>).kind === "create",
  );
  return hasCreate ? "Write" : "Edit";
}

// ── Item → tool input mapping ──

/** Extract structured tool input from a Codex item for ToolCall.tsx renderers. */
export function codexItemToToolInput(item: CodexThreadItem): Record<string, unknown> {
  switch (item.type) {
    case "commandExecution":
      return {
        command: item.command ?? "",
        ...(item.cwd ? { description: `cwd: ${item.cwd}` } : {}),
      };
    case "fileChange": {
      const firstChange = item.changes?.[0] as Record<string, unknown> | undefined;
      return {
        file_path: firstChange?.path ?? "",
        ...(item.changes?.length > 1
          ? { description: `${item.changes.length} files` }
          : {}),
      };
    }
    case "mcpToolCall":
      return (item.arguments ?? {}) as Record<string, unknown>;
    case "webSearch":
      return { query: item.query ?? "" };
    case "imageView":
      return { file_path: item.path ?? "" };
    default:
      return {};
  }
}

// ── Item → tool result mapping ──

/** Extract structured tool result from a completed Codex item. */
export function codexItemToToolResult(item: CodexThreadItem): { content: string } | undefined {
  switch (item.type) {
    case "commandExecution": {
      const parts: string[] = [];
      if (item.aggregatedOutput) parts.push(item.aggregatedOutput);
      if (item.exitCode != null) parts.push(`\nExit code: ${item.exitCode}`);
      if (item.durationMs != null) parts.push(`(${item.durationMs}ms)`);
      return parts.length > 0 ? { content: parts.join("") } : undefined;
    }
    case "fileChange": {
      // Build a diff summary from changes
      const diffs = (item.changes ?? [])
        .map((c) => {
          const change = c as Record<string, unknown>;
          return change.diff ? String(change.diff) : `${change.kind ?? "modified"}: ${change.path}`;
        })
        .join("\n");
      return diffs ? { content: diffs } : undefined;
    }
    case "mcpToolCall": {
      if (item.error) {
        return { content: `Error: ${JSON.stringify(item.error)}` };
      }
      if (item.result) {
        return { content: typeof item.result === "string" ? item.result : JSON.stringify(item.result) };
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

// ── Approval policy mapping ──

/**
 * Map Codex approval policy names to UI-friendly labels.
 * Codex uses: "onRequest" | "unlessTrusted" | "never"
 */
export const CODEX_APPROVAL_LABELS: Record<string, string> = {
  onRequest: "Ask First",
  unlessTrusted: "Accept Trusted",
  never: "Allow All",
};

/** Map our permission mode names to Codex approval policy values. */
export function permissionModeToCodexPolicy(mode: string): string | undefined {
  switch (mode) {
    case "default":
    case "plan":
      return "onRequest";
    case "acceptEdits":
      return "unlessTrusted";
    case "bypassPermissions":
    case "dontAsk":
      return "never";
    default:
      return undefined;
  }
}

// ── Turn plan → TodoItem mapping ──

/** Convert Codex turn/plan/updated steps to TodoItem[] for the TodoPanel. */
export function codexPlanToTodos(
  planSteps: Array<{ step: string; status: string }>,
): TodoItem[] {
  return planSteps.map((s) => ({
    content: s.step,
    status: s.status === "completed"
      ? "completed"
      : s.status === "inProgress"
        ? "in_progress"
        : "pending",
  }));
}

// ── Command output delta accumulation ──

/**
 * Accumulate command execution output deltas into a running string.
 * Codex streams `item/commandExecution/outputDelta` with { itemId, delta }.
 */
export function appendCommandOutput(
  existing: string | undefined,
  delta: string,
): string {
  return (existing ?? "") + delta;
}

// ── Model mapping ──

/** Convert Codex `model/list` response items to our common ModelInfo format. */
export function codexModelsToModelInfo(models: CodexModel[]): ModelInfo[] {
  return models.map((m) => ({
    value: m.id,
    displayName: m.displayName,
    description: m.description ?? "",
  }));
}
