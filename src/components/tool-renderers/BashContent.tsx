import { useMemo } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { UIMessage } from "@/types";
import { INLINE_HIGHLIGHT_STYLE, INLINE_CODE_TAG_STYLE } from "@/lib/languages";
import { useResolvedTheme } from "@/hooks/useTheme";
import { formatBashResult } from "@/components/lib/tool-formatting";
import { useChatPersistedState } from "@/components/chat-ui-state";
import { renderAnsi } from "@/lib/ansi";

const MAX_OUTPUT_LINES = 200;

export function BashContent({ message }: { message: UIMessage }) {
  const command = message.toolInput?.command;
  const result = message.toolResult;
  const resolvedTheme = useResolvedTheme();
  const syntaxStyle = resolvedTheme === "dark" ? oneDark : oneLight;
  const [expanded, setExpanded] = useChatPersistedState(`bash:${message.id}`, false);

  const formattedResult = useMemo(() => (result ? formatBashResult(result) : ""), [result]);
  const hasOutput = !!formattedResult && formattedResult !== "(no output)";

  const { displayText, totalLines, isTruncated } = useMemo(() => {
    if (!formattedResult) return { displayText: "", totalLines: 0, isTruncated: false };
    const lines = formattedResult.split("\n");
    const total = lines.length;
    if (expanded || total <= MAX_OUTPUT_LINES) {
      return { displayText: formattedResult, totalLines: total, isTruncated: false };
    }
    return {
      displayText: lines.slice(0, MAX_OUTPUT_LINES).join("\n"),
      totalLines: total,
      isTruncated: true,
    };
  }, [formattedResult, expanded]);

  return (
    <div className="text-xs">
      <div className="rounded-md bg-foreground/[0.04] font-mono text-[11px] whitespace-pre-wrap wrap-break-word">
        {/* Command */}
        {!!command && (
          <div className="px-3 py-2">
            <span className="text-foreground/30 select-none">$ </span>
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

        {/* Output */}
        {hasOutput && (
          <>
            <div className="mx-3 h-px bg-foreground/[0.06]" />
            <div className="max-h-48 overflow-auto px-3 py-2 text-foreground/45">
              {renderAnsi(displayText)}
            </div>
          </>
        )}
      </div>

      {isTruncated && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex items-center gap-1 text-[10px] font-medium text-foreground/35 hover:text-foreground/60 transition-colors"
        >
          <ChevronsUpDown className="h-3 w-3" />
          Show full output ({totalLines} lines)
        </button>
      )}
      {expanded && totalLines > MAX_OUTPUT_LINES && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-1 flex items-center gap-1 text-[10px] font-medium text-foreground/35 hover:text-foreground/60 transition-colors"
        >
          <ChevronsUpDown className="h-3 w-3" />
          Collapse
        </button>
      )}
    </div>
  );
}
