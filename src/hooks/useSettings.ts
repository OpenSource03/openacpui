import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolId } from "@/components/ToolPicker";

// ── Helpers ──

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readNumber(key: string, fallback: number, min: number, max: number): number {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "true";
}

// ── Constants ──

const MIN_RIGHT_PANEL = 200;
const MAX_RIGHT_PANEL = 500;
const DEFAULT_RIGHT_PANEL = 288;

const MIN_TOOLS_PANEL = 280;
const MAX_TOOLS_PANEL = 800;
const DEFAULT_TOOLS_PANEL = 420;

const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;
const DEFAULT_SPLIT = 0.5;

const DEFAULT_MODEL = "claude-opus-4-6";
const DEFAULT_PERMISSION_MODE = "plan";

// ── Hook ──

export interface Settings {
  // Global
  permissionMode: string;
  setPermissionMode: (mode: string) => void;
  thinking: boolean;
  setThinking: (on: boolean) => void;

  // Per-project
  model: string;
  setModel: (m: string) => void;
  activeTools: Set<ToolId>;
  setActiveTools: (updater: Set<ToolId> | ((prev: Set<ToolId>) => Set<ToolId>)) => void;
  rightPanelWidth: number;
  setRightPanelWidth: (w: number) => void;
  saveRightPanelWidth: () => void;
  toolsPanelWidth: number;
  setToolsPanelWidth: (w: number) => void;
  saveToolsPanelWidth: () => void;
  toolsSplitRatio: number;
  setToolsSplitRatio: (r: number) => void;
  saveToolsSplitRatio: () => void;
  collapsedRepos: Set<string>;
  toggleRepoCollapsed: (path: string) => void;
  suppressedPanels: Set<ToolId>;
  suppressPanel: (id: ToolId) => void;
  unsuppressPanel: (id: ToolId) => void;
}

export function useSettings(projectId: string | null): Settings {
  const pid = projectId ?? "__none__";

  // ── Global settings ──

  const [permissionMode, setPermissionModeRaw] = useState(() =>
    localStorage.getItem("openacpui-permission-mode") ?? DEFAULT_PERMISSION_MODE,
  );
  const setPermissionMode = useCallback((mode: string) => {
    setPermissionModeRaw(mode);
    localStorage.setItem("openacpui-permission-mode", mode);
  }, []);

  const [thinking, setThinkingRaw] = useState(() =>
    readBool("openacpui-thinking", true),
  );
  const setThinking = useCallback((on: boolean) => {
    setThinkingRaw(on);
    localStorage.setItem("openacpui-thinking", String(on));
  }, []);

  // ── Per-project settings ──

  const [model, setModelRaw] = useState(() =>
    localStorage.getItem(`openacpui-${pid}-model`) ?? DEFAULT_MODEL,
  );
  const setModel = useCallback(
    (m: string) => {
      setModelRaw(m);
      localStorage.setItem(`openacpui-${pid}-model`, m);
    },
    [pid],
  );

  const [activeTools, setActiveToolsRaw] = useState<Set<ToolId>>(() => {
    const arr = readJson<ToolId[]>(`openacpui-${pid}-active-tools`, []);
    return new Set(arr);
  });
  const setActiveTools = useCallback(
    (updater: Set<ToolId> | ((prev: Set<ToolId>) => Set<ToolId>)) => {
      setActiveToolsRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        localStorage.setItem(`openacpui-${pid}-active-tools`, JSON.stringify([...next]));
        return next;
      });
    },
    [pid],
  );

  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    readNumber(`openacpui-${pid}-right-panel-width`, DEFAULT_RIGHT_PANEL, MIN_RIGHT_PANEL, MAX_RIGHT_PANEL),
  );
  const rightPanelWidthRef = useRef(rightPanelWidth);
  rightPanelWidthRef.current = rightPanelWidth;
  const saveRightPanelWidth = useCallback(() => {
    localStorage.setItem(`openacpui-${pid}-right-panel-width`, String(rightPanelWidthRef.current));
  }, [pid]);

  const [toolsPanelWidth, setToolsPanelWidth] = useState(() =>
    readNumber(`openacpui-${pid}-tools-panel-width`, DEFAULT_TOOLS_PANEL, MIN_TOOLS_PANEL, MAX_TOOLS_PANEL),
  );
  const toolsPanelWidthRef = useRef(toolsPanelWidth);
  toolsPanelWidthRef.current = toolsPanelWidth;
  const saveToolsPanelWidth = useCallback(() => {
    localStorage.setItem(`openacpui-${pid}-tools-panel-width`, String(toolsPanelWidthRef.current));
  }, [pid]);

  const [toolsSplitRatio, setToolsSplitRatio] = useState(() =>
    readNumber(`openacpui-${pid}-tools-split`, DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT),
  );
  const toolsSplitRef = useRef(toolsSplitRatio);
  toolsSplitRef.current = toolsSplitRatio;
  const saveToolsSplitRatio = useCallback(() => {
    localStorage.setItem(`openacpui-${pid}-tools-split`, String(toolsSplitRef.current));
  }, [pid]);

  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(() => {
    const arr = readJson<string[]>(`openacpui-${pid}-collapsed-repos`, []);
    return new Set(arr);
  });
  const toggleRepoCollapsed = useCallback(
    (path: string) => {
      setCollapsedRepos((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        localStorage.setItem(`openacpui-${pid}-collapsed-repos`, JSON.stringify([...next]));
        return next;
      });
    },
    [pid],
  );

  const [suppressedPanels, setSuppressedPanels] = useState<Set<ToolId>>(() => {
    const arr = readJson<ToolId[]>(`openacpui-${pid}-suppressed-panels`, []);
    return new Set(arr);
  });
  const suppressPanel = useCallback(
    (id: ToolId) => {
      setSuppressedPanels((prev) => {
        const next = new Set(prev);
        next.add(id);
        localStorage.setItem(`openacpui-${pid}-suppressed-panels`, JSON.stringify([...next]));
        return next;
      });
    },
    [pid],
  );
  const unsuppressPanel = useCallback(
    (id: ToolId) => {
      setSuppressedPanels((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        localStorage.setItem(`openacpui-${pid}-suppressed-panels`, JSON.stringify([...next]));
        return next;
      });
    },
    [pid],
  );

  // ── Re-read per-project values when projectId changes ──

  useEffect(() => {
    setModelRaw(localStorage.getItem(`openacpui-${pid}-model`) ?? DEFAULT_MODEL);

    const tools = readJson<ToolId[]>(`openacpui-${pid}-active-tools`, []);
    setActiveToolsRaw(new Set(tools));

    setRightPanelWidth(
      readNumber(`openacpui-${pid}-right-panel-width`, DEFAULT_RIGHT_PANEL, MIN_RIGHT_PANEL, MAX_RIGHT_PANEL),
    );
    setToolsPanelWidth(
      readNumber(`openacpui-${pid}-tools-panel-width`, DEFAULT_TOOLS_PANEL, MIN_TOOLS_PANEL, MAX_TOOLS_PANEL),
    );
    setToolsSplitRatio(
      readNumber(`openacpui-${pid}-tools-split`, DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT),
    );

    const repos = readJson<string[]>(`openacpui-${pid}-collapsed-repos`, []);
    setCollapsedRepos(new Set(repos));

    const suppressed = readJson<ToolId[]>(`openacpui-${pid}-suppressed-panels`, []);
    setSuppressedPanels(new Set(suppressed));
  }, [pid]);

  return {
    permissionMode,
    setPermissionMode,
    thinking,
    setThinking,
    model,
    setModel,
    activeTools,
    setActiveTools,
    rightPanelWidth,
    setRightPanelWidth,
    saveRightPanelWidth,
    toolsPanelWidth,
    setToolsPanelWidth,
    saveToolsPanelWidth,
    toolsSplitRatio,
    setToolsSplitRatio,
    saveToolsSplitRatio,
    collapsedRepos,
    toggleRepoCollapsed,
    suppressedPanels,
    suppressPanel,
    unsuppressPanel,
  };
}
