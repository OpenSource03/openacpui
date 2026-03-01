/**
 * Pure data transformation logic for the FilesPanel.
 * Extracts file access information from UIMessage arrays without any React dependencies.
 */

import { Eye, Pencil, Plus } from "lucide-react";
import type { UIMessage } from "@/types";

export type AccessType = "read" | "modified" | "created";

/** A contiguous range of lines read from a file. */
export interface LineRange {
  start: number;
  end: number; // inclusive
}

export interface FileAccess {
  path: string;
  accessType: AccessType;
  lastAccessed: number;
  /** Line ranges read (only for Read tool). Empty = full file read. */
  ranges: LineRange[];
  /** Total lines in the file, from the most recent Read result. */
  totalLines?: number;
}

export const ACCESS_PRIORITY: Record<AccessType, number> = {
  read: 0,
  modified: 1,
  created: 2,
};

export const ACCESS_ICON: Record<AccessType, typeof Eye> = {
  read: Eye,
  modified: Pencil,
  created: Plus,
};

export const ACCESS_COLOR: Record<AccessType, string> = {
  read: "text-blue-400",
  modified: "text-amber-400",
  created: "text-emerald-400",
};

export const ACCESS_LABEL: Record<AccessType, string> = {
  read: "Read",
  modified: "Modified",
  created: "Created",
};

export function getToolAccess(toolName: string): AccessType | null {
  switch (toolName) {
    case "Read":
      return "read";
    case "Edit":
      return "modified";
    case "Write":
    case "NotebookEdit":
      return "created";
    default:
      return null;
  }
}

export function extractFilePath(toolName: string, toolInput: Record<string, unknown>): string | null {
  switch (toolName) {
    case "Read":
    case "Edit":
    case "Write":
      return (toolInput.file_path as string) ?? null;
    case "NotebookEdit":
      return (toolInput.notebook_path as string) ?? null;
    default:
      return null;
  }
}

/** Extract read range from a Read tool call. Returns null for full-file reads. */
export function extractReadRange(msg: UIMessage): LineRange | null {
  // Prefer the actual result metadata (startLine + numLines) over input params
  const result = msg.toolResult;
  if (result?.file) {
    const { startLine, numLines, totalLines } = result.file;
    // If the read covers the entire file, treat as full read
    if (startLine === 1 && numLines >= totalLines) return null;
    return { start: startLine, end: startLine + numLines - 1 };
  }

  // Fallback to input params if result hasn't arrived yet
  const input = msg.toolInput;
  if (!input) return null;
  const offset = input.offset as number | undefined;
  const limit = input.limit as number | undefined;
  if (!offset && !limit) return null;
  const start = (offset ?? 1);
  // Without limit we don't know the end, but we know it's partial
  if (!limit) return { start, end: start };
  return { start, end: start + limit - 1 };
}

/** Extract read range from a subagent step's toolInput (no result metadata available for ranges). */
export function extractSubagentReadRange(toolInput: Record<string, unknown>): LineRange | null {
  const offset = toolInput.offset as number | undefined;
  const limit = toolInput.limit as number | undefined;
  if (!offset && !limit) return null;
  const start = (offset ?? 1);
  if (!limit) return { start, end: start };
  return { start, end: start + limit - 1 };
}

/** Merge a new range into an existing sorted, non-overlapping range list. */
export function mergeRange(ranges: LineRange[], newRange: LineRange): LineRange[] {
  const merged: LineRange[] = [];
  let inserted = false;

  for (const r of ranges) {
    if (inserted || r.end < newRange.start - 1) {
      merged.push(r);
    } else if (r.start > newRange.end + 1) {
      if (!inserted) {
        merged.push(newRange);
        inserted = true;
      }
      merged.push(r);
    } else {
      // Overlapping or adjacent — expand newRange
      newRange = {
        start: Math.min(r.start, newRange.start),
        end: Math.max(r.end, newRange.end),
      };
    }
  }
  if (!inserted) merged.push(newRange);
  return merged;
}

/** Format line ranges for display. E.g. "1-50, 100-150" or "full file". */
export function formatRanges(file: FileAccess): string | null {
  if (file.accessType !== "read") return null;
  if (file.ranges.length === 0) return null; // full file

  // Check if ranges cover the entire file
  if (file.totalLines && file.ranges.length === 1) {
    const r = file.ranges[0];
    if (r.start <= 1 && r.end >= file.totalLines) return null;
  }

  const parts = file.ranges.map((r) =>
    r.start === r.end ? `L${r.start}` : `L${r.start}–${r.end}`,
  );
  return parts.join(", ");
}

export function extractFiles(messages: UIMessage[], cwd?: string, includeClaudeMd = false): FileAccess[] {
  const fileMap = new Map<string, FileAccess>();

  const recordAccess = (
    path: string,
    accessType: AccessType,
    timestamp: number,
    range: LineRange | null,
    totalLines?: number,
  ) => {
    const existing = fileMap.get(path);
    if (existing) {
      if (ACCESS_PRIORITY[accessType] > ACCESS_PRIORITY[existing.accessType]) {
        existing.accessType = accessType;
      }
      if (timestamp > existing.lastAccessed) {
        existing.lastAccessed = timestamp;
      }
      if (totalLines !== undefined) {
        existing.totalLines = totalLines;
      }
      // Merge read ranges
      if (accessType === "read") {
        if (range === null) {
          // Full file read — clear all partial ranges
          existing.ranges = [];
        } else if (existing.ranges.length > 0) {
          // Merge into existing partial ranges
          existing.ranges = mergeRange(existing.ranges, range);
        }
        // If ranges is already empty (full read), stay empty
      }
    } else {
      fileMap.set(path, {
        path,
        accessType,
        lastAccessed: timestamp,
        ranges: range ? [range] : [],
        totalLines,
      });
    }
  };

  for (const msg of messages) {
    if (msg.role !== "tool_call") continue;

    // Direct tool calls — skip failed ones
    if (msg.toolName && msg.toolInput && !msg.toolError) {
      const access = getToolAccess(msg.toolName);
      const filePath = access ? extractFilePath(msg.toolName, msg.toolInput) : null;
      if (access && filePath) {
        const range = msg.toolName === "Read" ? extractReadRange(msg) : null;
        const totalLines = msg.toolResult?.file?.totalLines;
        recordAccess(filePath, access, msg.timestamp, range, totalLines);
      }
    }

    // Subagent steps — skip failed ones
    if (msg.subagentSteps) {
      for (const step of msg.subagentSteps) {
        if (step.toolError) continue;
        const access = getToolAccess(step.toolName);
        const filePath = access ? extractFilePath(step.toolName, step.toolInput) : null;
        if (access && filePath) {
          const range = step.toolName === "Read" ? extractSubagentReadRange(step.toolInput) : null;
          const totalLines = step.toolResult?.file?.totalLines;
          recordAccess(filePath, access, msg.timestamp, range, totalLines);
        }
      }
    }
  }

  // CLAUDE.md is loaded by Claude CLI even when no explicit tool call exists.
  if (includeClaudeMd && cwd) {
    const claudeMdPath = `${cwd}/CLAUDE.md`;
    if (!fileMap.has(claudeMdPath)) {
      fileMap.set(claudeMdPath, {
        path: claudeMdPath,
        accessType: "read",
        lastAccessed: 0,
        ranges: [],
      });
    }
  }

  // Sort by most recently accessed (pinned CLAUDE.md with timestamp 0 sinks to bottom)
  return Array.from(fileMap.values()).sort((a, b) => b.lastAccessed - a.lastAccessed);
}

export function getRelativePath(fullPath: string, cwd?: string): { fileName: string; dirPath: string } {
  const relative = cwd && fullPath.startsWith(cwd)
    ? fullPath.slice(cwd.length + 1)
    : fullPath;

  const lastSlash = relative.lastIndexOf("/");
  if (lastSlash === -1) {
    return { fileName: relative, dirPath: "" };
  }
  return {
    fileName: relative.slice(lastSlash + 1),
    dirPath: relative.slice(0, lastSlash),
  };
}
