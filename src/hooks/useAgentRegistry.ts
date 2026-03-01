import { useState, useEffect, useCallback } from "react";
import type { InstalledAgent } from "@/types";

export function useAgentRegistry() {
  const [agents, setAgents] = useState<InstalledAgent[]>([]);

  const refresh = useCallback(async () => {
    const list = await window.claude.agents.list();
    setAgents(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveAgent = useCallback(async (agent: InstalledAgent) => {
    const result = await window.claude.agents.save(agent);
    if (result.ok) await refresh();
    return result;
  }, [refresh]);

  const deleteAgent = useCallback(async (id: string) => {
    const result = await window.claude.agents.delete(id);
    if (result.ok) await refresh();
    return result;
  }, [refresh]);

  return { agents, refresh, saveAgent, deleteAgent };
}
