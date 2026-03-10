/**
 * React hook for managing Jira configuration per project
 */

import { useState, useEffect, useCallback } from "react";
import type { JiraProjectConfig } from "@shared/types/jira";
import { captureException } from "@/lib/analytics";

export function useJiraConfig(projectId: string | null) {
  const [config, setConfig] = useState<JiraProjectConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load config when projectId changes
  useEffect(() => {
    if (!projectId) {
      setConfig(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    window.claude.jira
      .getConfig(projectId)
      .then((loadedConfig) => {
        setConfig(loadedConfig);
        setLoading(false);
      })
      .catch((err) => {
        captureException(err instanceof Error ? err : new Error(String(err)), { label: "JIRA_CONFIG_LOAD_ERR" });
        setError(String(err));
        setLoading(false);
      });
  }, [projectId]);

  const saveConfig = useCallback(
    async (newConfig: JiraProjectConfig) => {
      if (!projectId) return;

      try {
        setError(null);
        await window.claude.jira.saveConfig(projectId, newConfig);
        setConfig(newConfig);
      } catch (err) {
        captureException(err instanceof Error ? err : new Error(String(err)), { label: "JIRA_CONFIG_SAVE_ERR" });
        setError(String(err));
        throw err;
      }
    },
    [projectId]
  );

  const deleteConfig = useCallback(async () => {
    if (!projectId) return;

    try {
      setError(null);
      await window.claude.jira.deleteConfig(projectId);
      setConfig(null);
    } catch (err) {
      captureException(err instanceof Error ? err : new Error(String(err)), { label: "JIRA_CONFIG_DELETE_ERR" });
      setError(String(err));
      throw err;
    }
  }, [projectId]);

  return {
    config,
    loading,
    error,
    saveConfig,
    deleteConfig,
  };
}
