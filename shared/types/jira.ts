/**
 * Jira integration types shared between electron and renderer processes
 */

export interface JiraProjectConfig {
  instanceUrl: string; // https://your-domain.atlassian.net
  projectKey: string; // e.g., "PROJ"
  boardId: string; // e.g., "1"
  boardName: string; // e.g., "Sprint Board"
  authMethod: "oauth" | "apitoken";
  isAuthenticated: boolean;
  createdAt: number;
  lastSync?: number;
}

export interface JiraBoard {
  id: string;
  name: string;
  type: "scrum" | "kanban" | "simple";
  projectKey?: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  description?: string;
  status: string;
  assignee?: {
    displayName: string;
    emailAddress?: string;
  };
  priority?: {
    name: string;
    iconUrl?: string;
  };
  issueType?: {
    name: string;
    iconUrl?: string;
  };
  url: string;
}

export interface JiraOAuthData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  instanceUrl: string;
  storedAt: number;
}

export interface JiraAuthResult {
  ok?: boolean;
  error?: string;
}

export interface JiraGetBoardsParams {
  instanceUrl: string;
  projectKey?: string;
}

export interface JiraGetIssuesParams {
  instanceUrl: string;
  boardId: string;
  maxResults?: number;
}
