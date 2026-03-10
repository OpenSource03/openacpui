import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { InstalledAgent } from "@/types";
import { reportError } from "@/lib/analytics";
import { fetchAgentRegistry, resolveRegistryBinaryPaths } from "@/lib/acp-agent-registry";
import { planAcpAgentUpdates } from "@/lib/acp-agent-updates";

const PERIODIC_ACP_AGENT_UPDATE_CHECK_MS = 4 * 60 * 60 * 1000; // 4 hours
const ACTIVE_ACP_AGENT_UPDATE_MIN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

interface UseAcpAgentAutoUpdateOptions {
  installedAgents: InstalledAgent[];
  refreshInstalledAgents: () => Promise<void>;
}

type CheckTrigger = "startup" | "periodic" | "visibility";

export function useAcpAgentAutoUpdate({
  installedAgents,
  refreshInstalledAgents,
}: UseAcpAgentAutoUpdateOptions) {
  const managedAgentCount = installedAgents.filter(
    (agent) => agent.engine === "acp" && !!agent.registryId && !agent.builtIn,
  ).length;
  const installedAgentsRef = useRef(installedAgents);
  installedAgentsRef.current = installedAgents;

  const refreshInstalledAgentsRef = useRef(refreshInstalledAgents);
  refreshInstalledAgentsRef.current = refreshInstalledAgents;

  const isCheckingRef = useRef(false);
  const lastCheckAtRef = useRef(0);

  const runCheck = useCallback(async (trigger: CheckTrigger, forceRegistryRefresh: boolean) => {
    const managedAgents = installedAgentsRef.current.filter(
      (agent) => agent.engine === "acp" && !!agent.registryId && !agent.builtIn,
    );
    if (managedAgents.length === 0 || isCheckingRef.current) return;

    isCheckingRef.current = true;
    lastCheckAtRef.current = Date.now();
    let attemptedUpdate = false;

    try {
      const registry = await fetchAgentRegistry(forceRegistryRefresh);
      const binaryPaths = await resolveRegistryBinaryPaths(registry.agents);
      const updates = planAcpAgentUpdates(
        installedAgentsRef.current,
        registry.agents,
        binaryPaths,
      );
      if (updates.length === 0) return;
      attemptedUpdate = true;

      for (const update of updates) {
        const result = await window.claude.agents.save(update.next);
        if (!result.ok) {
          throw new Error(
            result.error ?? `Failed to update ${update.current.name}`,
          );
        }
      }

      await refreshInstalledAgentsRef.current();

      const versionSummary = updates.length === 1
        ? `${updates[0].current.name} is now on v${updates[0].registry.version}`
        : updates
          .slice(0, 2)
          .map((update) => `${update.current.name} v${update.registry.version}`)
          .join(", ");

      toast.success(
        updates.length === 1
          ? "ACP agent updated"
          : `Updated ${updates.length} ACP agents`,
        {
          description: updates.length > 2
            ? `${versionSummary}, and ${updates.length - 2} more.`
            : versionSummary,
        },
      );
    } catch (err) {
      const message = reportError("ACP_AGENT_AUTO_UPDATE", err, { trigger });
      if (attemptedUpdate) {
        toast.error("Failed to auto-update ACP agents", { description: message });
      }
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (managedAgentCount > 0 && lastCheckAtRef.current === 0) {
      void runCheck("startup", false);
    }
  }, [managedAgentCount, runCheck]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        void runCheck("periodic", true);
      }
    }, PERIODIC_ACP_AGENT_UPDATE_CHECK_MS);

    const onVisibilityChange = () => {
      if (document.hidden) return;
      if (Date.now() - lastCheckAtRef.current < ACTIVE_ACP_AGENT_UPDATE_MIN_INTERVAL_MS) return;
      void runCheck("visibility", true);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [runCheck]);
}
