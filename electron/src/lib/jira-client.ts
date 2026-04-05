/**
 * Pure Jira REST API client.
 *
 * Handles all fetch calls to Jira Cloud / Server APIs, response parsing,
 * and mapping from raw Jira payloads to the shared domain types.
 * No IPC or Electron dependencies -- independently testable.
 */

import type {
  JiraBoard,
  JiraBoardConfiguration,
  JiraComment,
  JiraIssue,
  JiraOAuthData,
  JiraProjectSummary,
  JiraSprint,
  JiraTransition,
} from "@shared/types/jira";
import { loadJiraOAuthData } from "./jira-oauth-store";
import { reportError } from "./error-utils";

// ---------------------------------------------------------------------------
// Raw Jira REST API response shapes
// ---------------------------------------------------------------------------

/** Board object returned by GET /rest/agile/1.0/board */
interface JiraRawBoard {
  id: number;
  name: string;
  type: string;
}

/** Sprint object returned by GET /rest/agile/1.0/board/{boardId}/sprint */
interface JiraRawSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
}

/** Project object returned by GET /rest/api/3/project/search */
interface JiraRawProject {
  id?: string | number;
  key?: string;
  name?: string;
}

/** Status sub-object inside a Jira issue's fields */
interface JiraRawStatus {
  id?: string | number;
  name?: string;
  statusCategory?: { key?: string };
}

/** Assignee / user sub-object inside a Jira issue's fields */
interface JiraRawUser {
  displayName?: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
}

/** Priority sub-object inside a Jira issue's fields */
interface JiraRawPriority {
  name?: string;
  iconUrl?: string;
}

/** Issue-type sub-object inside a Jira issue's fields */
interface JiraRawIssueType {
  name?: string;
  iconUrl?: string;
}

/** Fields on a Jira issue returned by the agile API */
interface JiraRawIssueFields {
  summary?: string;
  description?: unknown;
  status?: JiraRawStatus;
  assignee?: JiraRawUser;
  priority?: JiraRawPriority;
  issuetype?: JiraRawIssueType;
}

/** Issue object returned by board or sprint issue endpoints */
interface JiraRawIssue {
  id: string | number;
  key: string;
  fields: JiraRawIssueFields;
}

/** Comment author sub-object (includes avatarUrls not present in the base author type) */
interface JiraRawCommentAuthor {
  displayName?: string;
  avatarUrls?: Record<string, string>;
}

/** Comment object returned by GET /rest/api/2/issue/{key}/comment */
interface JiraRawComment {
  id: string;
  author?: JiraRawCommentAuthor;
  body?: string;
  created?: string;
}

/** Column status entry in board configuration */
interface JiraRawColumnStatus {
  id?: string | number;
}

/** Column entry in board configuration */
interface JiraRawColumn {
  name?: string;
  statuses?: JiraRawColumnStatus[];
  min?: number;
  max?: number;
}

/** Transition target status */
interface JiraRawTransitionTarget {
  id?: string | number;
  name?: string;
  statusCategory?: { key?: string };
}

/** Transition object returned by GET /rest/api/3/issue/{key}/transitions */
interface JiraRawTransition {
  id: string | number;
  name: string;
  to?: JiraRawTransitionTarget;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JiraResult<T> = T | { error: string };

/** Build the Authorization header for Jira API requests. */
function buildAuthHeader(oauthData: Pick<JiraOAuthData, "accessToken" | "email">): string {
  if (oauthData.email) {
    const credentials = Buffer.from(
      `${oauthData.email}:${oauthData.accessToken}`,
    ).toString("base64");
    return `Basic ${credentials}`;
  }
  return `Bearer ${oauthData.accessToken}`;
}

/**
 * Resolve OAuth data for an instance URL or return an error result.
 * Every public method calls this before making a request.
 */
function resolveAuth(instanceUrl: string): JiraOAuthData | { error: string } {
  const oauthData = loadJiraOAuthData(instanceUrl);
  if (!oauthData?.accessToken) {
    return { error: "Not authenticated with Jira" };
  }
  return oauthData;
}

/** Strip trailing slash from an instance URL to build API paths. */
function baseUrl(instanceUrl: string): string {
  return instanceUrl.replace(/\/$/, "");
}

/**
 * Generic JSON fetch with Jira auth headers.
 * Returns the parsed JSON body on success, or `{ error }` on HTTP failure.
 */
async function jiraFetch<T>(
  url: string,
  oauthData: JiraOAuthData,
  init?: RequestInit,
): Promise<JiraResult<T>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: buildAuthHeader(oauthData),
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const label = init?.method === "POST" ? "write" : "fetch";
    return {
      error: `Failed to ${label} data: ${response.status} ${response.statusText}`,
    };
  }

  // 204 No Content (e.g. transition-issue) has no body
  if (response.status === 204) {
    return {} as T;
  }
  return (await response.json()) as T;
}

/** Pick the best avatar URL from a `{ "48x48": ..., "32x32": ..., ... }` map. */
function pickAvatarUrl(avatarUrls: Record<string, string> | undefined): string | undefined {
  if (!avatarUrls) return undefined;
  return avatarUrls["48x48"] ?? avatarUrls["32x32"] ?? avatarUrls["24x24"] ?? avatarUrls["16x16"];
}

// ---------------------------------------------------------------------------
// Paginated response wrappers
// ---------------------------------------------------------------------------

interface JiraPaginatedValues<T> {
  values?: T[];
}

interface JiraIssueListResponse {
  issues?: JiraRawIssue[];
}

interface JiraCommentListResponse {
  comments?: JiraRawComment[];
}

interface JiraTransitionListResponse {
  transitions?: JiraRawTransition[];
}

interface JiraBoardConfigResponse {
  name?: string;
  columnConfig?: { columns?: JiraRawColumn[] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Fetch all boards, optionally filtered by project key. */
export async function getBoards(
  instanceUrl: string,
  projectKey?: string,
): Promise<JiraResult<JiraBoard[]>> {
  try {
    const auth = resolveAuth(instanceUrl);
    if ("error" in auth) return auth;

    let url = `${baseUrl(instanceUrl)}/rest/agile/1.0/board`;
    if (projectKey) url += `?projectKeyOrId=${projectKey}`;

    const data = await jiraFetch<JiraPaginatedValues<JiraRawBoard>>(url, auth);
    if ("error" in data) return data;

    return (data.values ?? []).map((board) => ({
      id: String(board.id),
      name: board.name,
      type: board.type as JiraBoard["type"],
    }));
  } catch (error) {
    return { error: reportError("JIRA_GET_BOARDS_ERR", error) };
  }
}

/** Fetch all projects visible to the authenticated user. */
export async function getProjects(
  instanceUrl: string,
): Promise<JiraResult<JiraProjectSummary[]>> {
  try {
    const auth = resolveAuth(instanceUrl);
    if ("error" in auth) return auth;

    const url = `${baseUrl(instanceUrl)}/rest/api/3/project/search?maxResults=100`;

    const data = await jiraFetch<JiraPaginatedValues<JiraRawProject>>(url, auth);
    if ("error" in data) return data;

    return (data.values ?? []).map((project) => ({
      id: String(project.id ?? project.key),
      key: String(project.key ?? ""),
      name: String(project.name ?? project.key ?? "Untitled project"),
    }));
  } catch (error) {
    return { error: reportError("JIRA_GET_PROJECTS_ERR", error) };
  }
}

/** Fetch sprints for a board. Returns `[]` for kanban boards (HTTP 400). */
export async function getSprints(
  instanceUrl: string,
  boardId: string,
): Promise<JiraResult<JiraSprint[]>> {
  try {
    const auth = resolveAuth(instanceUrl);
    if ("error" in auth) return auth;

    const url = `${baseUrl(instanceUrl)}/rest/agile/1.0/board/${boardId}/sprint?state=active,future,closed&maxResults=50`;

    const response = await fetch(url, {
      headers: {
        Authorization: buildAuthHeader(auth),
        Accept: "application/json",
      },
    });

    // Kanban boards don't have sprints -- return empty instead of erroring
    if (response.status === 400) return [];

    if (!response.ok) {
      return {
        error: `Failed to fetch sprints: ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as JiraPaginatedValues<JiraRawSprint>;
    return (data.values ?? []).map((sprint) => ({
      id: String(sprint.id),
      name: sprint.name,
      state: sprint.state as JiraSprint["state"],
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    }));
  } catch (error) {
    return { error: reportError("JIRA_GET_SPRINTS_ERR", error) };
  }
}

/** Fetch board configuration (column layout and WIP limits). */
export async function getBoardConfiguration(
  instanceUrl: string,
  boardId: string,
): Promise<JiraResult<JiraBoardConfiguration>> {
  try {
    const auth = resolveAuth(instanceUrl);
    if ("error" in auth) return auth;

    const url = `${baseUrl(instanceUrl)}/rest/agile/1.0/board/${boardId}/configuration`;

    const data = await jiraFetch<JiraBoardConfigResponse>(url, auth);
    if ("error" in data) return data;

    const columns = (data.columnConfig?.columns ?? []).map(
      (column, index) => ({
        id: `${boardId}:${index}:${column.name ?? "column"}`,
        name: column.name ?? `Column ${index + 1}`,
        statusIds: Array.isArray(column.statuses)
          ? column.statuses
              .map((status) => String(status.id ?? ""))
              .filter((id) => id.length > 0)
          : [],
        min: typeof column.min === "number" ? column.min : undefined,
        max: typeof column.max === "number" ? column.max : undefined,
      }),
    );

    return { id: String(boardId), name: data.name ?? "", columns };
  } catch (error) {
    return { error: reportError("JIRA_GET_BOARD_CONFIG_ERR", error) };
  }
}

/** Fetch issues for a board, optionally filtered to a specific sprint. */
export async function getIssues(
  instanceUrl: string,
  boardId: string,
  sprintId?: string,
  maxResults = 50,
): Promise<JiraResult<JiraIssue[]>> {
  try {
    const auth = resolveAuth(instanceUrl);
    if ("error" in auth) return auth;

    const base = baseUrl(instanceUrl);
    const url = sprintId
      ? `${base}/rest/agile/1.0/sprint/${sprintId}/issue?maxResults=${maxResults}`
      : `${base}/rest/agile/1.0/board/${boardId}/issue?maxResults=${maxResults}`;

    const data = await jiraFetch<JiraIssueListResponse>(url, auth);
    if ("error" in data) return data;

    return (data.issues ?? []).map((issue) => mapRawIssue(issue, base));
  } catch (error) {
    return { error: reportError("JIRA_GET_ISSUES_ERR", error) };
  }
}

/** Fetch comments for an issue. */
export async function getComments(
  instanceUrl: string,
  issueKey: string,
): Promise<JiraResult<JiraComment[]>> {
  try {
    const auth = resolveAuth(instanceUrl);
    if ("error" in auth) return auth;

    const url = `${baseUrl(instanceUrl)}/rest/api/2/issue/${issueKey}/comment?orderBy=-created&maxResults=20`;

    const data = await jiraFetch<JiraCommentListResponse>(url, auth);
    if ("error" in data) return data;

    return (data.comments ?? []).map((comment) => ({
      id: comment.id,
      author: comment.author?.displayName ?? "Unknown",
      authorAvatarUrl: pickAvatarUrl(comment.author?.avatarUrls),
      body: comment.body ?? "",
      created: comment.created ?? "",
    }));
  } catch (error) {
    return { error: reportError("JIRA_GET_COMMENTS_ERR", error) };
  }
}

/** Fetch available transitions for an issue. */
export async function getTransitions(
  instanceUrl: string,
  issueKey: string,
): Promise<JiraResult<JiraTransition[]>> {
  try {
    const auth = resolveAuth(instanceUrl);
    if ("error" in auth) return auth;

    const url = `${baseUrl(instanceUrl)}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;

    const data = await jiraFetch<JiraTransitionListResponse>(url, auth);
    if ("error" in data) return data;

    return (data.transitions ?? []).map((transition) => ({
      id: String(transition.id),
      name: transition.name,
      toStatus: {
        id: String(transition.to?.id ?? ""),
        name: transition.to?.name ?? transition.name,
        category: transition.to?.statusCategory?.key as JiraTransition["toStatus"]["category"],
      },
    }));
  } catch (error) {
    return { error: reportError("JIRA_GET_TRANSITIONS_ERR", error) };
  }
}

/** Execute a status transition on an issue. */
export async function transitionIssue(
  instanceUrl: string,
  issueKey: string,
  transitionId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const auth = resolveAuth(instanceUrl);
    if ("error" in auth) return auth;

    const url = `${baseUrl(instanceUrl)}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: buildAuthHeader(auth),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transition: { id: transitionId } }),
    });

    if (!response.ok) {
      return {
        error: `Failed to transition issue: ${response.status} ${response.statusText}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return { error: reportError("JIRA_TRANSITION_ISSUE_ERR", error) };
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** Map a raw Jira API issue to our domain `JiraIssue`. */
function mapRawIssue(issue: JiraRawIssue, base: string): JiraIssue {
  const { fields } = issue;
  return {
    id: String(issue.id),
    key: issue.key,
    summary: fields.summary ?? "",
    description: fields.description as JiraIssue["description"],
    status: fields.status?.name ?? "Unknown",
    statusId: fields.status?.id ? String(fields.status.id) : undefined,
    statusCategory: fields.status?.statusCategory?.key as JiraIssue["statusCategory"],
    assignee: fields.assignee
      ? {
          displayName: fields.assignee.displayName ?? "",
          emailAddress: fields.assignee.emailAddress,
          avatarUrl: pickAvatarUrl(fields.assignee.avatarUrls),
        }
      : undefined,
    priority: fields.priority
      ? { name: fields.priority.name ?? "", iconUrl: fields.priority.iconUrl }
      : undefined,
    issueType: fields.issuetype
      ? { name: fields.issuetype.name ?? "", iconUrl: fields.issuetype.iconUrl }
      : undefined,
    url: `${base}/browse/${issue.key}`,
  };
}
