/**
 * Jira project configuration storage
 * Stores per-project Jira board settings
 */

import fs from "node:fs";
import path from "node:path";
import type { JiraProjectConfig } from "@shared/types/jira";
import { getDataDir } from "./data-dir";
import { log } from "./logger";

function getJiraConfigDir(): string {
  const dir = path.join(getDataDir(), "jira");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getJiraConfigPath(projectId: string): string {
  return path.join(getJiraConfigDir(), `${projectId}.json`);
}

export function loadJiraConfig(projectId: string): JiraProjectConfig | null {
  const configPath = getJiraConfigPath(projectId);

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(data) as JiraProjectConfig;
    return config;
  } catch (error) {
    log(`Failed to load Jira config for project ${projectId}:`, error);
    return null;
  }
}

export function saveJiraConfig(
  projectId: string,
  config: JiraProjectConfig
): void {
  const configPath = getJiraConfigPath(projectId);

  try {
    const data = JSON.stringify(config, null, 2);
    fs.writeFileSync(configPath, data, "utf-8");
    log(`Saved Jira config for project ${projectId}`);
  } catch (error) {
    log(`Failed to save Jira config for project ${projectId}:`, error);
    throw error;
  }
}

export function deleteJiraConfig(projectId: string): void {
  const configPath = getJiraConfigPath(projectId);

  if (fs.existsSync(configPath)) {
    try {
      fs.unlinkSync(configPath);
      log(`Deleted Jira config for project ${projectId}`);
    } catch (error) {
      log(`Failed to delete Jira config for project ${projectId}:`, error);
      throw error;
    }
  }
}
