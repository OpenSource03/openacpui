import { ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "@/types";
import { extractResultText, parseSearchLinks } from "@/components/lib/tool-formatting";

const REMARK_PLUGINS = [remarkGfm];
const MAX_VISIBLE_LINKS = 8;

export function WebSearchContent({ message }: { message: UIMessage }) {
  const resultText = extractResultText(message.toolResult);
  const query = String(message.toolInput?.query ?? "");
  const links = parseSearchLinks(resultText);

  // Extract the markdown summary after the Links block
  const summaryMatch = resultText.match(/\n\n([\s\S]+)$/);
  const summary = summaryMatch?.[1]?.trim() ?? "";
  const visibleLinks = links.slice(0, MAX_VISIBLE_LINKS);
  const overflow = links.length - MAX_VISIBLE_LINKS;

  return (
    <div className="space-y-2 text-xs">
      {query && (
        <div className="font-mono text-[11px] text-foreground/50">
          &quot;{query}&quot;
        </div>
      )}

      {visibleLinks.length > 0 && (
        <div className="rounded-md border border-foreground/[0.06] overflow-hidden">
          {visibleLinks.map((link, i) => {
            let domain = "";
            try { domain = new URL(link.url).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
            return (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2 px-3 py-1.5 hover:bg-foreground/[0.04] transition-colors group/link ${
                  i > 0 ? "border-t border-foreground/[0.06]" : ""
                }`}
              >
                <ExternalLink className="h-3 w-3 shrink-0 text-foreground/20 group-hover/link:text-foreground/40 transition-colors" />
                <span className="shrink-0 text-[11px] text-foreground/30 w-[120px] truncate">{domain}</span>
                <span className="truncate text-foreground/60 group-hover/link:text-foreground/80 transition-colors">{link.title}</span>
              </a>
            );
          })}
          {overflow > 0 && (
            <div className="border-t border-foreground/[0.06] px-3 py-1 text-[11px] text-foreground/30">
              +{overflow} more result{overflow !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {/* Markdown summary from the search */}
      {summary && (
        <div className="max-h-64 overflow-auto rounded-md bg-foreground/[0.03] px-3 py-2">
          <div className="prose dark:prose-invert prose-sm max-w-none text-foreground/60 text-[12px]">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{summary.slice(0, 3000)}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
