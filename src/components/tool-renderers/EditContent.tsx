import type { UIMessage } from "@/types";
import { parseUnifiedDiffFromUnknown } from "@/lib/unified-diff";
import { DiffViewer } from "@/components/DiffViewer";
import { UnifiedPatchViewer } from "@/components/UnifiedPatchViewer";
import { firstDefinedString } from "@/components/lib/tool-formatting";
import { GenericContent } from "./GenericContent";

export function EditContent({ message }: { message: UIMessage }) {
  const structuredPatch = Array.isArray(message.toolResult?.structuredPatch)
    ? (message.toolResult.structuredPatch as Array<Record<string, unknown>>)
    : [];
  const matchingPatch =
    structuredPatch.find((entry) => {
      const entryPath = entry.filePath ?? entry.path;
      return typeof entryPath === "string"
        && entryPath
        && entryPath === String(message.toolInput?.file_path ?? message.toolResult?.filePath ?? "");
    }) ?? structuredPatch[0];
  const resultContent = typeof message.toolResult?.content === "string"
    ? message.toolResult.content
    : "";
  const detailedContent = typeof message.toolResult?.detailedContent === "string"
    ? message.toolResult.detailedContent
    : "";
  const patchDiffText = typeof matchingPatch?.diff === "string" ? matchingPatch.diff : "";
  const candidateDiffText = selectUnifiedDiffText(patchDiffText, detailedContent, resultContent);
  const filePath = String(
    message.toolInput?.file_path
      ?? message.toolResult?.filePath
      ?? (typeof matchingPatch?.filePath === "string" ? matchingPatch.filePath : "")
      ?? extractFilePathFromDiff(candidateDiffText)
      ?? "",
  );
  const parsedStructuredDiff = parseUnifiedDiffFromUnknown(matchingPatch?.diff);
  const parsedDiff = parseUnifiedDiffFromUnknown(message.toolResult?.content);
  // ACP agents put the unified diff in detailedContent — parse it for oldString/newString
  const parsedDetailedDiff = parseUnifiedDiffFromUnknown(message.toolResult?.detailedContent);
  const unifiedDiffText = candidateDiffText;
  // Prefer parsed/structured patch text first; toolInput can be a lossy representation.
  const oldStr = firstDefinedString(
    typeof matchingPatch?.oldString === "string" ? matchingPatch.oldString : undefined,
    parsedStructuredDiff?.oldString,
    parsedDiff?.oldString,
    parsedDetailedDiff?.oldString,
    message.toolResult?.oldString,
    message.toolInput?.old_string,
  );
  const newStr = firstDefinedString(
    typeof matchingPatch?.newString === "string" ? matchingPatch.newString : undefined,
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
      unifiedDiff={unifiedDiffText || undefined}
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
