/**
 * Shared utilities for working with structuredPatch entries.
 *
 * Codex bundles multiple file changes into a single tool_call message.
 * The per-file changes are stored in `toolResult.structuredPatch`.
 * These helpers provide typed access and deduplication across the
 * rendering pipeline (renderers, summaries, file tracking, formatting).
 */

import type { UIMessage } from "@/types";

// ── Types ──

/** A single entry from toolResult.structuredPatch. */
export interface StructuredPatchEntry {
  filePath?: string;
  path?: string; // Legacy / ACP fallback for filePath
  kind?: string; // "add" | "delete" | "update"
  diff?: string;
  oldString?: string;
  newString?: string;
  oldStart?: number;
  oldLines?: number;
  newStart?: number;
  newLines?: number;
  lines?: string[];
}

// ── Extraction ──

/** Extract the structuredPatch array from a tool result, safely typed. */
export function getStructuredPatches(
  toolResult: UIMessage["toolResult"],
): StructuredPatchEntry[] {
  return Array.isArray(toolResult?.structuredPatch)
    ? (toolResult.structuredPatch as StructuredPatchEntry[])
    : [];
}

/** Get the file path from a patch entry (filePath preferred, path as fallback). */
export function getPatchPath(patch: StructuredPatchEntry): string {
  return patch.filePath || patch.path || "";
}

/** Filter patches to only those with a non-empty file path. */
export function filterValidPatches(
  patches: StructuredPatchEntry[],
): StructuredPatchEntry[] {
  return patches.filter((p) => getPatchPath(p) !== "");
}

/** Return the distinct non-empty file paths represented in a structuredPatch array. */
export function getDistinctPatchPaths(
  patches: StructuredPatchEntry[],
): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const patch of patches) {
    const patchPath = getPatchPath(patch);
    if (!patchPath || seen.has(patchPath)) continue;
    seen.add(patchPath);
    paths.push(patchPath);
  }

  return paths;
}

/** True only when structuredPatch entries clearly represent multiple files. */
export function isMultiFileStructuredPatch(
  patches: StructuredPatchEntry[],
): boolean {
  return getDistinctPatchPaths(patches).length > 1;
}
