import type { UIMessage } from "@/types";
import { OpenInEditorButton } from "@/components/OpenInEditorButton";
import { GenericContent } from "./GenericContent";

export function ReadContent({ message }: { message: UIMessage }) {
  const result = message.toolResult;
  const filePath = String(message.toolInput?.file_path ?? "");

  if (result?.file) {
    const { startLine, numLines, totalLines } = result.file;
    const endLine = startLine + numLines - 1;
    const isFull = startLine === 1 && numLines >= totalLines;
    return (
      <div className="group/read flex items-center gap-1.5 text-xs text-foreground/50 font-mono text-[11px]">
        {filePath}
        <span className="text-foreground/30">
          {isFull
            ? `${totalLines} lines`
            : `L${startLine}–${endLine} of ${totalLines}`}
        </span>
        <OpenInEditorButton filePath={filePath} line={startLine} className="group-hover/read:text-foreground/25" />
      </div>
    );
  }

  // ACP fallback: result has stdout (file contents) but no structured file metadata
  if (filePath && typeof result?.stdout === "string") {
    const lineCount = result.stdout.split("\n").length;
    return (
      <div className="group/read flex items-center gap-1.5 text-xs text-foreground/50 font-mono text-[11px]">
        {filePath}
        <span className="text-foreground/30">{lineCount} lines</span>
        <OpenInEditorButton filePath={filePath} className="group-hover/read:text-foreground/25" />
      </div>
    );
  }

  return <GenericContent message={message} />;
}
