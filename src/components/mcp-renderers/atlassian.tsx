import { BookOpen, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isRecord } from "@/lib/utils";
import { JiraIssueDetail, unwrapJiraIssues } from "./jira";
import { stripHtml } from "./helpers";
import { McpListHeader, McpEmptyState, MCP_ROW_CLASS } from "./shared";

// ── Rovo Search results ──

interface RovoSearchResult {
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  type?: string;
  container?: { title?: string };
}

interface RovoSearchData {
  results?: RovoSearchResult[];
}

function RovoSearchResultsView({ data }: { data: RovoSearchData }) {
  const results = data.results;
  if (!results || !Array.isArray(results) || results.length === 0) {
    return <McpEmptyState message="No results found" />;
  }

  return (
    <div className="space-y-0.5">
      <McpListHeader count={results.length} noun="result" />
      {results.map((r, i) => (
        <div
          key={r.id ?? i}
          className={MCP_ROW_CLASS}
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

export function RovoSearchResults({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  return <RovoSearchResultsView data={data as RovoSearchData} />;
}

// ── Rovo Fetch (single resource detail) ──

interface RovoFetchData {
  // Jira issue shape
  key?: string;
  fields?: Record<string, unknown>;
  issues?: unknown;
  // Confluence page shape
  title?: string;
  space?: { key?: string; name?: string };
  body?: { storage?: { value?: string } };
}

function RovoFetchResultView({ data }: { data: RovoFetchData }) {
  // Could be a Jira issue (flat or wrapped in issues.nodes)
  const jiraIssues = unwrapJiraIssues(data);
  if (jiraIssues.length > 0 && (jiraIssues[0].key || jiraIssues[0].fields)) {
    return <JiraIssueDetail data={data} />;
  }

  // Could be a Confluence page
  if (data.title && (data.body || data.space)) {
    return (
      <div className="rounded-md border border-foreground/[0.06] px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <BookOpen className="h-3 w-3 shrink-0 text-foreground/30" />
          <span className="text-[11px] text-foreground/80">{data.title}</span>
          {data.space?.key && (
            <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">
              {data.space.key}
            </Badge>
          )}
        </div>
        {data.body?.storage?.value && (
          <p className="text-[10px] text-foreground/40 whitespace-pre-wrap line-clamp-4">
            {stripHtml(data.body.storage.value).slice(0, 500)}
          </p>
        )}
      </div>
    );
  }

  // Fallback: don't handle, let GenericContent take over
  return null;
}

export function RovoFetchResult({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  return <RovoFetchResultView data={data as RovoFetchData} />;
}

// ── Atlassian: Accessible Resources ──

interface AtlassianResource {
  id?: string;
  url?: string;
  name?: string;
  scopes?: string[];
  avatarUrl?: string;
}

function AtlassianResourcesListView({ data }: { data: AtlassianResource[] }) {
  if (data.length === 0) {
    return <McpEmptyState message="No accessible resources" />;
  }

  // Deduplicate by id (same site can appear twice with different scopes)
  const byId = new Map<string, { resource: AtlassianResource; allScopes: string[] }>();
  for (const r of data) {
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
      <McpListHeader count={byId.size} noun="site" />
      {[...byId.values()].map(({ resource, allScopes }) => (
        <div
          key={resource.id ?? resource.name}
          className={MCP_ROW_CLASS}
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

export function AtlassianResourcesList({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  return <AtlassianResourcesListView data={Array.isArray(data) ? data as AtlassianResource[] : []} />;
}
