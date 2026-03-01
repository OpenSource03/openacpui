import { BookOpen, LayoutGrid } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { stripHtml } from "./helpers";

// ── Confluence: Search results ──

export function ConfluenceSearchResults({ data }: { data: unknown }) {
  const obj = data as { results?: Array<{ content?: { id?: string; title?: string; type?: string; space?: { key?: string; name?: string } }; title?: string; url?: string; excerpt?: string }>; totalSize?: number };
  const results = obj.results;
  if (!results || results.length === 0) {
    return <p className="text-foreground/40 py-2">No results found</p>;
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        {obj.totalSize ?? results.length} result{(obj.totalSize ?? results.length) !== 1 ? "s" : ""}
      </span>
      {results.map((r, i) => {
        const title = r.content?.title ?? r.title ?? "Untitled";
        const space = r.content?.space?.key;
        return (
          <div
            key={i}
            className="rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <BookOpen className="h-3 w-3 shrink-0 text-foreground/30" />
              <span className="text-[11px] text-foreground/80 truncate">{title}</span>
              {space && (
                <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">
                  {space}
                </Badge>
              )}
            </div>
            {r.excerpt && (
              <p className="text-[10px] text-foreground/40 truncate mt-0.5 ms-[18px]">
                {stripHtml(r.excerpt).slice(0, 120)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Confluence: Spaces ──

export function ConfluenceSpaces({ data }: { data: unknown }) {
  const obj = data as { results?: Array<{ id?: string; key?: string; name?: string; type?: string; status?: string }> };
  const spaces = obj.results;
  if (!spaces || spaces.length === 0) {
    return <p className="text-foreground/40 py-2">No spaces found</p>;
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        {spaces.length} space{spaces.length !== 1 ? "s" : ""}
      </span>
      {spaces.map((s) => (
        <div
          key={s.key ?? s.id}
          className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-foreground/[0.03] transition-colors"
        >
          <LayoutGrid className="h-3 w-3 shrink-0 text-foreground/30" />
          <span className="shrink-0 text-[11px] font-mono text-foreground/50 w-[52px]">
            {s.key}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground/80 text-[11px]">
            {s.name}
          </span>
          {s.type && (
            <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">
              {s.type}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}
