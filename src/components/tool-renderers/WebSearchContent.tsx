import { ExternalLink, Globe, Search } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "@/types";
import { extractResultText, parseSearchLinks } from "@/components/lib/tool-formatting";

const REMARK_PLUGINS = [remarkGfm];
const MAX_VISIBLE_LINKS = 8;

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function getActionLabel(actionType: string): string {
  switch (actionType) {
    case "search":
      return "search";
    case "openPage":
      return "open page";
    case "findInPage":
      return "find in page";
    default:
      return "web";
  }
}

export function WebSearchContent({ message }: { message: UIMessage }) {
  const input = message.toolInput ?? {};
  const resultText = extractResultText(message.toolResult);
  const query = readString(input.query);
  const actionType = readString(input.actionType);
  const actionQuery = readString(input.actionQuery);
  const queries = readStringArray(input.queries);
  const url = readString(input.url);
  const pattern = readString(input.pattern);
  const links = parseSearchLinks(resultText);

  const summaryMatch = resultText.match(/\n\n([\s\S]+)$/);
  const summary = summaryMatch?.[1]?.trim() ?? "";
  const visibleLinks = links.slice(0, MAX_VISIBLE_LINKS);
  const overflow = links.length - MAX_VISIBLE_LINKS;
  const fallbackSummary = !summary && resultText && !resultText.startsWith("Links:") ? resultText : "";

  return (
    <div className="space-y-2 text-xs">
      {(query || actionType) && (
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-foreground/50">
          <Search className="h-3 w-3 shrink-0 text-foreground/25" />
          {query ? <span className="min-w-0 truncate">&quot;{query}&quot;</span> : <span>Web search</span>}
          {actionType && <span className="text-foreground/25">{getActionLabel(actionType)}</span>}
        </div>
      )}

      {actionQuery && actionQuery !== query && (
        <div className="text-[11px] text-foreground/35">
          Search query: <span className="font-mono text-foreground/55">{actionQuery}</span>
        </div>
      )}

      {queries.length > 0 && (
        <div className="rounded-md overflow-hidden border border-foreground/[0.06]">
          {queries.map((candidate, index) => (
            <div
              key={`${candidate}-${index}`}
              className={`flex items-center gap-2 px-3 py-1.5 ${
                index > 0 ? "border-t border-foreground/[0.06]" : ""
              }`}
            >
              <Search className="h-3 w-3 shrink-0 text-foreground/20" />
              <span className="truncate font-mono text-[11px] text-foreground/55">{candidate}</span>
            </div>
          ))}
        </div>
      )}

      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] font-mono text-foreground/50 transition-colors hover:text-foreground/70"
        >
          <Globe className="h-3 w-3 shrink-0" />
          <span className="truncate">{url}</span>
          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-50" />
        </a>
      )}

      {pattern && (
        <div className="text-[11px] text-foreground/35">
          Pattern: <span className="font-mono text-foreground/55">{pattern}</span>
        </div>
      )}

      {visibleLinks.length > 0 && (
        <div className="rounded-md overflow-hidden border border-foreground/[0.06]">
          {visibleLinks.map((link, i) => {
            let domain = "";
            try {
              domain = new URL(link.url).hostname.replace(/^www\./, "");
            } catch {
              // Ignore malformed URLs in tool output.
            }
            return (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`group/link flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-foreground/[0.04] ${
                  i > 0 ? "border-t border-foreground/[0.06]" : ""
                }`}
              >
                <ExternalLink className="h-3 w-3 shrink-0 text-foreground/20 transition-colors group-hover/link:text-foreground/40" />
                <span className="w-[120px] shrink-0 truncate text-[11px] text-foreground/30">{domain}</span>
                <span className="truncate text-foreground/60 transition-colors group-hover/link:text-foreground/80">{link.title}</span>
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

      {summary && (
        <div className="max-h-64 overflow-auto rounded-md bg-foreground/[0.03] px-3 py-2">
          <div className="prose prose-sm max-w-none text-[12px] text-foreground/60 dark:prose-invert">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{summary.slice(0, 3000)}</ReactMarkdown>
          </div>
        </div>
      )}

      {fallbackSummary && !summary && (
        <div className="rounded-md bg-foreground/[0.03] px-3 py-2 text-[11px] text-foreground/50">
          {fallbackSummary}
        </div>
      )}
    </div>
  );
}
