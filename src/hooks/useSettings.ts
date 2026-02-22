import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolId } from "@/components/ToolPicker";
import type { AcpPermissionBehavior } from "@/types";

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

/** Normalize an array of ratios to sum to 1.0, respecting a per-element minimum. */
export function normalizeRatios(ratios: number[], count: number, min = 0.1): number[] {
  if (count <= 0) return [];
  if (count === 1) return [1];
  const equal = new Array<number>(count).fill(1 / count);
  // Stored ratios don't match current tool count — reset to equal
  if (ratios.length !== count) return equal;
  const clamped = ratios.map((r) => (Number.isFinite(r) ? Math.max(min, r) : min));
  const sum = clamped.reduce((a, b) => a + b, 0);
  // Guard against zero/NaN sum (shouldn't happen with min > 0, but be safe)
  if (!Number.isFinite(sum) || sum === 0) return equal;
  return clamped.map((r) => r / sum);
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

const DEFAULT_TOOL_ORDER: ToolId[] = ["terminal", "git", "browser", "files", "mcp", "changes"];

// ── Hook ──

export interface Settings {
  // Global
  permissionMode: string;
  setPermissionMode: (mode: string) => void;
  acpPermissionBehavior: AcpPermissionBehavior;
  setAcpPermissionBehavior: (b: AcpPermissionBehavior) => void;
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
  /** Per-tool fractional heights for the tools column (sum to 1.0) */
  toolsSplitRatios: number[];
  setToolsSplitRatios: (r: number[]) => void;
  saveToolsSplitRatios: () => void;
  /** Display order of panel tools in the tools column */
  toolOrder: ToolId[];
  setToolOrder: (updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => void;
  /** Vertical split ratio between Tasks and Agents in the right panel (0.2–0.8) */
  rightSplitRatio: number;
  setRightSplitRatio: (r: number) => void;
  saveRightSplitRatio: () => void;
  collapsedRepos: Set<string>;
  toggleRepoCollapsed: (path: string) => void;
  suppressedPanels: Set<ToolId>;
  suppressPanel: (id: ToolId) => void;
  unsuppressPanel: (id: ToolId) => void;
}

/** Read toolsSplitRatios, with migration from the old single-ratio key */
function readToolsSplitRatios(pid: string): number[] {
  const newKey = `openacpui-${pid}-tools-split-ratios`;
  const existing = readJson<number[]>(newKey, []);
  if (existing.length > 0) return existing;

  // Migrate from old single-ratio key
  const oldKey = `openacpui-${pid}-tools-split`;
  const oldRaw = localStorage.getItem(oldKey);
  if (oldRaw !== null) {
    const ratio = Number(oldRaw);
    if (Number.isFinite(ratio)) {
      const migrated = [Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, ratio)), 1 - Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, ratio))];
      localStorage.setItem(newKey, JSON.stringify(migrated));
      localStorage.removeItem(oldKey);
      return migrated;
    }
  }

  return []; // will be normalized to equal split by normalizeRatios()
}

/** Ensure toolOrder contains all known panel tools (filling in any missing ones) */
function readToolOrder(pid: string): ToolId[] {
  const stored = readJson<ToolId[]>(`openacpui-${pid}-tool-order`, []);
  if (stored.length === 0) return [...DEFAULT_TOOL_ORDER];
  // Ensure all default tools appear (append any missing ones)
  const set = new Set(stored);
  const result = [...stored];
  for (const id of DEFAULT_TOOL_ORDER) {
    if (!set.has(id)) result.push(id);
  }
  return result;
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

  const [acpPermissionBehavior, setAcpPermissionBehaviorRaw] = useState<AcpPermissionBehavior>(() =>
    (localStorage.getItem("openacpui-acp-permission-behavior") as AcpPermissionBehavior) ?? "ask",
  );
  const setAcpPermissionBehavior = useCallback((behavior: AcpPermissionBehavior) => {
    setAcpPermissionBehaviorRaw(behavior);
    localStorage.setItem("openacpui-acp-permission-behavior", behavior);
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

  // ── Tools split ratios (replaces old single toolsSplitRatio) ──

  const [toolsSplitRatios, setToolsSplitRatiosRaw] = useState<number[]>(() =>
    readToolsSplitRatios(pid),
  );
  const toolsSplitRatiosRef = useRef(toolsSplitRatios);
  toolsSplitRatiosRef.current = toolsSplitRatios;
  const setToolsSplitRatios = useCallback(
    (r: number[]) => {
      setToolsSplitRatiosRaw(r);
    },
    [],
  );
  const saveToolsSplitRatios = useCallback(() => {
    localStorage.setItem(`openacpui-${pid}-tools-split-ratios`, JSON.stringify(toolsSplitRatiosRef.current));
  }, [pid]);

  // ── Tool order (display order in the tools column) ──

  const [toolOrder, setToolOrderRaw] = useState<ToolId[]>(() => readToolOrder(pid));
  const setToolOrder = useCallback(
    (updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => {
      setToolOrderRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        localStorage.setItem(`openacpui-${pid}-tool-order`, JSON.stringify(next));
        return next;
      });
    },
    [pid],
  );

  // ── Right panel split (Tasks / Agents vertical ratio) ──

  const [rightSplitRatio, setRightSplitRatioRaw] = useState(() =>
    readNumber(`openacpui-${pid}-right-split`, DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT),
  );
  const rightSplitRatioRef = useRef(rightSplitRatio);
  rightSplitRatioRef.current = rightSplitRatio;
  const setRightSplitRatio = useCallback((r: number) => {
    setRightSplitRatioRaw(r);
  }, []);
  const saveRightSplitRatio = useCallback(() => {
    localStorage.setItem(`openacpui-${pid}-right-split`, String(rightSplitRatioRef.current));
  }, [pid]);

  // ── Collapsed repos ──

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

  // ── Suppressed panels ──

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
    setToolsSplitRatiosRaw(readToolsSplitRatios(pid));
    setToolOrderRaw(readToolOrder(pid));
    setRightSplitRatioRaw(
      readNumber(`openacpui-${pid}-right-split`, DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT),
    );

    const repos = readJson<string[]>(`openacpui-${pid}-collapsed-repos`, []);
    setCollapsedRepos(new Set(repos));

    const suppressed = readJson<ToolId[]>(`openacpui-${pid}-suppressed-panels`, []);
    setSuppressedPanels(new Set(suppressed));
  }, [pid]);

  return {
    permissionMode,
    setPermissionMode,
    acpPermissionBehavior,
    setAcpPermissionBehavior,
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
    toolsSplitRatios,
    setToolsSplitRatios,
    saveToolsSplitRatios,
    toolOrder,
    setToolOrder,
    rightSplitRatio,
    setRightSplitRatio,
    saveRightSplitRatio,
    collapsedRepos,
    toggleRepoCollapsed,
    suppressedPanels,
    suppressPanel,
    unsuppressPanel,
  };
}
