/**
 * IPC handlers for Jira integration
 */

import { ipcMain } from "electron";
import type {
  JiraProjectConfig,
  JiraAuthResult,
  JiraBoard,
  JiraIssue,
  JiraGetBoardsParams,
  JiraGetIssuesParams,
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
import { log } from "../lib/logger";

export function register() {
  // Configuration management
  ipcMain.handle(
    "jira:get-config",
    (_event, projectId: string): JiraProjectConfig | null => {
      try {
        return loadJiraConfig(projectId);
      } catch (error) {
        log("jira:get-config error:", error);
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
        log("jira:save-config error:", error);
        throw error;
      }
    }
  );

  ipcMain.handle("jira:delete-config", (_event, projectId: string): void => {
    try {
      deleteJiraConfig(projectId);
    } catch (error) {
      log("jira:delete-config error:", error);
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
      }: { instanceUrl: string; method: "oauth" | "apitoken"; apiToken?: string }
    ): Promise<JiraAuthResult> => {
      try {
        if (method === "apitoken") {
          // For API token, we'll store it as the access token
          // Note: In production, you'd want to validate the token first
          if (!apiToken) {
            return { error: "API token is required" };
          }

          saveJiraOAuthData(instanceUrl, {
            accessToken: apiToken,
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
        log("jira:authenticate error:", error);
        return { error: String(error) };
      }
    }
  );

  ipcMain.handle(
    "jira:auth-status",
    (_event, instanceUrl: string): { hasToken: boolean } => {
      try {
        return { hasToken: hasJiraOAuthToken(instanceUrl) };
      } catch (error) {
        log("jira:auth-status error:", error);
        return { hasToken: false };
      }
    }
  );

  ipcMain.handle("jira:logout", (_event, instanceUrl: string): void => {
    try {
      deleteJiraOAuthData(instanceUrl);
    } catch (error) {
      log("jira:logout error:", error);
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
            Authorization: `Bearer ${oauthData.accessToken}`,
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
        log("jira:get-boards error:", error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "jira:get-issues",
    async (
      _event,
      { instanceUrl, boardId, maxResults = 50 }: JiraGetIssuesParams
    ): Promise<JiraIssue[]> => {
      try {
        const oauthData = loadJiraOAuthData(instanceUrl);
        if (!oauthData?.accessToken) {
          throw new Error("Not authenticated with Jira");
        }

        const baseUrl = instanceUrl.replace(/\/$/, "");
        const apiUrl = `${baseUrl}/rest/agile/1.0/board/${boardId}/issue?maxResults=${maxResults}`;

        const response = await fetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${oauthData.accessToken}`,
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
          key: issue.key,
          summary: issue.fields.summary,
          description: issue.fields.description,
          status: issue.fields.status?.name || "Unknown",
          assignee: issue.fields.assignee
            ? {
                displayName: issue.fields.assignee.displayName,
                emailAddress: issue.fields.assignee.emailAddress,
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
        log("jira:get-issues error:", error);
        throw error;
      }
    }
  );
}
