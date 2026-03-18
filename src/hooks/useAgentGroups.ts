import { useState, useEffect, useCallback } from "react";
import type { AgentGroup } from "@/types/groups";

export interface UseAgentGroupsReturn {
  groups: AgentGroup[];
  loading: boolean;
  createGroup: (group: AgentGroup) => Promise<void>;
  updateGroup: (group: AgentGroup) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  refreshGroups: () => Promise<void>;
}

export function useAgentGroups(): UseAgentGroupsReturn {
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshGroups = useCallback(async () => {
    setLoading(true);
    const result = await window.claude.groups.list();
    if (result.ok && result.groups) {
      setGroups(result.groups);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

  const createGroup = useCallback(
    async (group: AgentGroup) => {
      await window.claude.groups.create(group);
      await refreshGroups();
    },
    [refreshGroups],
  );

  const updateGroup = useCallback(
    async (group: AgentGroup) => {
      await window.claude.groups.update(group);
      await refreshGroups();
    },
    [refreshGroups],
  );

  const deleteGroup = useCallback(
    async (groupId: string) => {
      await window.claude.groups.delete(groupId);
      await refreshGroups();
    },
    [refreshGroups],
  );

  return {
    groups,
    loading,
    createGroup,
    updateGroup,
    deleteGroup,
    refreshGroups,
  };
}
