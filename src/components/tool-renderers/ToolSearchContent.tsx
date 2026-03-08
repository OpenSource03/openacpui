import { PackageSearch, Check, Search } from "lucide-react";
import type { UIMessage } from "@/types";

/** Result shape returned by the ToolSearch tool. */
interface ToolSearchResult {
  matches: string[];
  query: string;
  total_deferred_tools: number;
}

function hasToolSearchResult(
  result: UIMessage["toolResult"],
): result is NonNullable<UIMessage["toolResult"]> & ToolSearchResult {
  return !!result && Array.isArray((result as ToolSearchResult).matches);
}

/** Parse query mode from the query string. */
function parseQueryMode(query: string): { mode: "select" | "search"; value: string } {
  if (query.startsWith("select:")) {
    return { mode: "select", value: query.slice(7) };
  }
  if (query.startsWith("+")) {
    return { mode: "search", value: query.slice(1) };
  }
  return { mode: "search", value: query };
}

export function ToolSearchContent({ message }: { message: UIMessage }) {
  const query = String(message.toolInput?.query ?? "");
  const result = message.toolResult;

  if (!hasToolSearchResult(result)) {
    // Still running or unexpected shape — show query
    if (query) {
      return (
        <div className="text-xs font-mono text-foreground/50 text-[11px]">
          {query}
        </div>
      );
    }
    return null;
  }

  const { matches, total_deferred_tools } = result;
  const { mode, value } = parseQueryMode(query);

  return (
    <div className="space-y-1.5 text-xs">
      {/* Query line */}
      <div className="flex items-center gap-1.5 font-mono text-[11px] text-foreground/50">
        {mode === "select" ? (
          <PackageSearch className="h-3 w-3 shrink-0 text-foreground/25" />
        ) : (
          <Search className="h-3 w-3 shrink-0 text-foreground/25" />
        )}
        <span>{value}</span>
        <span className="text-foreground/25">
          {mode === "select" ? "direct" : "search"}
        </span>
      </div>

      {/* Matches */}
      {matches.length > 0 ? (
        <div className="rounded-md border border-foreground/[0.06] overflow-hidden">
          {matches.map((tool, i) => (
            <div
              key={tool}
              className={`flex items-center gap-2 px-3 py-1 text-[11px] ${
                i > 0 ? "border-t border-foreground/[0.06]" : ""
              }`}
            >
              <Check className="h-3 w-3 shrink-0 text-emerald-500/50" />
              <span className="truncate font-mono text-foreground/60">
                {tool}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-foreground/30 italic">
          No matching tools
        </span>
      )}

      {/* Pool badge */}
      <span className="text-[10px] text-foreground/25">
        {matches.length} loaded · {total_deferred_tools} available
      </span>
    </div>
  );
}
