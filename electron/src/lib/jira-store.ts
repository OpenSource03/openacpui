/**
 * Jira project configuration storage.
 * Stores per-project Jira board settings.
 */

import type { JiraProjectConfig } from "@shared/types/jira";
import { JsonFileStore } from "./json-file-store";

const store = new JsonFileStore<JiraProjectConfig>({
  subDir: "jira",
  label: "JIRA_STORE",
});

export function loadJiraConfig(projectId: string): JiraProjectConfig | null {
  return store.load(projectId);
}

export function saveJiraConfig(
  projectId: string,
  config: JiraProjectConfig,
): void {
  store.save(projectId, config);
}

export function deleteJiraConfig(projectId: string): void {
  store.delete(projectId);
}
