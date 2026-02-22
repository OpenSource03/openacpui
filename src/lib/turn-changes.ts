import type { UIMessage } from "@/types";

// ── Types ──

export interface FileChange {
  filePath: string;
  fileName: string;
  changeType: "modified" | "created";
  toolName: string;
  oldString?: string;
  newString?: string;
  /** Full content for Write tool (new file creation). */
  content?: string;
  messageId: string;
  timestamp: number;
}

export interface TurnSummary {
  turnIndex: number;
  userMessageId: string;
  /** Index of the last message in this turn (used to position inline summary). */
  endMessageIndex: number;
  changes: FileChange[];
  /** Deduplicated count of unique file paths touched. */
  fileCount: number;
  modifiedCount: number;
  createdCount: number;
}

// ── Helpers ──

function basename(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}

/** Extract a file change from a tool_call message, if it's a file-modifying tool. */
function extractChange(msg: UIMessage): FileChange | null {
  const { toolName, toolInput } = msg;
  if (!toolName || !toolInput) return null;

  switch (toolName) {
    case "Edit": {
      const filePath = String(toolInput.file_path ?? "");
      if (!filePath) return null;
      return {
        filePath,
        fileName: basename(filePath),
        changeType: "modified",
        toolName,
        oldString: String(toolInput.old_string ?? ""),
        newString: String(toolInput.new_string ?? ""),
        messageId: msg.id,
        timestamp: msg.timestamp,
      };
    }
    case "Write": {
      const filePath = String(toolInput.file_path ?? "");
      if (!filePath) return null;
      return {
        filePath,
        fileName: basename(filePath),
        changeType: "created",
        toolName,
        content: String(toolInput.content ?? ""),
        messageId: msg.id,
        timestamp: msg.timestamp,
      };
    }
    case "NotebookEdit": {
      const filePath = String(toolInput.notebook_path ?? "");
      if (!filePath) return null;
      return {
        filePath,
        fileName: basename(filePath),
        changeType: "created",
        toolName,
        content: String(toolInput.new_source ?? ""),
        messageId: msg.id,
        timestamp: msg.timestamp,
      };
    }
    default:
      return null;
  }
}

/** Extract file changes from subagent steps (nested tool calls in Task tool). */
function extractSubagentChanges(msg: UIMessage): FileChange[] {
  if (!msg.subagentSteps?.length) return [];

  const results: FileChange[] = [];
  for (const step of msg.subagentSteps) {
    const toolName = step.toolName;
    const input = step.toolInput as Record<string, unknown> | undefined;
    if (!toolName || !input) continue;

    let filePath = "";
    let changeType: "modified" | "created" = "modified";
    let oldString: string | undefined;
    let newString: string | undefined;
    let content: string | undefined;

    switch (toolName) {
      case "Edit":
        filePath = String(input.file_path ?? "");
        changeType = "modified";
        oldString = String(input.old_string ?? "");
        newString = String(input.new_string ?? "");
        break;
      case "Write":
        filePath = String(input.file_path ?? "");
        changeType = "created";
        content = String(input.content ?? "");
        break;
      case "NotebookEdit":
        filePath = String(input.notebook_path ?? "");
        changeType = "created";
        content = String(input.new_source ?? "");
        break;
      default:
        continue;
    }

    if (!filePath) continue;
    results.push({
      filePath,
      fileName: basename(filePath),
      changeType,
      toolName,
      oldString,
      newString,
      content,
      messageId: msg.id,
      timestamp: msg.timestamp,
    });
  }
  return results;
}

function computeStats(changes: FileChange[]) {
  const files = new Set(changes.map((c) => c.filePath));
  let modified = 0;
  let created = 0;
  // For per-file stats, highest priority wins: created > modified
  const typeByFile = new Map<string, "modified" | "created">();
  for (const c of changes) {
    const current = typeByFile.get(c.filePath);
    if (!current || (c.changeType === "created" && current === "modified")) {
      typeByFile.set(c.filePath, c.changeType);
    }
  }
  for (const type of typeByFile.values()) {
    if (type === "modified") modified++;
    else created++;
  }
  return { fileCount: files.size, modifiedCount: modified, createdCount: created };
}

// ── Public API ──

/**
 * Extract per-turn file change summaries from the message array.
 * Skips the current in-progress turn (when isProcessing is true).
 * Only returns turns that have at least one file change.
 */
export function extractTurnSummaries(
  messages: UIMessage[],
  isProcessing: boolean,
): TurnSummary[] {
  const summaries: TurnSummary[] = [];
  let turnIndex = 0;
  let turnStartIdx = -1;
  let userMsgId = "";

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user") {
      // Close previous turn (if any)
      if (turnStartIdx >= 0) {
        const changes = collectChangesInRange(messages, turnStartIdx, i);
        if (changes.length > 0) {
          summaries.push({
            turnIndex,
            userMessageId: userMsgId,
            endMessageIndex: i - 1,
            changes,
            ...computeStats(changes),
          });
        }
        turnIndex++;
      }
      turnStartIdx = i;
      userMsgId = msg.id;
    }
  }

  // Close the last turn — but only if we're not mid-turn
  if (turnStartIdx >= 0 && !isProcessing) {
    const changes = collectChangesInRange(messages, turnStartIdx, messages.length);
    if (changes.length > 0) {
      summaries.push({
        turnIndex,
        userMessageId: userMsgId,
        endMessageIndex: messages.length - 1,
        changes,
        ...computeStats(changes),
      });
    }
  }

  return summaries;
}

/** Collect file changes from messages in [start, end) range. */
function collectChangesInRange(
  messages: UIMessage[],
  start: number,
  end: number,
): FileChange[] {
  const changes: FileChange[] = [];
  for (let i = start; i < end; i++) {
    const msg = messages[i];
    if (msg.role === "tool_call") {
      const change = extractChange(msg);
      if (change) changes.push(change);
      // Also check subagent steps (Task tool with nested file changes)
      changes.push(...extractSubagentChanges(msg));
    }
  }
  return changes;
}

/** Flat list of all file changes across all turns. */
export function extractAllFileChanges(messages: UIMessage[]): FileChange[] {
  return collectChangesInRange(messages, 0, messages.length);
}

/** Group changes by file path for cumulative view. */
export function groupChangesByFile(
  changes: FileChange[],
): Map<string, FileChange[]> {
  const grouped = new Map<string, FileChange[]>();
  for (const change of changes) {
    const existing = grouped.get(change.filePath);
    if (existing) {
      existing.push(change);
    } else {
      grouped.set(change.filePath, [change]);
    }
  }
  return grouped;
}
