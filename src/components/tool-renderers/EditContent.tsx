import { memo } from "react";
import type { UIMessage } from "@/types";
import { parseUnifiedDiffFromUnknown } from "@/lib/unified-diff";
import { DiffViewer } from "@/components/DiffViewer";
import { UnifiedPatchViewer } from "@/components/UnifiedPatchViewer";
import { firstDefinedString } from "@/components/lib/tool-formatting";
import {
  getStructuredPatches,
  getPatchPath,
  filterValidPatches,
  isMultiFileStructuredPatch,
  type StructuredPatchEntry,
} from "@/lib/patch-utils";
import { GenericContent } from "./GenericContent";

// ── Multi-file rendering (Codex fileChange with N > 1 changes) ──

/** Render a single patch entry from a structuredPatch array. */
const PatchEntryDiff = memo(function PatchEntryDiff({ patch }: { patch: StructuredPatchEntry }) {
  const filePath = getPatchPath(patch);
  const diffText = patch.diff ?? "";
  const parsedDiff = diffText ? parseUnifiedDiffFromUnknown(diffText) : null;
  const oldStr = firstDefinedString(patch.oldString, parsedDiff?.oldString);
  const newStr = firstDefinedString(patch.newString, parsedDiff?.newString);

  if (oldStr || newStr) {
    return (
      <DiffViewer
        oldString={oldStr}
        newString={newStr}
        filePath={filePath}
      />
    );
  }

  if (diffText) {
    return <UnifiedPatchViewer diffText={diffText} filePath={filePath} />;
  }

  return null;
});

// ── Main component ──

export function EditContent({ message }: { message: UIMessage }) {
  const structuredPatch = getStructuredPatches(message.toolResult);

  // Multi-file Codex fileChange: render each file's diff separately
  if (isMultiFileStructuredPatch(structuredPatch)) {
    const validPatches = filterValidPatches(structuredPatch);
    if (validPatches.length === 0) return <GenericContent message={message} />;
    return (
      <div className="space-y-2">
        {validPatches.map((patch, i) => (
          <PatchEntryDiff
            key={`${getPatchPath(patch)}-${i}`}
            patch={patch}
          />
        ))}
      </div>
    );
  }

  // Single-file: existing logic with full fallback chain
  // (Claude engine, ACP engine, single-file Codex edits)
  const matchingPatch =
    structuredPatch.find((entry) => {
      const entryPath = getPatchPath(entry);
      return entryPath
        && entryPath === String(message.toolInput?.file_path ?? message.toolResult?.filePath ?? "");
    }) ?? structuredPatch[0];
  const resultContent = typeof message.toolResult?.content === "string"
    ? message.toolResult.content
    : "";
  const detailedContent = typeof message.toolResult?.detailedContent === "string"
    ? message.toolResult.detailedContent
    : "";
  const patchDiffText = matchingPatch?.diff ?? "";
  const candidateDiffText = selectUnifiedDiffText(patchDiffText, detailedContent, resultContent);
  const filePath = String(
    message.toolInput?.file_path
      ?? message.toolResult?.filePath
      ?? matchingPatch?.filePath
      ?? extractFilePathFromDiff(candidateDiffText)
      ?? "",
  );
  const parsedStructuredDiff = parseUnifiedDiffFromUnknown(matchingPatch?.diff);
  const parsedDiff = parseUnifiedDiffFromUnknown(message.toolResult?.content);
  // ACP agents put the unified diff in detailedContent — parse it for oldString/newString
  const parsedDetailedDiff = parseUnifiedDiffFromUnknown(message.toolResult?.detailedContent);
  // Prefer parsed/structured patch text first; toolInput can be a lossy representation.
  const oldStr = firstDefinedString(
    matchingPatch?.oldString,
    parsedStructuredDiff?.oldString,
    parsedDiff?.oldString,
    parsedDetailedDiff?.oldString,
    message.toolResult?.oldString,
    message.toolInput?.old_string,
  );
  const newStr = firstDefinedString(
    matchingPatch?.newString,
    parsedStructuredDiff?.newString,
    parsedDiff?.newString,
    parsedDetailedDiff?.newString,
    message.toolResult?.newString,
    message.toolInput?.new_string,
  );

  if (!oldStr && !newStr) {
    // Fallback 1: raw diff in structuredPatch (e.g. Codex fileChange with raw content)
    const rawDiff = patchDiffText;
    if (rawDiff) {
      return <UnifiedPatchViewer diffText={rawDiff} filePath={filePath} />;
    }
    // Fallback 2: result has content or detailedContent with a diff
    const diffText = selectUnifiedDiffText("", detailedContent, resultContent);
    if (diffText) {
      return <UnifiedPatchViewer diffText={diffText} filePath={filePath} />;
    }
    return <GenericContent message={message} />;
  }

  return (
    <DiffViewer
      oldString={oldStr}
      newString={newStr}
      filePath={filePath}
    />
  );
}

function selectUnifiedDiffText(patchDiff: string, detailedContent: string, resultContent: string): string {
  if (hasUnifiedDiffMarkers(patchDiff)) return patchDiff;
  if (hasUnifiedDiffMarkers(detailedContent)) return detailedContent;
  if (hasUnifiedDiffMarkers(resultContent)) return resultContent;
  return "";
}

function hasUnifiedDiffMarkers(text: string): boolean {
  return text.includes("diff --git") || text.includes("@@");
}

function extractFilePathFromDiff(diffText: string): string {
  const match = diffText.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  return match?.[2] ?? "";
}
