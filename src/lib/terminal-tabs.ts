export interface TerminalTab {
  id: string;
  terminalId: string;
  label: string;
}

export interface SpaceTerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
}

export interface SpaceTerminalsState {
  [spaceId: string]: SpaceTerminalState;
}

export interface LiveTerminalRecord {
  terminalId: string;
  spaceId: string;
  createdAt: number;
}

export const EMPTY_SPACE_TERMINAL_STATE: SpaceTerminalState = {
  tabs: [],
  activeTabId: null,
};

function isTerminalTab(value: unknown): value is TerminalTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Record<string, unknown>;
  return typeof tab.id === "string"
    && typeof tab.terminalId === "string"
    && typeof tab.label === "string";
}

export function parseStoredTerminalState(raw: string | null): SpaceTerminalsState {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const result: SpaceTerminalsState = {};
    for (const [spaceId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const space = value as Record<string, unknown>;
      const tabs = Array.isArray(space.tabs) ? space.tabs.filter(isTerminalTab) : [];
      const activeTabId = typeof space.activeTabId === "string" ? space.activeTabId : null;
      if (tabs.length === 0 && !activeTabId) continue;
      result[spaceId] = {
        tabs,
        activeTabId,
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function reconcileTerminalState(
  persisted: SpaceTerminalsState,
  liveTerminals: LiveTerminalRecord[],
): SpaceTerminalsState {
  const liveBySpace = new Map<string, LiveTerminalRecord[]>();
  for (const terminal of liveTerminals) {
    const list = liveBySpace.get(terminal.spaceId) ?? [];
    list.push(terminal);
    liveBySpace.set(terminal.spaceId, list);
  }

  const next: SpaceTerminalsState = {};
  const allSpaceIds = new Set([
    ...Object.keys(persisted),
    ...liveBySpace.keys(),
  ]);

  for (const spaceId of allSpaceIds) {
    const persistedSpace = persisted[spaceId] ?? EMPTY_SPACE_TERMINAL_STATE;
    const liveForSpace = [...(liveBySpace.get(spaceId) ?? [])].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    const liveIds = new Set(liveForSpace.map((terminal) => terminal.terminalId));

    const tabs = persistedSpace.tabs.filter((tab) => liveIds.has(tab.terminalId));
    const seenIds = new Set(tabs.map((tab) => tab.terminalId));

    for (const terminal of liveForSpace) {
      if (seenIds.has(terminal.terminalId)) continue;
      tabs.push({
        id: terminal.terminalId,
        terminalId: terminal.terminalId,
        label: `Terminal ${tabs.length + 1}`,
      });
    }

    if (tabs.length === 0) continue;

    const activeTabId = tabs.some((tab) => tab.id === persistedSpace.activeTabId)
      ? persistedSpace.activeTabId
      : tabs[tabs.length - 1].id;

    next[spaceId] = {
      tabs,
      activeTabId,
    };
  }

  return next;
}
