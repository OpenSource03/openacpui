import { Globe, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "@/types";
import { extractResultText } from "@/components/lib/tool-formatting";

const REMARK_PLUGINS = [remarkGfm];

export function WebFetchContent({ message }: { message: UIMessage }) {
  const content = extractResultText(message.toolResult);
  const url = String(message.toolInput?.url ?? "");
  let domain = "";
  try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
  const truncated = content.length > 3000;
  const displayContent = truncated ? content.slice(0, 3000) : content;

  return (
    <div className="space-y-2 text-xs">
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] text-foreground/50 hover:text-foreground/70 transition-colors font-mono"
        >
          <Globe className="h-3 w-3 shrink-0" />
          {domain || url}
          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-50" />
        </a>
      )}
      {displayContent && (
        <div className="max-h-64 overflow-auto rounded-md bg-foreground/[0.03] px-3 py-2">
          <div className="prose dark:prose-invert prose-sm max-w-none text-foreground/60 text-[12px]">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{displayContent}</ReactMarkdown>
          </div>
        </div>
      )}
      {truncated && (
        <p className="text-[10px] text-foreground/30 italic">Content truncated</p>
      )}
    </div>
  );
}
