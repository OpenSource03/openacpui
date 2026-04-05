import { parseUnifiedDiffFromUnknown } from "@/lib/diff/unified-diff";
import type { UIMessage } from "@/types";
import { getStructuredPatches } from "@/lib/diff/patch-utils";

export interface DiffStats {
  added: number;
  removed: number;
}

/** Count +/- lines from a unified diff string. */
export function parseUnifiedDiffStats(diffText: string): DiffStats | null {
  if (!diffText) return null;
  const parsed = parseUnifiedDiffFromUnknown(diffText);
  if (!parsed) return null;

  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  let inHunk = false;
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) { inHunk = true; continue; }
    if (!inHunk) continue;
    if (line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      inHunk = false;
      continue;
    }
    if (line === "\\ No newline at end of file") continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }

  if (added === 0 && removed === 0) return null;
  return { added, removed };
}

/** Count +/- from old_string / new_string comparison. */
function countLines(s: string): number {
  if (!s) return 0;
  return s.split("\n").length;
}

/** Extract diff stats from a tool message (Edit/Write). */
export function getToolDiffStats(message: UIMessage): DiffStats | null {
  const result = message.toolResult;
  if (!result) return null;

  // Try structured patches first (Codex / ACP)
  const patches = getStructuredPatches(result);
  if (patches.length > 0) {
    let totalAdded = 0;
    let totalRemoved = 0;
    for (const patch of patches) {
      const stats = patch.diff ? parseUnifiedDiffStats(patch.diff) : null;
      if (stats) {
        totalAdded += stats.added;
        totalRemoved += stats.removed;
      }
    }
    if (totalAdded > 0 || totalRemoved > 0) return { added: totalAdded, removed: totalRemoved };
  }

  // Try detailedContent (ACP unified diff)
  if (typeof result.detailedContent === "string") {
    const stats = parseUnifiedDiffStats(result.detailedContent);
    if (stats) return stats;
  }

  // Try content as unified diff
  if (typeof result.content === "string") {
    const stats = parseUnifiedDiffStats(result.content);
    if (stats) return stats;
  }

  // Fall back to old/new string comparison
  const oldStr = String(result.oldString ?? message.toolInput?.old_string ?? "");
  const newStr = String(result.newString ?? message.toolInput?.new_string ?? "");
  if (oldStr || newStr) {
    const oldLines = countLines(oldStr);
    const newLines = countLines(newStr);
    const added = Math.max(0, newLines - oldLines);
    const removed = Math.max(0, oldLines - newLines);
    if (added > 0 || removed > 0) return { added, removed };
  }

  // Write: entire file is new content
  if (message.toolName === "Write" && message.toolInput?.content) {
    return { added: countLines(String(message.toolInput.content)), removed: 0 };
  }

  return null;
}
