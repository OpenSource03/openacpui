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
  const filePath = String(
    message.toolInput?.file_path
      ?? message.toolResult?.filePath
      ?? (typeof matchingPatch?.filePath === "string" ? matchingPatch.filePath : "")
      ?? "",
  );
  const parsedStructuredDiff = parseUnifiedDiffFromUnknown(matchingPatch?.diff);
  const parsedDiff = parseUnifiedDiffFromUnknown(message.toolResult?.content);
  const unifiedDiffText = firstDefinedString(
    typeof matchingPatch?.diff === "string" ? matchingPatch.diff : undefined,
    typeof message.toolResult?.content === "string" ? message.toolResult.content : undefined,
  );
  // Prefer parsed/structured patch text first; toolInput can be a lossy representation.
  const oldStr = firstDefinedString(
    typeof matchingPatch?.oldString === "string" ? matchingPatch.oldString : undefined,
    parsedStructuredDiff?.oldString,
    parsedDiff?.oldString,
    message.toolResult?.oldString,
    message.toolInput?.old_string,
  );
  const newStr = firstDefinedString(
    typeof matchingPatch?.newString === "string" ? matchingPatch.newString : undefined,
    parsedStructuredDiff?.newString,
    parsedDiff?.newString,
    message.toolResult?.newString,
    message.toolInput?.new_string,
  );

  if (!oldStr && !newStr) {
    // Fallback 1: raw diff in structuredPatch (e.g. Codex fileChange with raw content)
    const rawDiff = typeof matchingPatch?.diff === "string" ? matchingPatch.diff : "";
    if (rawDiff) {
      return <UnifiedPatchViewer diffText={rawDiff} filePath={filePath} />;
    }
    // Fallback 2: result has content but no structuredPatch (e.g. Codex "update" kind)
    const resultContent = typeof message.toolResult?.content === "string"
      ? message.toolResult.content
      : "";
    if (resultContent) {
      return <UnifiedPatchViewer diffText={resultContent} filePath={filePath} />;
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
