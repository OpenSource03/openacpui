import { memo } from "react";
import type { UIMessage } from "@/types";
import type { ToolUseResult } from "@/types/protocol";

// ── MCP renderers (extracted) ──
import { JiraIssueList, JiraIssueDetail, JiraProjectList, JiraTransitions } from "./mcp-renderers/jira";
import { ConfluenceSearchResults, ConfluenceSpaces } from "./mcp-renderers/confluence";
import { RovoSearchResults, RovoFetchResult, AtlassianResourcesList } from "./mcp-renderers/atlassian";
import { Context7LibraryList, Context7DocsResult } from "./mcp-renderers/context7";

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
