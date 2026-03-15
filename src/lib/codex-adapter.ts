/**
 * Codex event adapter — translates Codex app-server notifications into UIMessages.
 *
 * The Codex protocol uses item-based events (item/started, item/completed, deltas).
 * Each item type maps to a UIMessage role + toolName for the existing ToolCall UI.
 */

import type { TodoItem, ImageAttachment, ToolUseResult } from "@/types";
import type { CodexThreadItem } from "@/types/codex";
import type { FileUpdateChange } from "@/types/codex-protocol/v2/FileUpdateChange";
import type { PatchChangeKind } from "@/types/codex-protocol/v2/PatchChangeKind";
import type { TurnPlanStep } from "@/types/codex-protocol/v2/TurnPlanStep";
import type { WebSearchAction } from "@/types/codex-protocol/v2/WebSearchAction";
import { parseUnifiedDiff } from "@/lib/unified-diff";

export { SimpleStreamingBuffer as CodexStreamingBuffer } from "@/lib/streaming-buffer";

interface CodexWebSearchToolPayload {
  query: string;
  actionType: WebSearchAction["type"];
  actionQuery?: string;
  queries?: string[];
  url?: string;
  pattern?: string;
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
  return item.changes.every((change) => change.kind.type === "add")
    ? "Write"
    : "Edit";
}

/** Extract the simple kind label from a generated PatchChangeKind discriminant. */
function getPatchChangeKind(kind: PatchChangeKind): "add" | "delete" | "update" {
  return kind.type;
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
      const firstChange = item.changes?.[0];
      if (!firstChange) return { file_path: "" };
      const firstDiff = firstChange.diff ? parseUnifiedDiff(firstChange.diff) : null;
      const firstKind = getPatchChangeKind(firstChange.kind);
      const input: Record<string, unknown> = {
        file_path: firstChange.path,
      };

      if (firstDiff) {
        if (firstKind === "add") {
          input.content = firstDiff.newString;
        } else {
          input.old_string = firstDiff.oldString;
          input.new_string = firstDiff.newString;
        }
      } else if (firstChange.diff) {
        // Fallback: diff is raw file content (not unified format) — derive old/new from kind
        if (firstKind === "add") {
          input.content = firstChange.diff;
        } else if (firstKind === "delete") {
          input.old_string = firstChange.diff;
          input.new_string = "";
        }
      }
      if (item.changes.length > 1) {
        input.description = `${item.changes.length} files`;
      }
      return input;
    }
    case "mcpToolCall":
      return (item.arguments ?? {}) as Record<string, unknown>;
    case "webSearch":
      return codexWebSearchToToolPayload(item);
    case "imageView":
      return { file_path: item.path ?? "" };
    default:
      return {};
  }
}

// ── Item → tool result mapping ──

/** Extract structured tool result from a completed Codex item. */
export function codexItemToToolResult(item: CodexThreadItem): ToolUseResult | undefined {
  switch (item.type) {
    case "commandExecution": {
      const lines: string[] = [];
      if (item.aggregatedOutput) lines.push(item.aggregatedOutput);
      if (item.exitCode != null) lines.push(`Exit code: ${item.exitCode}`);
      if (item.durationMs != null) lines.push(`Duration: ${item.durationMs}ms`);
      if (lines.length === 0) return undefined;

      return {
        type: "text",
        stdout: lines.join("\n"),
        ...(item.exitCode != null ? { exitCode: item.exitCode } : {}),
        ...(item.durationMs != null ? { durationMs: item.durationMs } : {}),
      };
    }
    case "fileChange": {
      const parsedChanges = (item.changes ?? []).map((change: FileUpdateChange) => {
        const kind = getPatchChangeKind(change.kind);
        return {
          filePath: change.path,
          kind,
          diffText: change.diff,
          parsedDiff: change.diff ? parseUnifiedDiff(change.diff) : null,
        };
      });

      const firstParsed = parsedChanges.find((change) => change.parsedDiff) ?? null;
      const firstPath = parsedChanges.find((change) => change.filePath)?.filePath ?? "";
      const diffSummary = parsedChanges
        .map((change) => {
          if (change.diffText) return change.diffText;
          const kindLabel = change.kind ?? "modified";
          return `${kindLabel}: ${change.filePath}`;
        })
        .join("\n\n");
      if (!diffSummary) return undefined;

      const result: ToolUseResult = {
        content: diffSummary,
        ...(firstPath ? { filePath: firstPath } : {}),
        structuredPatch: parsedChanges.map((change) => ({
          filePath: change.filePath,
          kind: change.kind,
          diff: change.diffText,
          // When parseUnifiedDiff fails (raw content), derive old/new from kind
          oldString: change.parsedDiff?.oldString
            ?? (change.kind === "delete" ? change.diffText : undefined),
          newString: change.parsedDiff?.newString
            ?? (change.kind === "add" ? change.diffText : undefined),
        })),
      };
      const firstWithDiff = firstParsed
        ?? parsedChanges.find((change) => change.diffText);
      if (firstParsed?.parsedDiff) {
        result.oldString = firstParsed.parsedDiff.oldString;
        result.newString = firstParsed.parsedDiff.newString;
      } else if (firstWithDiff) {
        // Fallback: derive from kind when unified diff parsing failed
        if (firstWithDiff.kind === "delete") {
          result.oldString = firstWithDiff.diffText;
          result.newString = "";
        } else if (firstWithDiff.kind === "add") {
          result.oldString = "";
          result.newString = firstWithDiff.diffText;
        }
      }
      return result;
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
    case "webSearch": {
      const structuredContent = codexWebSearchToToolPayload(item);
      return {
        type: "web_search",
        status: "completed",
        content: describeWebSearchAction(structuredContent),
        structuredContent,
      };
    }
    default:
      return undefined;
  }
}

function codexWebSearchToToolPayload(
  item: Extract<CodexThreadItem, { type: "webSearch" }>,
): CodexWebSearchToolPayload {
  const action = item.action;
  if (!action) {
    return {
      query: item.query ?? "",
      actionType: "other",
    };
  }

  switch (action.type) {
    case "search":
      return {
        query: item.query ?? "",
        actionType: action.type,
        ...(action.query ? { actionQuery: action.query } : {}),
        ...(action.queries && action.queries.length > 0 ? { queries: action.queries } : {}),
      };
    case "openPage":
      return {
        query: item.query ?? "",
        actionType: action.type,
        ...(action.url ? { url: action.url } : {}),
      };
    case "findInPage":
      return {
        query: item.query ?? "",
        actionType: action.type,
        ...(action.url ? { url: action.url } : {}),
        ...(action.pattern ? { pattern: action.pattern } : {}),
      };
    case "other":
      return {
        query: item.query ?? "",
        actionType: action.type,
      };
  }
}

function describeWebSearchAction(payload: CodexWebSearchToolPayload): string {
  switch (payload.actionType) {
    case "search": {
      const queryCount = payload.queries?.length ?? 0;
      if (queryCount > 0) {
        return `Searched web with ${queryCount} quer${queryCount === 1 ? "y" : "ies"}`;
      }
      if (payload.actionQuery) {
        return `Searched web for ${payload.actionQuery}`;
      }
      if (payload.query) {
        return `Searched web for ${payload.query}`;
      }
      return "Searched web";
    }
    case "openPage":
      return payload.url ? `Opened ${payload.url}` : "Opened search result";
    case "findInPage":
      if (payload.url && payload.pattern) {
        return `Searched ${payload.url} for ${payload.pattern}`;
      }
      return "Searched within page";
    case "other":
      return payload.query ? `Web search: ${payload.query}` : "Completed web search";
  }
}

// ── Approval policy mapping ──

/**
 * Map Harnss permission modes to Codex approvalPolicy values.
 * Keep this in sync with src/types/codex-protocol/v2/AskForApproval.ts.
 */
export function permissionModeToCodexPolicy(mode: string): string | undefined {
  switch (mode) {
    case "default":
      return "on-request";
    case "acceptEdits":
      return "untrusted";
    case "bypassPermissions":
      return "never";
    default:
      return undefined;
  }
}

/**
 * Map Harnss permission modes to Codex sandbox mode.
 *
 * Codex approval policy controls prompts, while sandbox controls write access.
 * Without setting sandbox, Codex may inherit a read-only default from user config.
 */
export function permissionModeToCodexSandbox(mode: string): "workspace-write" | "danger-full-access" | undefined {
  switch (mode) {
    case "default":
    case "acceptEdits":
      return "workspace-write";
    case "bypassPermissions":
      return "danger-full-access";
    default:
      return undefined;
  }
}

// ── Turn plan → TodoItem mapping ──

/** Convert Codex turn/plan/updated steps to TodoItem[] for the TodoPanel. */
export function codexPlanToTodos(
  planSteps: Array<TurnPlanStep | { step: string; status: string }>,
): TodoItem[] {
  return planSteps.map((s) => ({
    content: s.step,
    status: (() => {
      const normalized = s.status.trim().toLowerCase();
      if (normalized === "completed") return "completed";
      if (normalized === "inprogress" || normalized === "in_progress" || normalized === "in-progress") {
        return "in_progress";
      }
      return "pending";
    })(),
  }));
}

export type CodexImageInput =
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };

/** Convert UI image attachments to Codex turn/start image inputs. */
export function imageAttachmentsToCodexInputs(
  images?: ImageAttachment[],
): CodexImageInput[] | undefined {
  if (!images || images.length === 0) return undefined;
  return images.map((img) => ({
    type: "image",
    url: `data:${img.mediaType};base64,${img.data}`,
  }));
}
