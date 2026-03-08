import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_SPACE_TERMINAL_STATE,
  parseStoredTerminalState,
  reconcileTerminalState,
  type SpaceTerminalState,
  type SpaceTerminalsState,
  type TerminalTab,
} from "@/lib/terminal-tabs";

export type { TerminalTab, SpaceTerminalState };

const STORAGE_KEY = "harnss-space-terminals";

export function useSpaceTerminals() {
  const [stateBySpace, setStateBySpace] = useState<SpaceTerminalsState>({});
  const [isReady, setIsReady] = useState(false);
  const stateBySpaceRef = useRef(stateBySpace);
  stateBySpaceRef.current = stateBySpace;
  const ensuringSpaceIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const persisted = parseStoredTerminalState(localStorage.getItem(STORAGE_KEY));
      try {
        const result = await window.claude.terminal.list();
        if (cancelled) return;
        const live = result.terminals ?? [];
        setStateBySpace(reconcileTerminalState(persisted, live));
      } catch {
        if (cancelled) return;
        setStateBySpace({});
      } finally {
        if (!cancelled) setIsReady(true);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isReady) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateBySpace));
  }, [isReady, stateBySpace]);

  const getSpaceState = useCallback(
    (spaceId: string): SpaceTerminalState => stateBySpace[spaceId] ?? EMPTY_SPACE_TERMINAL_STATE,
    [stateBySpace],
  );

  const setActiveTab = useCallback((spaceId: string, tabId: string | null) => {
    setStateBySpace((prev) => {
      const curr = prev[spaceId] ?? EMPTY_SPACE_TERMINAL_STATE;
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

    setStateBySpace((prev) => {
      const curr = prev[spaceId] ?? EMPTY_SPACE_TERMINAL_STATE;
      const existing = curr.tabs.find((tab) => tab.terminalId === terminalId);
      if (existing) {
        return {
          ...prev,
          [spaceId]: {
            ...curr,
            activeTabId: existing.id,
          },
        };
      }
      const tab: TerminalTab = {
        id: terminalId,
        terminalId,
        label: `Terminal ${curr.tabs.length + 1}`,
      };
      return {
        ...prev,
        [spaceId]: {
          tabs: [...curr.tabs, tab],
          activeTabId: tab.id,
        },
      };
    });
  }, []);

  const ensureTerminal = useCallback(async (spaceId: string, cwd?: string) => {
    if (!isReady) return;
    if ((stateBySpaceRef.current[spaceId]?.tabs.length ?? 0) > 0) return;
    if (ensuringSpaceIdsRef.current.has(spaceId)) return;

    ensuringSpaceIdsRef.current.add(spaceId);
    try {
      if ((stateBySpaceRef.current[spaceId]?.tabs.length ?? 0) === 0) {
        await createTerminal(spaceId, cwd);
      }
    } finally {
      ensuringSpaceIdsRef.current.delete(spaceId);
    }
  }, [createTerminal, isReady]);

  const closeTerminal = useCallback(async (spaceId: string, tabId: string) => {
    const spaceState = stateBySpaceRef.current[spaceId];
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
  }, []);

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
    isReady,
    createTerminal,
    ensureTerminal,
    closeTerminal,
    destroySpaceTerminals,
  };
}
