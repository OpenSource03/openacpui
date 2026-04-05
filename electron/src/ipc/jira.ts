/**
 * IPC handlers for Jira integration.
 *
 * Thin routing layer -- all REST API logic lives in ../lib/jira-client.ts.
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
  saveJiraOAuthData,
  deleteJiraOAuthData,
  hasJiraOAuthToken,
} from "../lib/jira-oauth-store";
import { reportError } from "../lib/error-utils";
import * as jiraClient from "../lib/jira-client";

export function register() {
  // -----------------------------------------------------------------------
  // Configuration management
  // -----------------------------------------------------------------------

  ipcMain.handle(
    "jira:get-config",
    (_event, projectId: string): JiraProjectConfig | null => {
      try {
        return loadJiraConfig(projectId);
      } catch (error) {
        reportError("JIRA_GET_CONFIG_ERR", error);
        return null;
      }
    },
  );

  ipcMain.handle(
    "jira:save-config",
    (
      _event,
      { projectId, config }: { projectId: string; config: JiraProjectConfig },
    ): { ok: true } | { error: string } => {
      try {
        saveJiraConfig(projectId, config);
        return { ok: true };
      } catch (error) {
        return { error: reportError("JIRA_SAVE_CONFIG_ERR", error) };
      }
    },
  );

  ipcMain.handle(
    "jira:delete-config",
    (_event, projectId: string): { ok: true } | { error: string } => {
      try {
        deleteJiraConfig(projectId);
        return { ok: true };
      } catch (error) {
        return { error: reportError("JIRA_DELETE_CONFIG_ERR", error) };
      }
    },
  );

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

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
      },
    ): Promise<JiraAuthResult> => {
      try {
        if (method === "apitoken") {
          if (!apiToken) return { error: "API token is required" };
          if (!email) return { error: "Email is required for API token authentication" };

          saveJiraOAuthData(instanceUrl, {
            accessToken: apiToken,
            email,
            instanceUrl,
            storedAt: Date.now(),
          });

          return { ok: true };
        }

        // OAuth flow -- not yet implemented
        return {
          error: "OAuth authentication not yet implemented. Please use API token.",
        };
      } catch (error) {
        return { error: reportError("JIRA_AUTH_ERR", error) };
      }
    },
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
    },
  );

  ipcMain.handle(
    "jira:logout",
    (_event, instanceUrl: string): { ok: true } | { error: string } => {
      try {
        deleteJiraOAuthData(instanceUrl);
        return { ok: true };
      } catch (error) {
        return { error: reportError("JIRA_LOGOUT_ERR", error) };
      }
    },
  );

  // -----------------------------------------------------------------------
  // Data fetching -- delegates to jira-client.ts
  // -----------------------------------------------------------------------

  ipcMain.handle(
    "jira:get-boards",
    (
      _event,
      { instanceUrl, projectKey }: JiraGetBoardsParams,
    ): Promise<JiraBoard[] | { error: string }> => {
      return jiraClient.getBoards(instanceUrl, projectKey);
    },
  );

  ipcMain.handle(
    "jira:get-projects",
    (
      _event,
      instanceUrl: string,
    ): Promise<JiraProjectSummary[] | { error: string }> => {
      return jiraClient.getProjects(instanceUrl);
    },
  );

  ipcMain.handle(
    "jira:get-sprints",
    (
      _event,
      { instanceUrl, boardId }: JiraGetSprintsParams,
    ): Promise<JiraSprint[] | { error: string }> => {
      return jiraClient.getSprints(instanceUrl, boardId);
    },
  );

  ipcMain.handle(
    "jira:get-board-configuration",
    (
      _event,
      { instanceUrl, boardId }: JiraGetSprintsParams,
    ): Promise<JiraBoardConfiguration | { error: string }> => {
      return jiraClient.getBoardConfiguration(instanceUrl, boardId);
    },
  );

  ipcMain.handle(
    "jira:get-issues",
    (
      _event,
      { instanceUrl, boardId, sprintId, maxResults }: JiraGetIssuesParams,
    ): Promise<JiraIssue[] | { error: string }> => {
      return jiraClient.getIssues(instanceUrl, boardId, sprintId, maxResults);
    },
  );

  ipcMain.handle(
    "jira:get-comments",
    (
      _event,
      { instanceUrl, issueKey }: JiraGetCommentsParams,
    ): Promise<JiraComment[] | { error: string }> => {
      return jiraClient.getComments(instanceUrl, issueKey);
    },
  );

  ipcMain.handle(
    "jira:get-transitions",
    (
      _event,
      { instanceUrl, issueKey }: JiraGetTransitionsParams,
    ): Promise<JiraTransition[] | { error: string }> => {
      return jiraClient.getTransitions(instanceUrl, issueKey);
    },
  );

  ipcMain.handle(
    "jira:transition-issue",
    (
      _event,
      { instanceUrl, issueKey, transitionId }: JiraTransitionIssueParams,
    ): Promise<{ ok: true } | { error: string }> => {
      return jiraClient.transitionIssue(instanceUrl, issueKey, transitionId);
    },
  );
}
