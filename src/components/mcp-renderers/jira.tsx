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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const REMARK_PLUGINS = [remarkGfm];

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

// ── Types ──

export interface JiraIssue {
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
export function unwrapJiraIssues(data: unknown): JiraIssue[] {
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

// ── Jira: Issue list (searchJiraIssuesUsingJql) ──

export function JiraIssueList({ data }: { data: unknown }) {
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

export function JiraIssueDetail({ data }: { data: unknown }) {
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

export function JiraProjectList({ data }: { data: unknown }) {
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

export function JiraTransitions({ data }: { data: unknown }) {
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
