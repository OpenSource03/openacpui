export interface TerminalTab {
  id: string;
  terminalId: string;
  label: string;
}

export interface SessionTerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
}

export interface SessionTerminalsState {
  [sessionId: string]: SessionTerminalState;
}

export interface LiveTerminalRecord {
  terminalId: string;
  sessionId: string;
  createdAt: number;
}

export const EMPTY_SESSION_TERMINAL_STATE: SessionTerminalState = {
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

export function parseStoredTerminalState(raw: string | null): SessionTerminalsState {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const result: SessionTerminalsState = {};
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const session = value as Record<string, unknown>;
      const tabs = Array.isArray(session.tabs) ? session.tabs.filter(isTerminalTab) : [];
      const activeTabId = typeof session.activeTabId === "string" ? session.activeTabId : null;
      if (tabs.length === 0 && !activeTabId) continue;
      result[sessionId] = {
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
  persisted: SessionTerminalsState,
  liveTerminals: LiveTerminalRecord[],
): SessionTerminalsState {
  const liveBySession = new Map<string, LiveTerminalRecord[]>();
  for (const terminal of liveTerminals) {
    const list = liveBySession.get(terminal.sessionId) ?? [];
    list.push(terminal);
    liveBySession.set(terminal.sessionId, list);
  }

  const next: SessionTerminalsState = {};
  const allSessionIds = new Set([
    ...Object.keys(persisted),
    ...liveBySession.keys(),
  ]);

  for (const sessionId of allSessionIds) {
    const persistedSession = persisted[sessionId] ?? EMPTY_SESSION_TERMINAL_STATE;
    const liveForSession = [...(liveBySession.get(sessionId) ?? [])].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    const liveIds = new Set(liveForSession.map((terminal) => terminal.terminalId));

    const tabs = persistedSession.tabs.filter((tab) => liveIds.has(tab.terminalId));
    const seenIds = new Set(tabs.map((tab) => tab.terminalId));

    for (const terminal of liveForSession) {
      if (seenIds.has(terminal.terminalId)) continue;
      tabs.push({
        id: terminal.terminalId,
        terminalId: terminal.terminalId,
        label: `Terminal ${tabs.length + 1}`,
      });
    }

    if (tabs.length === 0) continue;

    const activeTabId = tabs.some((tab) => tab.id === persistedSession.activeTabId)
      ? persistedSession.activeTabId
      : tabs[tabs.length - 1].id;

    next[sessionId] = {
      tabs,
      activeTabId,
    };
  }

  return next;
}
