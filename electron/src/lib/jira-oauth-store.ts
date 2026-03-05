/**
 * Jira OAuth token storage
 * Stores access tokens per Jira instance URL with secure file permissions
 */

import fs from "node:fs";
import path from "node:path";
import type { JiraOAuthData } from "@shared/types/jira";
import { getDataDir } from "./data-dir";
import { log } from "./logger";

function getJiraOAuthDir(): string {
  const dir = path.join(getDataDir(), "jira-oauth");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getOAuthFilePath(instanceUrl: string): string {
  // Sanitize URL to create safe filename
  const sanitized = instanceUrl
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9.-]/g, "_");
  return path.join(getJiraOAuthDir(), `${sanitized}.json`);
}

export function loadJiraOAuthData(
  instanceUrl: string
): JiraOAuthData | null {
  const filePath = getOAuthFilePath(instanceUrl);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(filePath, "utf-8");
    const oauthData = JSON.parse(data) as JiraOAuthData;
    return oauthData;
  } catch (error) {
    log(`Failed to load Jira OAuth data for ${instanceUrl}:`, error);
    return null;
  }
}

export function saveJiraOAuthData(
  instanceUrl: string,
  oauthData: JiraOAuthData
): void {
  const filePath = getOAuthFilePath(instanceUrl);

  try {
    const data = JSON.stringify(oauthData, null, 2);
    // Use secure file permissions (0o600 = read/write for owner only)
    fs.writeFileSync(filePath, data, { encoding: "utf-8", mode: 0o600 });
    log(`Saved Jira OAuth data for ${instanceUrl}`);
  } catch (error) {
    log(`Failed to save Jira OAuth data for ${instanceUrl}:`, error);
    throw error;
  }
}

export function deleteJiraOAuthData(instanceUrl: string): void {
  const filePath = getOAuthFilePath(instanceUrl);

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      log(`Deleted Jira OAuth data for ${instanceUrl}`);
    } catch (error) {
      log(`Failed to delete Jira OAuth data for ${instanceUrl}:`, error);
      throw error;
    }
  }
}

export function hasJiraOAuthToken(instanceUrl: string): boolean {
  const oauthData = loadJiraOAuthData(instanceUrl);
  if (!oauthData) return false;

  // Check if token is expired
  if (oauthData.expiresAt && oauthData.expiresAt < Date.now()) {
    return false;
  }

  return !!oauthData.accessToken;
}
