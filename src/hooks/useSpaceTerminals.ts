import { useCallback, useState } from "react";

export interface TerminalTab {
  id: string;
  terminalId: string;
  label: string;
}

export interface SpaceTerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
}

interface SpaceTerminalsState {
  [spaceId: string]: SpaceTerminalState;
}

const EMPTY_STATE: SpaceTerminalState = { tabs: [], activeTabId: null };

export function useSpaceTerminals() {
  const [stateBySpace, setStateBySpace] = useState<SpaceTerminalsState>({});

  const getSpaceState = useCallback(
    (spaceId: string): SpaceTerminalState => stateBySpace[spaceId] ?? EMPTY_STATE,
    [stateBySpace],
  );

  const setActiveTab = useCallback((spaceId: string, tabId: string | null) => {
    setStateBySpace((prev) => {
      const curr = prev[spaceId] ?? EMPTY_STATE;
      if (curr.activeTabId === tabId) return prev;
      return {
        ...prev,
        [spaceId]: {
          ...curr,
          activeTabId: tabId,
        },
      };
    });
  }, []);

  const createTerminal = useCallback(async (spaceId: string, cwd?: string) => {
    const result = await window.claude.terminal.create({
      cwd: cwd || undefined,
      cols: 80,
      rows: 24,
      spaceId,
    });
    const terminalId = result.terminalId;
    if (result.error || !terminalId) return;

    const tabId = crypto.randomUUID();
    setStateBySpace((prev) => {
      const curr = prev[spaceId] ?? EMPTY_STATE;
      const tab: TerminalTab = {
        id: tabId,
        terminalId,
        label: `Terminal ${curr.tabs.length + 1}`,
      };
      return {
        ...prev,
        [spaceId]: {
          tabs: [...curr.tabs, tab],
          activeTabId: tabId,
        },
      };
    });
  }, []);

  const closeTerminal = useCallback(async (spaceId: string, tabId: string) => {
    const spaceState = stateBySpace[spaceId];
    const tab = spaceState?.tabs.find((t) => t.id === tabId);
    if (tab) {
      await window.claude.terminal.destroy(tab.terminalId);
    }

    setStateBySpace((prev) => {
      const curr = prev[spaceId];
      if (!curr) return prev;
      const nextTabs = curr.tabs.filter((t) => t.id !== tabId);
      const nextActiveTabId = curr.activeTabId === tabId
        ? (nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].id : null)
        : curr.activeTabId;
      return {
        ...prev,
        [spaceId]: {
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
        },
      };
    });
  }, [stateBySpace]);

  const destroySpaceTerminals = useCallback(async (spaceId: string) => {
    await window.claude.terminal.destroySpace(spaceId);
    setStateBySpace((prev) => {
      if (!(spaceId in prev)) return prev;
      const next = { ...prev };
      delete next[spaceId];
      return next;
    });
  }, []);

  return {
    getSpaceState,
    setActiveTab,
    createTerminal,
    closeTerminal,
    destroySpaceTerminals,
  };
}
