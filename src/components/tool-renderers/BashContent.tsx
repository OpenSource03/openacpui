import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { UIMessage } from "@/types";
import { INLINE_HIGHLIGHT_STYLE, INLINE_CODE_TAG_STYLE } from "@/lib/languages";
import { useResolvedThemeClass } from "@/hooks/useResolvedThemeClass";
import { formatBashResult } from "@/components/lib/tool-formatting";

export function BashContent({ message }: { message: UIMessage }) {
  const command = message.toolInput?.command;
  const result = message.toolResult;
  const resolvedTheme = useResolvedThemeClass();
  const syntaxStyle = resolvedTheme === "dark" ? oneDark : oneLight;

  return (
    <div className="space-y-1.5 text-xs">
      {!!command && (
        <div className="rounded-md bg-foreground/[0.04] px-3 py-2 font-mono text-[11px] whitespace-pre-wrap wrap-break-word">
          <span className="text-foreground/40 select-none">$ </span>
          <SyntaxHighlighter
            language="bash"
            style={syntaxStyle}
            customStyle={INLINE_HIGHLIGHT_STYLE}
            codeTagProps={{ style: INLINE_CODE_TAG_STYLE }}
            PreTag="span"
            CodeTag="span"
          >
            {String(command)}
          </SyntaxHighlighter>
        </div>
      )}
      {result && (
        <div className="max-h-48 overflow-auto rounded-md bg-foreground/[0.03] px-3 py-2 font-mono text-[11px] text-foreground/50 whitespace-pre-wrap wrap-break-word">
          {formatBashResult(result)}
        </div>
      )}
    </div>
  );
}
