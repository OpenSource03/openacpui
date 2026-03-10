/**
 * IPC handlers for Jira integration
 */

import { ipcMain } from "electron";
import type {
  JiraProjectConfig,
  JiraAuthResult,
  JiraBoard,
  JiraIssue,
  JiraSprint,
  JiraComment,
  JiraTransition,
  JiraBoardConfiguration,
  JiraProjectSummary,
  JiraGetBoardsParams,
  JiraGetIssuesParams,
  JiraGetSprintsParams,
  JiraGetCommentsParams,
  JiraGetTransitionsParams,
  JiraTransitionIssueParams,
} from "@shared/types/jira";
import {
  loadJiraConfig,
  saveJiraConfig,
  deleteJiraConfig,
} from "../lib/jira-store";
import {
  loadJiraOAuthData,
  saveJiraOAuthData,
  deleteJiraOAuthData,
  hasJiraOAuthToken,
} from "../lib/jira-oauth-store";
import { reportError } from "../lib/error-utils";

/** Build the Authorization header for Jira API requests */
function buildAuthHeader(oauthData: {
  accessToken: string;
  email?: string;
}): string {
  if (oauthData.email) {
    // Jira Cloud: Basic auth with base64(email:apiToken)
    const credentials = Buffer.from(
      `${oauthData.email}:${oauthData.accessToken}`
    ).toString("base64");
    return `Basic ${credentials}`;
  }
  // Fallback for OAuth / Jira Server PATs
  return `Bearer ${oauthData.accessToken}`;
}

export function register() {
  // Configuration management
  ipcMain.handle(
    "jira:get-config",
    (_event, projectId: string): JiraProjectConfig | null => {
      try {
        return loadJiraConfig(projectId);
      } catch (error) {
        reportError("JIRA_GET_CONFIG_ERR", error);
        return null;
      }
    }
  );

  ipcMain.handle(
    "jira:save-config",
    (
      _event,
      { projectId, config }: { projectId: string; config: JiraProjectConfig }
    ): void => {
      try {
        saveJiraConfig(projectId, config);
      } catch (error) {
        reportError("JIRA_SAVE_CONFIG_ERR", error);
        throw error;
      }
    }
  );

  ipcMain.handle("jira:delete-config", (_event, projectId: string): void => {
    try {
      deleteJiraConfig(projectId);
    } catch (error) {
      reportError("JIRA_DELETE_CONFIG_ERR", error);
      throw error;
    }
  });

  // Authentication
  ipcMain.handle(
    "jira:authenticate",
    async (
      _event,
      {
        instanceUrl,
        method,
        apiToken,
        email,
      }: {
        instanceUrl: string;
        method: "oauth" | "apitoken";
        apiToken?: string;
        email?: string;
      }
    ): Promise<JiraAuthResult> => {
      try {
        if (method === "apitoken") {
          if (!apiToken) {
            return { error: "API token is required" };
          }
          if (!email) {
            return { error: "Email is required for API token authentication" };
          }

          saveJiraOAuthData(instanceUrl, {
            accessToken: apiToken,
            email,
            instanceUrl,
            storedAt: Date.now(),
          });

          return { ok: true };
        } else {
          // OAuth flow
          // TODO: Implement full OAuth flow similar to MCP OAuth
          // For now, return not implemented
          return {
            error:
              "OAuth authentication not yet implemented. Please use API token.",
          };
        }
      } catch (error) {
        return { error: reportError("JIRA_AUTH_ERR", error) };
      }
    }
  );

  ipcMain.handle(
    "jira:auth-status",
    (_event, instanceUrl: string): { hasToken: boolean } => {
      try {
        return { hasToken: hasJiraOAuthToken(instanceUrl) };
      } catch (error) {
        reportError("JIRA_AUTH_STATUS_ERR", error);
        return { hasToken: false };
      }
    }
  );

  ipcMain.handle("jira:logout", (_event, instanceUrl: string): void => {
    try {
      deleteJiraOAuthData(instanceUrl);
    } catch (error) {
      reportError("JIRA_LOGOUT_ERR", error);
      throw error;
    }
  });

  // Data fetching
  ipcMain.handle(
    "jira:get-boards",
    async (
      _event,
      { instanceUrl, projectKey }: JiraGetBoardsParams
    ): Promise<JiraBoard[]> => {
      try {
        const oauthData = loadJiraOAuthData(instanceUrl);
        if (!oauthData?.accessToken) {
          throw new Error("Not authenticated with Jira");
        }

        // Construct Jira API URL
        const baseUrl = instanceUrl.replace(/\/$/, "");
        let apiUrl = `${baseUrl}/rest/agile/1.0/board`;
        if (projectKey) {
          apiUrl += `?projectKeyOrId=${projectKey}`;
        }

        const response = await fetch(apiUrl, {
          headers: {
            Authorization: buildAuthHeader(oauthData),
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch boards: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        const boards: JiraBoard[] = (data.values || []).map(
          (board: { id: number; name: string; type: string }) => ({
            id: String(board.id),
            name: board.name,
            type: board.type,
          })
        );

        return boards;
      } catch (error) {
        reportError("JIRA_GET_BOARDS_ERR", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "jira:get-projects",
    async (
      _event,
      instanceUrl: string
    ): Promise<JiraProjectSummary[]> => {
      try {
        const oauthData = loadJiraOAuthData(instanceUrl);
        if (!oauthData?.accessToken) {
          throw new Error("Not authenticated with Jira");
        }

        const baseUrl = instanceUrl.replace(/\/$/, "");
        const apiUrl = `${baseUrl}/rest/api/3/project/search?maxResults=100`;

        const response = await fetch(apiUrl, {
          headers: {
            Authorization: buildAuthHeader(oauthData),
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch projects: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        return (data.values || []).map((project: any) => ({
          id: String(project.id ?? project.key),
          key: String(project.key ?? ""),
          name: String(project.name ?? project.key ?? "Untitled project"),
        }));
      } catch (error) {
        reportError("JIRA_GET_PROJECTS_ERR", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "jira:get-sprints",
    async (
      _event,
      { instanceUrl, boardId }: JiraGetSprintsParams
    ): Promise<JiraSprint[]> => {
      try {
        const oauthData = loadJiraOAuthData(instanceUrl);
        if (!oauthData?.accessToken) {
          throw new Error("Not authenticated with Jira");
        }

        const baseUrl = instanceUrl.replace(/\/$/, "");
        const apiUrl = `${baseUrl}/rest/agile/1.0/board/${boardId}/sprint?state=active,future,closed&maxResults=50`;

        const response = await fetch(apiUrl, {
          headers: {
            Authorization: buildAuthHeader(oauthData),
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          // Kanban boards don't have sprints — return empty instead of erroring
          if (response.status === 400) return [];
          throw new Error(
            `Failed to fetch sprints: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        const sprints: JiraSprint[] = (data.values || []).map(
          (sprint: { id: number; name: string; state: string; startDate?: string; endDate?: string }) => ({
            id: String(sprint.id),
            name: sprint.name,
            state: sprint.state as JiraSprint["state"],
            startDate: sprint.startDate,
            endDate: sprint.endDate,
          })
        );

        return sprints;
      } catch (error) {
        reportError("JIRA_GET_SPRINTS_ERR", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "jira:get-board-configuration",
    async (
      _event,
      { instanceUrl, boardId }: JiraGetSprintsParams
    ): Promise<JiraBoardConfiguration> => {
      try {
        const oauthData = loadJiraOAuthData(instanceUrl);
        if (!oauthData?.accessToken) {
          throw new Error("Not authenticated with Jira");
        }

        const baseUrl = instanceUrl.replace(/\/$/, "");
        const apiUrl = `${baseUrl}/rest/agile/1.0/board/${boardId}/configuration`;

        const response = await fetch(apiUrl, {
          headers: {
            Authorization: buildAuthHeader(oauthData),
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch board configuration: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        return {
          id: String(boardId),
          name: data.name ?? "",
          columns: (data.columnConfig?.columns || []).map((column: any, index: number) => ({
            id: `${String(boardId)}:${index}:${column.name ?? "column"}`,
            name: column.name ?? `Column ${index + 1}`,
            statusIds: Array.isArray(column.statuses)
              ? column.statuses
                  .map((status: any) => String(status.id ?? ""))
                  .filter((statusId: string) => statusId.length > 0)
              : [],
            min: typeof column.min === "number" ? column.min : undefined,
            max: typeof column.max === "number" ? column.max : undefined,
          })),
        };
      } catch (error) {
        reportError("JIRA_GET_BOARD_CONFIG_ERR", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "jira:get-issues",
    async (
      _event,
      { instanceUrl, boardId, sprintId, maxResults = 50 }: JiraGetIssuesParams
    ): Promise<JiraIssue[]> => {
      try {
        const oauthData = loadJiraOAuthData(instanceUrl);
        if (!oauthData?.accessToken) {
          throw new Error("Not authenticated with Jira");
        }

        const baseUrl = instanceUrl.replace(/\/$/, "");
        // Use sprint-specific endpoint when a sprint is selected
        const apiUrl = sprintId
          ? `${baseUrl}/rest/agile/1.0/sprint/${sprintId}/issue?maxResults=${maxResults}`
          : `${baseUrl}/rest/agile/1.0/board/${boardId}/issue?maxResults=${maxResults}`;

        const response = await fetch(apiUrl, {
          headers: {
            Authorization: buildAuthHeader(oauthData),
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch issues: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        const issues: JiraIssue[] = (data.issues || []).map((issue: any) => ({
          id: String(issue.id),
          key: issue.key,
          summary: issue.fields.summary,
          description: issue.fields.description,
          status: issue.fields.status?.name || "Unknown",
          statusId: issue.fields.status?.id ? String(issue.fields.status.id) : undefined,
          statusCategory: issue.fields.status?.statusCategory?.key,
          assignee: issue.fields.assignee
            ? {
                displayName: issue.fields.assignee.displayName,
                emailAddress: issue.fields.assignee.emailAddress,
                avatarUrl:
                  issue.fields.assignee.avatarUrls?.["48x48"] ??
                  issue.fields.assignee.avatarUrls?.["32x32"] ??
                  issue.fields.assignee.avatarUrls?.["24x24"] ??
                  issue.fields.assignee.avatarUrls?.["16x16"],
              }
            : undefined,
          priority: issue.fields.priority
            ? {
                name: issue.fields.priority.name,
                iconUrl: issue.fields.priority.iconUrl,
              }
            : undefined,
          issueType: issue.fields.issuetype
            ? {
                name: issue.fields.issuetype.name,
                iconUrl: issue.fields.issuetype.iconUrl,
              }
            : undefined,
          url: `${baseUrl}/browse/${issue.key}`,
        }));

        return issues;
      } catch (error) {
        reportError("JIRA_GET_ISSUES_ERR", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "jira:get-comments",
    async (
      _event,
      { instanceUrl, issueKey }: JiraGetCommentsParams
    ): Promise<JiraComment[]> => {
      try {
        const oauthData = loadJiraOAuthData(instanceUrl);
        if (!oauthData?.accessToken) {
          throw new Error("Not authenticated with Jira");
        }

        const baseUrl = instanceUrl.replace(/\/$/, "");
        const apiUrl = `${baseUrl}/rest/api/2/issue/${issueKey}/comment?orderBy=-created&maxResults=20`;

        const response = await fetch(apiUrl, {
          headers: {
            Authorization: buildAuthHeader(oauthData),
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch comments: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        const comments: JiraComment[] = (data.comments || []).map(
          (comment: { id: string; author?: { displayName?: string }; body?: string; created?: string }) => ({
            id: comment.id,
            author: comment.author?.displayName ?? "Unknown",
            authorAvatarUrl:
              (comment.author as { avatarUrls?: Record<string, string> } | undefined)?.avatarUrls?.["48x48"] ??
              (comment.author as { avatarUrls?: Record<string, string> } | undefined)?.avatarUrls?.["32x32"] ??
              (comment.author as { avatarUrls?: Record<string, string> } | undefined)?.avatarUrls?.["24x24"] ??
              (comment.author as { avatarUrls?: Record<string, string> } | undefined)?.avatarUrls?.["16x16"],
            body: comment.body ?? "",
            created: comment.created ?? "",
          })
        );

        return comments;
      } catch (error) {
        reportError("JIRA_GET_COMMENTS_ERR", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "jira:get-transitions",
    async (
      _event,
      { instanceUrl, issueKey }: JiraGetTransitionsParams
    ): Promise<JiraTransition[]> => {
      try {
        const oauthData = loadJiraOAuthData(instanceUrl);
        if (!oauthData?.accessToken) {
          throw new Error("Not authenticated with Jira");
        }

        const baseUrl = instanceUrl.replace(/\/$/, "");
        const apiUrl = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;

        const response = await fetch(apiUrl, {
          headers: {
            Authorization: buildAuthHeader(oauthData),
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch transitions: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        return (data.transitions || []).map((transition: any) => ({
          id: String(transition.id),
          name: transition.name,
          toStatus: {
            id: String(transition.to?.id ?? ""),
            name: transition.to?.name ?? transition.name,
            category: transition.to?.statusCategory?.key,
          },
        }));
      } catch (error) {
        reportError("JIRA_GET_TRANSITIONS_ERR", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "jira:transition-issue",
    async (
      _event,
      { instanceUrl, issueKey, transitionId }: JiraTransitionIssueParams
    ): Promise<{ ok: true }> => {
      try {
        const oauthData = loadJiraOAuthData(instanceUrl);
        if (!oauthData?.accessToken) {
          throw new Error("Not authenticated with Jira");
        }

        const baseUrl = instanceUrl.replace(/\/$/, "");
        const apiUrl = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: buildAuthHeader(oauthData),
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            transition: { id: transitionId },
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Failed to transition issue: ${response.status} ${response.statusText}`
          );
        }

        return { ok: true };
      } catch (error) {
        reportError("JIRA_TRANSITION_ISSUE_ERR", error);
        throw error;
      }
    }
  );
}
