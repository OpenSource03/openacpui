import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  LayoutGrid,
  Bug,
  BookOpen,
  CheckCircle2,
  Clock,
  ArrowUpCircle,
  ArrowRightCircle,
  ArrowDownCircle,
  MinusCircle,
  Circle,
  AlertTriangle,
  Library,
  FileCode2,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { UIMessage } from "@/types";
import type { ToolUseResult } from "@/types/protocol";

const REMARK_PLUGINS = [remarkGfm];

// ── MCP tool result data extraction ──

function extractMcpData(result: ToolUseResult): unknown {
  // Prefer structuredContent (pre-parsed by MCP SDK)
  if (result.structuredContent) return result.structuredContent;

  // Try parsing content string
  if (typeof result.content === "string") {
    try {
      return JSON.parse(result.content);
    } catch {
      return null;
    }
  }

  // Array of text blocks (some MCP tools return this)
  if (Array.isArray(result.content)) {
    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  // If the result itself looks like a plain array (tool_use_result can be array)
  if (Array.isArray(result)) {
    const items = result as Array<{ type?: string; text?: string }>;
    const text = items
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("");
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return null;
}

/** Extract raw text content from MCP tool result (for tools that return markdown/text, not JSON) */
function extractMcpText(result: ToolUseResult): string | null {
  if (typeof result.content === "string") return result.content;
  if (Array.isArray(result.content)) {
    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    return text || null;
  }
  if (Array.isArray(result)) {
    const items = result as Array<{ type?: string; text?: string }>;
    return items.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("") || null;
  }
  return null;
}

// ── Registry: MCP tool name → renderer ──

type McpRenderer = (props: { data: unknown; toolInput: Record<string, unknown>; rawText?: string | null }) => React.ReactNode;

const MCP_RENDERERS: Record<string, McpRenderer> = {
  // Jira
  "mcp__Atlassian__searchJiraIssuesUsingJql": JiraIssueList,
  "mcp__Atlassian__getJiraIssue": JiraIssueDetail,
  "mcp__Atlassian__getVisibleJiraProjects": JiraProjectList,
  "mcp__Atlassian__getTransitionsForJiraIssue": JiraTransitions,
  // Confluence
  "mcp__Atlassian__searchConfluenceUsingCql": ConfluenceSearchResults,
  "mcp__Atlassian__getConfluenceSpaces": ConfluenceSpaces,
  // Rovo Search
  "mcp__Atlassian__search": RovoSearchResults,
  "mcp__Atlassian__fetch": RovoFetchResult,
  // Account / resources
  "mcp__Atlassian__getAccessibleAtlassianResources": AtlassianResourcesList,
  "mcp__claude_ai_Atlassian__getAccessibleAtlassianResources": AtlassianResourcesList,
  // Context7
  "mcp__Context7__resolve-library-id": Context7LibraryList,
  "mcp__Context7__query-docs": Context7DocsResult,
};

// Wildcard patterns for partial matches
// Handles both SDK names (mcp__Atlassian__tool) and ACP names (Tool: Atlassian/tool)
const MCP_PATTERN_RENDERERS: Array<{ pattern: RegExp; renderer: McpRenderer }> = [
  { pattern: /Atlassian[/_]+searchJiraIssuesUsingJql$/, renderer: JiraIssueList },
  { pattern: /Atlassian[/_]+getJiraIssue$/, renderer: JiraIssueDetail },
  { pattern: /Atlassian[/_]+getVisibleJiraProjects$/, renderer: JiraProjectList },
  { pattern: /Atlassian[/_]+getTransitionsForJiraIssue$/, renderer: JiraTransitions },
  { pattern: /Atlassian[/_]+searchConfluenceUsingCql$/, renderer: ConfluenceSearchResults },
  { pattern: /Atlassian[/_]+getConfluenceSpaces$/, renderer: ConfluenceSpaces },
  { pattern: /Atlassian[/_]+search$/, renderer: RovoSearchResults },
  { pattern: /Atlassian[/_]+fetch$/, renderer: RovoFetchResult },
  { pattern: /Atlassian[/_]+getAccessibleAtlassianResources$/, renderer: AtlassianResourcesList },
  // Context7
  { pattern: /Context7[/_]+resolve-library-id$/, renderer: Context7LibraryList },
  { pattern: /Context7[/_]+query-docs$/, renderer: Context7DocsResult },
];

function findRenderer(toolName: string): McpRenderer | null {
  if (MCP_RENDERERS[toolName]) return MCP_RENDERERS[toolName];
  for (const { pattern, renderer } of MCP_PATTERN_RENDERERS) {
    if (pattern.test(toolName)) return renderer;
  }
  return null;
}

// ── Public API ──

/** Check if this tool has a specialized MCP renderer */
export function hasMcpRenderer(toolName: string): boolean {
  return !!findRenderer(toolName);
}

/** Extract a compact summary for the collapsed tool line */
export function getMcpCompactSummary(toolName: string, toolInput: Record<string, unknown>): string {
  if (/searchJiraIssuesUsingJql/.test(toolName)) {
    return String(toolInput.jql ?? "").slice(0, 80);
  }
  if (/getJiraIssue/.test(toolName)) {
    return String(toolInput.issueIdOrKey ?? "");
  }
  if (/getVisibleJiraProjects/.test(toolName)) {
    return toolInput.searchString ? `"${toolInput.searchString}"` : "all projects";
  }
  if (/searchConfluenceUsingCql/.test(toolName)) {
    return String(toolInput.cql ?? "").slice(0, 80);
  }
  if (/Atlassian[/_]+search$/.test(toolName)) {
    return String(toolInput.query ?? "").slice(0, 80);
  }
  if (/Atlassian[/_]+fetch$/.test(toolName)) {
    const id = String(toolInput.id ?? "");
    // Extract the meaningful part from ARI
    const match = id.match(/(issue|page)\/(\d+)/);
    return match ? `${match[1]}/${match[2]}` : id.slice(0, 60);
  }
  // Context7
  if (/resolve-library-id$/.test(toolName)) {
    return String(toolInput.libraryName ?? toolInput.query ?? "").slice(0, 60);
  }
  if (/query-docs$/.test(toolName)) {
    return String(toolInput.query ?? "").slice(0, 60);
  }
  return "";
}

/** Render MCP tool result with specialized view */
export const McpToolContent = memo(function McpToolContent({ message }: { message: UIMessage }) {
  const toolName = message.toolName ?? "";
  const result = message.toolResult;
  if (!result) return null;

  const renderer = findRenderer(toolName);
  if (!renderer) return null;

  const data = extractMcpData(result);
  const rawText = extractMcpText(result);
  if (!data && !rawText) return null;

  return (
    <div className="text-xs">
      {renderer({ data, toolInput: message.toolInput ?? {}, rawText })}
    </div>
  );
});

// ── Jira status colors ──

const STATUS_COLORS: Record<string, string> = {
  "to do": "bg-muted text-muted-foreground",
  "open": "bg-muted text-muted-foreground",
  "backlog": "bg-muted text-muted-foreground",
  "in progress": "bg-blue-500/15 text-blue-400",
  "in review": "bg-purple-500/15 text-purple-400",
  "done": "bg-emerald-500/15 text-emerald-400",
  "closed": "bg-emerald-500/15 text-emerald-400",
  "resolved": "bg-emerald-500/15 text-emerald-400",
};

function getStatusColor(status: string): string {
  const lower = status.toLowerCase();
  return STATUS_COLORS[lower] ?? "bg-muted text-muted-foreground";
}

const PRIORITY_ICONS: Record<string, { icon: typeof ArrowUpCircle; color: string }> = {
  highest: { icon: ArrowUpCircle, color: "text-red-500" },
  high: { icon: ArrowUpCircle, color: "text-orange-500" },
  medium: { icon: ArrowRightCircle, color: "text-amber-500" },
  low: { icon: ArrowDownCircle, color: "text-blue-400" },
  lowest: { icon: ArrowDownCircle, color: "text-muted-foreground" },
};

const ISSUETYPE_ICONS: Record<string, { icon: typeof Bug; color: string }> = {
  bug: { icon: Bug, color: "text-red-400" },
  story: { icon: BookOpen, color: "text-emerald-400" },
  task: { icon: CheckCircle2, color: "text-blue-400" },
  "sub-task": { icon: MinusCircle, color: "text-blue-300" },
  subtask: { icon: MinusCircle, color: "text-blue-300" },
  epic: { icon: AlertTriangle, color: "text-purple-400" },
  chore: { icon: Clock, color: "text-muted-foreground" },
};

// ── Jira: Issue list (searchJiraIssuesUsingJql) ──

interface JiraIssue {
  key?: string;
  id?: string;
  fields?: {
    summary?: string;
    status?: { name?: string; statusCategory?: { name?: string; colorName?: string } };
    issuetype?: { name?: string; iconUrl?: string };
    priority?: { name?: string; iconUrl?: string };
    assignee?: { displayName?: string; avatarUrls?: Record<string, string> };
    created?: string;
    updated?: string;
    description?: unknown;
    [key: string]: unknown;
  };
  self?: string;
  webUrl?: string;
}

/** Unwrap Atlassian MCP response: `{ issues: { nodes: [...] } }` → issue array, or flat `{ key, fields }` → single issue */
function unwrapJiraIssues(data: unknown): JiraIssue[] {
  const obj = data as Record<string, unknown>;
  // Flat issue: { key, fields }
  if (obj.key || obj.fields) return [data as JiraIssue];
  // Wrapped: { issues: { nodes: [...] } } or { issues: [...] }
  if (obj.issues) {
    if (Array.isArray(obj.issues)) return obj.issues as JiraIssue[];
    const inner = obj.issues as Record<string, unknown>;
    if (Array.isArray(inner.nodes)) return inner.nodes as JiraIssue[];
  }
  return [];
}

function JiraIssueList({ data }: { data: unknown }) {
  const issues = unwrapJiraIssues(data);
  // Extract totalCount from nested wrapper if available
  const obj = data as Record<string, unknown>;
  const inner = obj.issues && typeof obj.issues === "object" && !Array.isArray(obj.issues)
    ? (obj.issues as { totalCount?: number })
    : null;
  const totalCount = inner?.totalCount ?? (obj.total as number | undefined);

  if (issues.length === 0) {
    return <p className="text-foreground/40 py-2">No issues found</p>;
  }

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium">
          {totalCount != null ? `${totalCount} issue${totalCount !== 1 ? "s" : ""}` : `${issues.length} results`}
        </span>
      </div>
      {issues.map((issue) => (
        <JiraIssueRow key={issue.key ?? issue.id} issue={issue} />
      ))}
    </div>
  );
}

function JiraIssueRow({ issue }: { issue: JiraIssue }) {
  const fields = issue.fields ?? {};
  const status = fields.status?.name ?? "";
  const issueType = fields.issuetype?.name ?? "";
  const priority = fields.priority?.name ?? "";
  const assignee = fields.assignee?.displayName;

  const typeInfo = ISSUETYPE_ICONS[issueType.toLowerCase()];
  const TypeIcon = typeInfo?.icon ?? Circle;
  const typeColor = typeInfo?.color ?? "text-foreground/40";

  const prioInfo = PRIORITY_ICONS[priority.toLowerCase()];
  const PrioIcon = prioInfo?.icon;
  const prioColor = prioInfo?.color;

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors group">
      <TypeIcon className={`h-3.5 w-3.5 shrink-0 ${typeColor}`} />
      <span className="shrink-0 text-[11px] font-mono text-foreground/50 w-[72px]">
        {issue.key}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/80">
        {fields.summary ?? "Untitled"}
      </span>
      {PrioIcon && (
        <PrioIcon className={`h-3 w-3 shrink-0 ${prioColor}`} />
      )}
      {status && (
        <Badge
          variant="outline"
          className={`h-4 shrink-0 px-1.5 text-[9px] font-medium border-0 ${getStatusColor(status)}`}
        >
          {status}
        </Badge>
      )}
      {assignee && (
        <span className="shrink-0 text-[10px] text-foreground/30 max-w-[80px] truncate">
          {assignee}
        </span>
      )}
    </div>
  );
}

// ── Jira: Issue detail (getJiraIssue) ──

function JiraIssueDetail({ data }: { data: unknown }) {
  const issues = unwrapJiraIssues(data);
  if (issues.length === 0) return null;
  const issue = issues[0];
  if (!issue.key && !issue.fields) return null;

  const fields = issue.fields ?? {};
  const status = fields.status?.name ?? "";
  const issueType = fields.issuetype?.name ?? "";
  const priority = fields.priority?.name ?? "";
  const assignee = fields.assignee?.displayName;
  const created = fields.created ? new Date(fields.created).toLocaleDateString() : "";

  const typeInfo = ISSUETYPE_ICONS[issueType.toLowerCase()];
  const TypeIcon = typeInfo?.icon ?? Circle;
  const typeColor = typeInfo?.color ?? "text-foreground/40";

  // Extract description — could be markdown string or ADF object
  let descText = "";
  if (fields.description) {
    if (typeof fields.description === "string") {
      descText = fields.description;
    } else {
      descText = extractAdfText(fields.description);
    }
  }

  return (
    <div className="rounded-md border border-foreground/[0.06] overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-foreground/[0.06]">
        <div className="flex items-center gap-2 mb-1">
          <TypeIcon className={`h-3.5 w-3.5 shrink-0 ${typeColor}`} />
          <span className="text-[11px] font-mono text-foreground/50">{issue.key}</span>
          <span className="text-[10px] text-foreground/30">{issueType}</span>
          {issue.webUrl && (
            <span className="text-[10px] text-foreground/20 truncate ms-auto">{issue.webUrl}</span>
          )}
        </div>
        <h4 className="text-[13px] font-medium text-foreground/90 wrap-break-word">
          {fields.summary ?? "Untitled"}
        </h4>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-3 py-2 text-[11px]">
        {status && (
          <Field label="Status">
            <Badge
              variant="outline"
              className={`h-4 px-1.5 text-[9px] font-medium border-0 ${getStatusColor(status)}`}
            >
              {status}
            </Badge>
          </Field>
        )}
        {priority && (
          <Field label="Priority">
            <span className="text-foreground/70">{priority}</span>
          </Field>
        )}
        {assignee && (
          <Field label="Assignee">
            <span className="text-foreground/70">{assignee}</span>
          </Field>
        )}
        {created && (
          <Field label="Created">
            <span className="text-foreground/40">{created}</span>
          </Field>
        )}
      </div>

      {/* Description — full markdown rendering */}
      {descText && (
        <div className="border-t border-foreground/[0.06] px-3 py-2">
          <p className="text-[10px] text-foreground/30 mb-1 uppercase tracking-wider font-medium">Description</p>
          <div className="prose dark:prose-invert prose-xs max-w-none text-foreground/70 wrap-break-word">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
              {descText}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-foreground/30 shrink-0">{label}</span>
      {children}
    </div>
  );
}

/** Extract plain text from Atlassian Document Format */
function extractAdfText(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";
  const node = adf as { type?: string; text?: string; content?: unknown[] };
  if (node.type === "text" && node.text) return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map(extractAdfText).join("");
  }
  return "";
}

// ── Jira: Project list (getVisibleJiraProjects) ──

interface JiraProject {
  key?: string;
  name?: string;
  projectTypeKey?: string;
  style?: string;
  issueTypes?: Array<{ name?: string }>;
}

function JiraProjectList({ data }: { data: unknown }) {
  const obj = data as { values?: JiraProject[]; total?: number };
  const projects = obj.values ?? (Array.isArray(data) ? (data as JiraProject[]) : []);
  if (projects.length === 0) {
    return <p className="text-foreground/40 py-2">No projects found</p>;
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        {obj.total ?? projects.length} project{(obj.total ?? projects.length) !== 1 ? "s" : ""}
      </span>
      {projects.map((project) => (
        <div
          key={project.key}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors"
        >
          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-blue-400/60" />
          <span className="shrink-0 text-[11px] font-mono text-foreground/50 w-[52px]">
            {project.key}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground/80">
            {project.name ?? "Unnamed"}
          </span>
          <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">
            {project.projectTypeKey ?? "project"}
          </Badge>
          {project.issueTypes && (
            <span className="shrink-0 text-[10px] text-foreground/30">
              {project.issueTypes.length} type{project.issueTypes.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Jira: Transitions ──

function JiraTransitions({ data }: { data: unknown }) {
  const obj = data as { transitions?: Array<{ id?: string; name?: string; to?: { name?: string } }> };
  const transitions = obj.transitions;
  if (!transitions || transitions.length === 0) {
    return <p className="text-foreground/40 py-2">No transitions available</p>;
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        Available transitions
      </span>
      {transitions.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 rounded-md px-2 py-1 text-[11px]"
        >
          <ArrowRightCircle className="h-3 w-3 shrink-0 text-foreground/30" />
          <span className="text-foreground/70">{t.name}</span>
          {t.to?.name && (
            <>
              <span className="text-foreground/20">&rarr;</span>
              <Badge
                variant="outline"
                className={`h-4 px-1.5 text-[9px] font-medium border-0 ${getStatusColor(t.to.name)}`}
              >
                {t.to.name}
              </Badge>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Confluence: Search results ──

function ConfluenceSearchResults({ data }: { data: unknown }) {
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

function ConfluenceSpaces({ data }: { data: unknown }) {
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

// ── Rovo Search results ──

function RovoSearchResults({ data }: { data: unknown }) {
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

function RovoFetchResult({ data }: { data: unknown }) {
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

function AtlassianResourcesList({ data }: { data: unknown }) {
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

// ── Context7: Library search (resolve-library-id) ──

interface Context7Library {
  title?: string;
  libraryId?: string;
  description?: string;
  codeSnippets?: number;
  sourceReputation?: string;
  benchmarkScore?: number;
  versions?: string[];
}

/** Parse the text-based resolve-library-id response into structured library entries */
function parseContext7Libraries(text: string): Context7Library[] {
  const entries: Context7Library[] = [];
  // Split by the ---------- separator
  const blocks = text.split(/^-{5,}$/m).filter((b) => b.trim());

  for (const block of blocks) {
    // Skip the header/intro block
    if (!block.includes("Context7-compatible library ID:")) continue;

    const lib: Context7Library = {};
    const lines = block.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- Title:")) lib.title = trimmed.slice(9).trim();
      else if (trimmed.startsWith("- Context7-compatible library ID:")) lib.libraryId = trimmed.slice(33).trim();
      else if (trimmed.startsWith("- Description:")) lib.description = trimmed.slice(14).trim();
      else if (trimmed.startsWith("- Code Snippets:")) lib.codeSnippets = parseInt(trimmed.slice(16).trim()) || 0;
      else if (trimmed.startsWith("- Source Reputation:")) lib.sourceReputation = trimmed.slice(20).trim();
      else if (trimmed.startsWith("- Benchmark Score:")) lib.benchmarkScore = parseFloat(trimmed.slice(18).trim()) || 0;
      else if (trimmed.startsWith("- Versions:")) lib.versions = trimmed.slice(11).trim().split(/,\s*/);
    }
    if (lib.title || lib.libraryId) entries.push(lib);
  }
  return entries;
}

function Context7LibraryList({ rawText }: { data: unknown; rawText?: string | null }) {
  const text = rawText ?? "";
  const libraries = parseContext7Libraries(text);

  if (libraries.length === 0) {
    // Fallback: render raw text if parsing fails
    if (text.trim()) {
      return (
        <div className="prose dark:prose-invert prose-xs max-w-none text-foreground/70 wrap-break-word">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{text}</ReactMarkdown>
        </div>
      );
    }
    return <p className="text-foreground/40 py-2">No libraries found</p>;
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        {libraries.length} librar{libraries.length !== 1 ? "ies" : "y"}
      </span>
      {libraries.map((lib) => {
        const reputationColor = lib.sourceReputation === "High"
          ? "text-emerald-400"
          : lib.sourceReputation === "Medium"
            ? "text-amber-400"
            : "text-foreground/40";
        const scoreColor = (lib.benchmarkScore ?? 0) >= 85
          ? "text-emerald-400"
          : (lib.benchmarkScore ?? 0) >= 70
            ? "text-amber-400"
            : "text-foreground/40";
        return (
          <div
            key={lib.libraryId ?? lib.title}
            className="rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Library className="h-3.5 w-3.5 shrink-0 text-purple-400/60" />
              <span className="text-[11px] font-medium text-foreground/80 truncate">{lib.title}</span>
              {lib.benchmarkScore != null && (
                <span className={`text-[10px] shrink-0 font-mono ${scoreColor}`}>
                  {lib.benchmarkScore}
                </span>
              )}
              {lib.sourceReputation && (
                <Badge variant="outline" className={`h-3.5 px-1 text-[9px] shrink-0 border-0 ${reputationColor} bg-foreground/[0.03]`}>
                  {lib.sourceReputation}
                </Badge>
              )}
            </div>
            <div className="ms-[22px] mt-0.5">
              {lib.description && (
                <p className="text-[10px] text-foreground/40 truncate">{lib.description}</p>
              )}
              <div className="flex items-center gap-3 mt-0.5">
                {lib.libraryId && (
                  <span className="text-[10px] font-mono text-foreground/30">{lib.libraryId}</span>
                )}
                {lib.codeSnippets != null && (
                  <span className="text-[10px] text-foreground/30 flex items-center gap-0.5">
                    <FileCode2 className="h-2.5 w-2.5" />
                    {lib.codeSnippets.toLocaleString()} snippets
                  </span>
                )}
              </div>
              {lib.versions && lib.versions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {lib.versions.map((v) => (
                    <Badge key={v} variant="outline" className="h-3.5 px-1 text-[8px] text-foreground/30 border-foreground/10">
                      {v}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Context7: Documentation query (query-docs) ──

interface Context7DocSnippet {
  heading: string;
  source?: string;
  description: string;
  codeBlocks: Array<{ lang: string; code: string }>;
}

/** Parse query-docs response into structured doc snippets */
function parseContext7Docs(text: string): Context7DocSnippet[] {
  const snippets: Context7DocSnippet[] = [];
  // Split by the ---- separator between snippets
  const blocks = text.split(/^-{5,}$/m).filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let heading = "";
    let source: string | undefined;
    const descLines: string[] = [];
    const codeBlocks: Array<{ lang: string; code: string }> = [];
    let inCode = false;
    let codeLang = "";
    let codeLines: string[] = [];

    for (const line of lines) {
      if (inCode) {
        if (line.startsWith("```")) {
          codeBlocks.push({ lang: codeLang, code: codeLines.join("\n") });
          codeLines = [];
          inCode = false;
        } else {
          codeLines.push(line);
        }
      } else if (line.startsWith("```")) {
        inCode = true;
        codeLang = line.slice(3).trim() || "text";
      } else if (line.startsWith("### ") && !heading) {
        heading = line.slice(4).trim();
      } else if (line.startsWith("Source: ")) {
        source = line.slice(8).trim();
      } else {
        descLines.push(line);
      }
    }

    const description = descLines.join("\n").trim();
    if (heading || description || codeBlocks.length > 0) {
      snippets.push({ heading, source, description, codeBlocks });
    }
  }
  return snippets;
}

function Context7DocsResult({ rawText, toolInput }: { data: unknown; toolInput: Record<string, unknown>; rawText?: string | null }) {
  const text = rawText ?? "";
  const snippets = parseContext7Docs(text);
  const query = String(toolInput.query ?? "");
  const libraryId = String(toolInput.libraryId ?? "");

  if (snippets.length === 0) {
    if (text.trim()) {
      return (
        <div className="prose dark:prose-invert prose-xs max-w-none text-foreground/70 wrap-break-word">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{text}</ReactMarkdown>
        </div>
      );
    }
    return <p className="text-foreground/40 py-2">No documentation found</p>;
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium">
          {snippets.length} snippet{snippets.length !== 1 ? "s" : ""}
        </span>
        {libraryId && (
          <span className="text-[10px] font-mono text-foreground/30">{libraryId}</span>
        )}
        {query && (
          <span className="text-[10px] text-foreground/20 truncate">&ldquo;{query}&rdquo;</span>
        )}
      </div>

      {snippets.map((snippet, i) => (
        <div key={i} className="rounded-md border border-foreground/[0.06] overflow-hidden">
          {/* Snippet header */}
          {snippet.heading && (
            <div className="px-3 py-1.5 border-b border-foreground/[0.06] flex items-center gap-2">
              <FileCode2 className="h-3 w-3 shrink-0 text-blue-400/60" />
              <span className="text-[11px] font-medium text-foreground/80 wrap-break-word">{snippet.heading}</span>
            </div>
          )}

          {/* Description */}
          {snippet.description && (
            <div className="px-3 py-1.5 text-[10px] text-foreground/50 wrap-break-word">
              {snippet.description}
            </div>
          )}

          {/* Code blocks */}
          {snippet.codeBlocks.map((cb, j) => (
            <div key={j} className="border-t border-foreground/[0.06]">
              <pre className="px-3 py-2 text-[10px] text-foreground/70 overflow-x-auto bg-foreground/[0.02]">
                <code>{cb.code}</code>
              </pre>
            </div>
          ))}

          {/* Source link */}
          {snippet.source && (
            <div className="px-3 py-1 border-t border-foreground/[0.06] flex items-center gap-1">
              <ExternalLink className="h-2.5 w-2.5 text-foreground/20" />
              <span className="text-[9px] text-foreground/25 truncate">{snippet.source}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Helpers ──

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
