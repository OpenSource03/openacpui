import {
  Terminal,
  FileText,
  FileEdit,
  Search,
  FolderSearch,
  Globe,
  Bot,
  Wrench,
  ListChecks,
  Lightbulb,
  Map,
  MessageCircleQuestion,
} from "lucide-react";

// ── Tool icons ──

export const TOOL_ICONS: Record<string, typeof Terminal> = {
  Bash: Terminal,
  Read: FileText,
  Write: FileEdit,
  Edit: FileEdit,
  Grep: Search,
  Glob: FolderSearch,
  WebSearch: Globe,
  WebFetch: Globe,
  Task: Bot,
  TodoWrite: ListChecks,
  EnterPlanMode: Lightbulb,
  ExitPlanMode: Map,
  AskUserQuestion: MessageCircleQuestion,
};

export function getToolIcon(toolName: string) {
  return TOOL_ICONS[toolName] ?? Wrench;
}

// ── Tool labels ──

export type ToolLabelType = "past" | "active" | "failure";
type ToolLabels = Record<ToolLabelType, string>;

export const TOOL_LABELS: Record<string, ToolLabels> = {
  Bash: { past: "Ran", active: "Running", failure: "run" },
  Read: { past: "Read", active: "Reading", failure: "read" },
  Write: { past: "Wrote", active: "Writing", failure: "write" },
  Edit: { past: "Edited", active: "Editing", failure: "edit" },
  Grep: { past: "Searched", active: "Searching", failure: "search" },
  Glob: { past: "Found", active: "Finding", failure: "find" },
  WebSearch: { past: "Searched web", active: "Searching web", failure: "search web" },
  WebFetch: { past: "Fetched", active: "Fetching", failure: "fetch" },
  TodoWrite: { past: "Updated tasks", active: "Updating tasks", failure: "update tasks" },
  EnterPlanMode: { past: "Entered plan mode", active: "Entering plan mode", failure: "enter plan mode" },
  ExitPlanMode: { past: "Presented plan", active: "Preparing plan", failure: "prepare plan" },
  AskUserQuestion: { past: "Asked", active: "Asking", failure: "ask" },
};

// MCP tool friendly names — pattern-matched for different server name prefixes
export const MCP_TOOL_LABELS: Array<{ pattern: RegExp; labels: ToolLabels }> = [
  { pattern: /searchJiraIssuesUsingJql$/, labels: { past: "Searched Jira", active: "Searching Jira", failure: "search Jira" } },
  { pattern: /getJiraIssue$/, labels: { past: "Fetched issue", active: "Fetching issue", failure: "fetch issue" } },
  { pattern: /getVisibleJiraProjects$/, labels: { past: "Listed projects", active: "Listing projects", failure: "list projects" } },
  { pattern: /createJiraIssue$/, labels: { past: "Created issue", active: "Creating issue", failure: "create issue" } },
  { pattern: /editJiraIssue$/, labels: { past: "Updated issue", active: "Updating issue", failure: "update issue" } },
  { pattern: /transitionJiraIssue$/, labels: { past: "Transitioned issue", active: "Transitioning issue", failure: "transition issue" } },
  { pattern: /addCommentToJiraIssue$/, labels: { past: "Added comment", active: "Adding comment", failure: "add comment" } },
  { pattern: /getTransitionsForJiraIssue$/, labels: { past: "Got transitions", active: "Getting transitions", failure: "get transitions" } },
  { pattern: /lookupJiraAccountId$/, labels: { past: "Looked up user", active: "Looking up user", failure: "look up user" } },
  { pattern: /getConfluencePage$/, labels: { past: "Fetched page", active: "Fetching page", failure: "fetch page" } },
  { pattern: /searchConfluenceUsingCql$/, labels: { past: "Searched Confluence", active: "Searching Confluence", failure: "search Confluence" } },
  { pattern: /getConfluenceSpaces$/, labels: { past: "Listed spaces", active: "Listing spaces", failure: "list spaces" } },
  { pattern: /createConfluencePage$/, labels: { past: "Created page", active: "Creating page", failure: "create page" } },
  { pattern: /updateConfluencePage$/, labels: { past: "Updated page", active: "Updating page", failure: "update page" } },
  { pattern: /getAccessibleAtlassianResources$/, labels: { past: "Got resources", active: "Getting resources", failure: "get resources" } },
  { pattern: /atlassianUserInfo$/, labels: { past: "Got user info", active: "Getting user info", failure: "get user info" } },
  { pattern: /Atlassian[/_]+search$/, labels: { past: "Searched Atlassian", active: "Searching Atlassian", failure: "search Atlassian" } },
  { pattern: /Atlassian[/_]+fetch$/, labels: { past: "Fetched resource", active: "Fetching resource", failure: "fetch resource" } },
  // Context7
  { pattern: /resolve-library-id$/, labels: { past: "Resolved library", active: "Resolving library", failure: "resolve library" } },
  { pattern: /query-docs$/, labels: { past: "Queried docs", active: "Querying docs", failure: "query docs" } },
];

export function getMcpToolLabel(toolName: string, type: ToolLabelType): string | null {
  for (const { pattern, labels } of MCP_TOOL_LABELS) {
    if (pattern.test(toolName)) return labels[type];
  }
  // Generic fallback for any MCP tool (mcp__Server__tool) or ACP tool (Tool: Server/tool)
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    const server = parts[1] ?? "MCP";
    if (type === "past") return `Called ${server}`;
    if (type === "active") return `Calling ${server}`;
    return `call ${server}`;
  }
  if (toolName.startsWith("Tool: ")) {
    const server = toolName.slice(6).split("/")[0] ?? "MCP";
    if (type === "past") return `Called ${server}`;
    if (type === "active") return `Calling ${server}`;
    return `call ${server}`;
  }
  return null;
}

export function getToolLabel(toolName: string, type: ToolLabelType): string | null {
  if (!toolName) return type === "failure" ? "run tool" : null;

  const native = TOOL_LABELS[toolName];
  if (native) return native[type];

  const mcp = getMcpToolLabel(toolName, type);
  if (mcp) return mcp;

  return type === "failure" ? `run ${toolName.toLowerCase()}` : null;
}
