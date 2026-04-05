import type { UIMessage } from "../../types";
import { parseUnifiedDiffFromUnknown } from "@/lib/diff/unified-diff";
import {
  getStructuredPatches,
  getPatchPath,
  isMultiFileStructuredPatch,
  type StructuredPatchEntry,
} from "@/lib/diff/patch-utils";
import { firstDefinedString } from "@/components/lib/tool-formatting";

// ── Types ──

export interface FileChange {
  filePath: string;
  fileName: string;
  changeType: "modified" | "created";
  toolName: string;
  unifiedDiff?: string;
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

function getStructuredPatchEntry(
  result: UIMessage["toolResult"],
  filePath: string,
): StructuredPatchEntry | null {
  const patches = getStructuredPatches(result);
  if (patches.length === 0) return null;

  if (filePath) {
    const byPath = patches.find((entry) => getPatchPath(entry) === filePath);
    if (byPath) return byPath;
  }

  return patches[0] ?? null;
}

/** Extract file changes from a tool_call message. Returns one entry per file. */
function extractChanges(msg: UIMessage): FileChange[] {
  const { toolName, toolInput } = msg;
  if (!toolName || !toolInput) return [];

  const patches = getStructuredPatches(msg.toolResult);

  switch (toolName) {
    case "Edit": {
      // Multi-file Codex fileChange: one FileChange per patch entry
      if (isMultiFileStructuredPatch(patches)) {
        const results: FileChange[] = [];
        for (const patch of patches) {
          const patchPath = getPatchPath(patch);
          if (!patchPath) continue;
          const parsedDiff = parseUnifiedDiffFromUnknown(patch.diff);
          results.push({
            filePath: patchPath,
            fileName: basename(patchPath),
            changeType: patch.kind === "add" ? "created" : "modified",
            toolName: "Edit",
            unifiedDiff: patch.diff,
            oldString: firstDefinedString(patch.oldString, parsedDiff?.oldString),
            newString: firstDefinedString(patch.newString, parsedDiff?.newString),
            messageId: msg.id,
            timestamp: msg.timestamp,
          });
        }
        return results;
      }

      // Single file: existing logic
      const filePath = String(toolInput.file_path ?? "");
      const structuredPatch = getStructuredPatchEntry(msg.toolResult, filePath);
      const parsedStructuredDiff = parseUnifiedDiffFromUnknown(structuredPatch?.diff);
      const parsedDiff = parseUnifiedDiffFromUnknown(msg.toolResult?.content);
      if (!filePath) return [];
      return [{
        filePath,
        fileName: basename(filePath),
        changeType: "modified",
        toolName,
        unifiedDiff: firstDefinedString(
          structuredPatch?.diff,
          typeof msg.toolResult?.content === "string" ? msg.toolResult.content : undefined,
        ),
        oldString: firstDefinedString(
          structuredPatch?.oldString,
          parsedStructuredDiff?.oldString,
          parsedDiff?.oldString,
          msg.toolResult?.oldString,
          toolInput.old_string,
        ),
        newString: firstDefinedString(
          structuredPatch?.newString,
          parsedStructuredDiff?.newString,
          parsedDiff?.newString,
          msg.toolResult?.newString,
          toolInput.new_string,
        ),
        messageId: msg.id,
        timestamp: msg.timestamp,
      }];
    }
    case "Write": {
      // Multi-file Codex fileChange (all adds)
      if (isMultiFileStructuredPatch(patches)) {
        const results: FileChange[] = [];
        for (const patch of patches) {
          const patchPath = getPatchPath(patch);
          if (!patchPath) continue;
          results.push({
            filePath: patchPath,
            fileName: basename(patchPath),
            changeType: "created",
            toolName: "Write",
            content: patch.newString ?? "",
            messageId: msg.id,
            timestamp: msg.timestamp,
          });
        }
        return results;
      }

      // Single file
      const filePath = String(toolInput.file_path ?? "");
      if (!filePath) return [];
      return [{
        filePath,
        fileName: basename(filePath),
        changeType: "created",
        toolName,
        content: String(toolInput.content ?? ""),
        messageId: msg.id,
        timestamp: msg.timestamp,
      }];
    }
    case "NotebookEdit": {
      const filePath = String(toolInput.notebook_path ?? "");
      if (!filePath) return [];
      return [{
        filePath,
        fileName: basename(filePath),
        changeType: "created",
        toolName,
        content: String(toolInput.new_source ?? ""),
        messageId: msg.id,
        timestamp: msg.timestamp,
      }];
    }
    default:
      return [];
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
        {
          const structuredPatch = getStructuredPatchEntry(step.toolResult, filePath);
          const parsedStructuredDiff = parseUnifiedDiffFromUnknown(structuredPatch?.diff);
          const parsedDiff = parseUnifiedDiffFromUnknown(step.toolResult?.content);
          const unifiedDiff = firstDefinedString(
            structuredPatch?.diff,
            typeof step.toolResult?.content === "string" ? step.toolResult.content : undefined,
          );
          oldString = firstDefinedString(
            structuredPatch?.oldString,
            parsedStructuredDiff?.oldString,
            parsedDiff?.oldString,
            step.toolResult?.oldString,
            input.old_string,
          );
          newString = firstDefinedString(
            structuredPatch?.newString,
            parsedStructuredDiff?.newString,
            parsedDiff?.newString,
            step.toolResult?.newString,
            input.new_string,
          );
          if (!filePath) continue;
          results.push({
            filePath,
            fileName: basename(filePath),
            changeType,
            toolName,
            unifiedDiff,
            oldString,
            newString,
            content,
            messageId: msg.id,
            timestamp: msg.timestamp,
          });
        }
        continue;
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
      changes.push(...extractChanges(msg));
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
