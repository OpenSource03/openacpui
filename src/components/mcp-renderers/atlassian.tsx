import { BookOpen, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { JiraIssueDetail, unwrapJiraIssues } from "./jira";
import { stripHtml } from "./helpers";

// ── Rovo Search results ──

export function RovoSearchResults({ data }: { data: unknown }) {
  const obj = data as { results?: Array<{ id?: string; title?: string; description?: string; url?: string; type?: string; container?: { title?: string } }> };
  const results = obj.results;
  if (!results || !Array.isArray(results) || results.length === 0) {
    return <p className="text-foreground/40 py-2">No results found</p>;
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        {results.length} result{results.length !== 1 ? "s" : ""}
      </span>
      {results.map((r, i) => (
        <div
          key={r.id ?? i}
          className="rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors"
        >
          <div className="flex items-center gap-1.5">
            {r.type?.includes("issue") ? (
              <CheckCircle2 className="h-3 w-3 shrink-0 text-blue-400/60" />
            ) : (
              <BookOpen className="h-3 w-3 shrink-0 text-foreground/30" />
            )}
            <span className="text-[11px] text-foreground/80 truncate">{r.title ?? "Untitled"}</span>
            {r.container?.title && (
              <span className="text-[10px] text-foreground/30 shrink-0 truncate max-w-[100px]">
                {r.container.title}
              </span>
            )}
          </div>
          {r.description && (
            <p className="text-[10px] text-foreground/40 truncate mt-0.5 ms-[18px]">
              {r.description.slice(0, 120)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Rovo Fetch (single resource detail) ──

export function RovoFetchResult({ data }: { data: unknown }) {
  const obj = data as Record<string, unknown>;

  // Could be a Jira issue (flat or wrapped in issues.nodes)
  const jiraIssues = unwrapJiraIssues(data);
  if (jiraIssues.length > 0 && (jiraIssues[0].key || jiraIssues[0].fields)) {
    return <JiraIssueDetail data={data} />;
  }

  // Could be a Confluence page
  if (obj.title && (obj.body || obj.space)) {
    const page = obj as { title?: string; space?: { key?: string; name?: string }; body?: { storage?: { value?: string } } };
    return (
      <div className="rounded-md border border-foreground/[0.06] px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <BookOpen className="h-3 w-3 shrink-0 text-foreground/30" />
          <span className="text-[11px] text-foreground/80">{page.title}</span>
          {page.space?.key && (
            <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">
              {page.space.key}
            </Badge>
          )}
        </div>
        {page.body?.storage?.value && (
          <p className="text-[10px] text-foreground/40 whitespace-pre-wrap line-clamp-4">
            {stripHtml(page.body.storage.value).slice(0, 500)}
          </p>
        )}
      </div>
    );
  }

  // Fallback: don't handle, let GenericContent take over
  return null;
}

// ── Atlassian: Accessible Resources ──

interface AtlassianResource {
  id?: string;
  url?: string;
  name?: string;
  scopes?: string[];
  avatarUrl?: string;
}

export function AtlassianResourcesList({ data }: { data: unknown }) {
  const resources = Array.isArray(data) ? (data as AtlassianResource[]) : [];
  if (resources.length === 0) {
    return <p className="text-foreground/40 py-2">No accessible resources</p>;
  }

  // Deduplicate by id (same site can appear twice with different scopes)
  const byId = new Map<string, { resource: AtlassianResource; allScopes: string[] }>();
  for (const r of resources) {
    const key = r.id ?? r.url ?? r.name ?? "";
    const existing = byId.get(key);
    if (existing) {
      existing.allScopes.push(...(r.scopes ?? []));
    } else {
      byId.set(key, { resource: r, allScopes: [...(r.scopes ?? [])] });
    }
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        {byId.size} site{byId.size !== 1 ? "s" : ""}
      </span>
      {[...byId.values()].map(({ resource, allScopes }) => (
        <div
          key={resource.id ?? resource.name}
          className="rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors"
        >
          <div className="flex items-center gap-2">
            {resource.avatarUrl && (
              <img src={resource.avatarUrl} alt="" className="h-4 w-4 rounded" />
            )}
            <span className="text-[11px] font-medium text-foreground/80">{resource.name}</span>
            {resource.url && (
              <span className="text-[10px] text-foreground/30 truncate">{resource.url}</span>
            )}
          </div>
          {allScopes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 ms-6">
              {[...new Set(allScopes)].map((scope) => (
                <Badge key={scope} variant="outline" className="h-3.5 px-1 text-[8px] text-foreground/40 border-foreground/10">
                  {scope}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
