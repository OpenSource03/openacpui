/**
 * Jira OAuth token storage.
 * Stores access tokens per Jira instance URL with safeStorage encryption.
 */

import type { JiraOAuthData } from "@shared/types/jira";
import { JsonFileStore } from "./json-file-store";

const store = new JsonFileStore<JiraOAuthData>({
  subDir: "jira-oauth",
  sanitizeKey: (url) =>
    url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9.-]/g, "_"),
  encrypt: true,
  label: "JIRA_OAUTH",
});

export function loadJiraOAuthData(instanceUrl: string): JiraOAuthData | null {
  return store.load(instanceUrl);
}

export function saveJiraOAuthData(
  instanceUrl: string,
  oauthData: JiraOAuthData,
): void {
  store.save(instanceUrl, oauthData);
}

export function deleteJiraOAuthData(instanceUrl: string): void {
  store.delete(instanceUrl);
}

export function hasJiraOAuthToken(instanceUrl: string): boolean {
  const oauthData = loadJiraOAuthData(instanceUrl);
  if (!oauthData) return false;

  // Check if token is expired
  if (oauthData.expiresAt && oauthData.expiresAt < Date.now()) {
    return false;
  }

  // Require email for Jira Cloud Basic auth (legacy tokens without email are invalid)
  return !!oauthData.accessToken && !!oauthData.email;
}
