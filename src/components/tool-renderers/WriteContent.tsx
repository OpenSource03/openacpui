import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { UIMessage } from "@/types";
import { getLanguageFromPath } from "@/lib/languages";
import { useResolvedThemeClass } from "@/hooks/useResolvedThemeClass";
import { parseUnifiedDiff } from "@/lib/unified-diff";
import { UnifiedPatchViewer } from "@/components/UnifiedPatchViewer";
import { OpenInEditorButton } from "@/components/OpenInEditorButton";
import { GenericContent } from "./GenericContent";

// ── Stable style constants (avoid re-creating on every render) ──

const WRITE_SYNTAX_STYLE: React.CSSProperties = {
  margin: 0,
  borderRadius: 0, // container's .island handles border-radius + glass border
  fontSize: "11px",
  padding: "10px 12px",
  background: "transparent", // transparent so .island gradient border shows through
  textShadow: "none",
};

const WRITE_LINE_NUMBER_STYLE: React.CSSProperties = {
  color: "var(--line-number-color)",
  fontSize: "10px",
  minWidth: "2em",
  paddingRight: "1em",
};

export function WriteContent({ message }: { message: UIMessage }) {
  const resolvedTheme = useResolvedThemeClass();
  const syntaxStyle = resolvedTheme === "dark" ? oneDark : oneLight;
  const filePath = String(
    message.toolInput?.file_path
      ?? message.toolResult?.filePath
      ?? "",
  );
  // Codex "wrote" may have a structuredPatch with a unified diff
  const structuredPatch = Array.isArray(message.toolResult?.structuredPatch)
    ? (message.toolResult.structuredPatch as Array<Record<string, unknown>>)
    : [];
  const patchDiff = structuredPatch.length > 0
    && typeof structuredPatch[0].diff === "string"
    ? structuredPatch[0].diff
    : null;
  // Use UnifiedPatchViewer when the patch is a proper unified diff
  const hasUnifiedDiff = patchDiff ? parseUnifiedDiff(patchDiff) !== null : false;

  if (hasUnifiedDiff && patchDiff) {
    return <UnifiedPatchViewer diffText={patchDiff} filePath={filePath} />;
  }

  // Fall back to syntax-highlighted content — check toolInput first, then toolResult
  const content = String(
    message.toolInput?.content
      ?? (typeof message.toolResult?.content === "string" ? message.toolResult.content : "")
      ?? "",
  );
  const language = getLanguageFromPath(filePath);

  if (!content) return <GenericContent message={message} />;

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden font-mono text-[12px] leading-[1.55] bg-muted/55 dark:bg-foreground/[0.06]">
      {/* Header — mirrors DiffViewer's file-path bar */}
      <div className="group/write flex items-center gap-3 px-3 py-1.5 bg-muted/70 dark:bg-foreground/[0.04] border-b border-border/40">
        <span className="text-foreground/80 truncate flex-1">{filePath.split("/").pop()}</span>
        <OpenInEditorButton filePath={filePath} className="group-hover/write:text-foreground/25" />
      </div>
      <div className="overflow-y-auto max-h-[32rem]">
        <SyntaxHighlighter
          language={language}
          style={syntaxStyle}
          customStyle={WRITE_SYNTAX_STYLE}
          showLineNumbers
          lineNumberStyle={WRITE_LINE_NUMBER_STYLE}
          wrapLongLines
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
