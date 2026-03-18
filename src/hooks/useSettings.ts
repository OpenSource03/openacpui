import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolId } from "@/components/ToolPicker";
import type { AcpPermissionBehavior, ClaudeEffort, EngineId, ThemeOption } from "@/types";

export type WorkspaceMode = "chat" | "code" | "both";

// ── Helpers ──

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // Validate shape matches fallback: if fallback is an array, parsed must also be an array
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    return parsed as T;
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
const MIN_WORKSPACE_SPLIT = 0.3;
const MAX_WORKSPACE_SPLIT = 0.7;
const DEFAULT_WORKSPACE_SPLIT = 0.56;
const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "both";

const DEFAULT_MODEL = "claude-opus-4-6";
const DEFAULT_PERMISSION_MODE = "default";
const DEFAULT_PLAN_MODE = true;
const DEFAULT_CLAUDE_EFFORT: ClaudeEffort = "high";
const DEFAULT_ENGINE_MODELS: Record<EngineId, string> = {
  claude: DEFAULT_MODEL,
  acp: "",
  codex: "",
  openclaw: "",
  group: "",
};

const MIN_BOTTOM_HEIGHT = 120;
const MAX_BOTTOM_HEIGHT = 600;
const DEFAULT_BOTTOM_HEIGHT = 250;

const DEFAULT_TOOL_ORDER: ToolId[] = ["terminal", "git", "browser", "project-files", "mcp", "groups"];
const VALID_TOOL_IDS = new Set<ToolId>([
  "terminal",
  "browser",
  "git",
  "files",
  "project-files",
  "tasks",
  "agents",
  "mcp",
  "groups",
]);

// ── Hook ──

export interface Settings {
  // Global
  theme: ThemeOption;
  setTheme: (t: ThemeOption) => void;
  islandLayout: boolean;
  setIslandLayout: (enabled: boolean) => void;
  transparency: boolean;
  setTransparency: (enabled: boolean) => void;
  planMode: boolean;
  setPlanMode: (enabled: boolean) => void;
  permissionMode: string;
  setPermissionMode: (mode: string) => void;
  acpPermissionBehavior: AcpPermissionBehavior;
  setAcpPermissionBehavior: (b: AcpPermissionBehavior) => void;
  thinking: boolean;
  setThinking: (on: boolean) => void;
  claudeEffort: ClaudeEffort;
  setClaudeEffort: (effort: ClaudeEffort) => void;
  autoGroupTools: boolean;
  setAutoGroupTools: (on: boolean) => void;
  avoidGroupingEdits: boolean;
  setAvoidGroupingEdits: (on: boolean) => void;
  autoExpandTools: boolean;
  setAutoExpandTools: (on: boolean) => void;
  transparentToolPicker: boolean;
  setTransparentToolPicker: (on: boolean) => void;
  coloredSidebarIcons: boolean;
  setColoredSidebarIcons: (on: boolean) => void;

  // Per-project
  model: string;
  setModel: (m: string) => void;
  getModelForEngine: (engine: EngineId) => string;
  setModelForEngine: (engine: EngineId, model: string) => void;
  gitCwd: string | null;
  setGitCwd: (path: string | null) => void;
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
  /** Tools placed in the bottom row instead of the right column */
  bottomTools: Set<ToolId>;
  moveToolToBottom: (id: ToolId) => void;
  moveToolToSide: (id: ToolId) => void;
  bottomToolsHeight: number;
  setBottomToolsHeight: (h: number) => void;
  saveBottomToolsHeight: () => void;
  bottomToolsSplitRatios: number[];
  setBottomToolsSplitRatios: (r: number[]) => void;
  saveBottomToolsSplitRatios: () => void;
  /** Whether split-chat mode is active (two chat panes side by side) */
  splitMode: boolean;
  setSplitMode: (on: boolean) => void;
  /** Fractional width of the left chat pane when split mode is active (0.2–0.8) */
  chatSplitRatio: number;
  setChatSplitRatio: (r: number) => void;
  saveChatSplitRatio: () => void;
  /** Working directory / worktree path for chat pane 1 (right pane) */
  pane1GitCwd: string | null;
  setPane1GitCwd: (path: string | null) => void;
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  /** Fractional width for chat in both mode (0.3–0.7) */
  workspaceSplitRatio: number;
  setWorkspaceSplitRatio: (r: number) => void;
}

/** Read toolsSplitRatios, with migration from the old single-ratio key */
function readToolsSplitRatios(pid: string): number[] {
  const newKey = `harnss-${pid}-tools-split-ratios`;
  const existing = readJson<number[]>(newKey, []);
  if (existing.length > 0) return existing;

  // Migrate from old single-ratio key
  const oldKey = `harnss-${pid}-tools-split`;
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
  const stored: ToolId[] = readJson<ToolId[]>(`harnss-${pid}-tool-order`, [])
    .filter((id) => VALID_TOOL_IDS.has(id))
    .filter((id) => id !== "files");
  if (stored.length === 0) return [...DEFAULT_TOOL_ORDER];
  // Ensure all default tools appear (append any missing ones)
  const set = new Set<ToolId>(stored);
  const result = [...stored];
  for (const id of DEFAULT_TOOL_ORDER) {
    if (!set.has(id)) result.push(id);
  }
  return result;
}

function engineModelKey(pid: string, engine: EngineId): string {
  return `harnss-${pid}-model-${engine}`;
}

function legacyModelKey(pid: string): string {
  return `harnss-${pid}-model`;
}

function isCodexLikeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return /^gpt[-\w.]*$/i.test(normalized) || /^o[0-9][\w.-]*$/i.test(normalized);
}

function readModelForEngine(pid: string, engine: EngineId): string {
  const byEngine = localStorage.getItem(engineModelKey(pid, engine));
  if (byEngine && byEngine.trim().length > 0) return byEngine.trim();

  const legacy = localStorage.getItem(legacyModelKey(pid));
  if (!legacy || legacy.trim().length === 0) return DEFAULT_ENGINE_MODELS[engine];
  const legacyValue = legacy.trim();

  if (engine === "claude") {
    // Never inherit GPT/o-series values into Claude.
    return isCodexLikeModel(legacyValue) ? DEFAULT_ENGINE_MODELS.claude : legacyValue;
  }
  if (engine === "codex") {
    // Migrate older shared key only when it clearly looks like a Codex/OpenAI model.
    return isCodexLikeModel(legacyValue) ? legacyValue : DEFAULT_ENGINE_MODELS.codex;
  }
  return DEFAULT_ENGINE_MODELS[engine];
}

function readEngineModels(pid: string): Record<EngineId, string> {
  return {
    claude: readModelForEngine(pid, "claude"),
    acp: readModelForEngine(pid, "acp"),
    codex: readModelForEngine(pid, "codex"),
    openclaw: readModelForEngine(pid, "openclaw"),
    group: "",
  };
}

interface ProjectLayoutState {
  rightPanelWidth: number;
  toolsPanelWidth: number;
  toolsSplitRatios: number[];
  rightSplitRatio: number;
  bottomToolsHeight: number;
  bottomToolsSplitRatios: number[];
}

const projectLayoutCache = new Map<string, ProjectLayoutState>();

function cloneProjectLayoutState(state: ProjectLayoutState): ProjectLayoutState {
  return {
    rightPanelWidth: state.rightPanelWidth,
    toolsPanelWidth: state.toolsPanelWidth,
    toolsSplitRatios: [...state.toolsSplitRatios],
    rightSplitRatio: state.rightSplitRatio,
    bottomToolsHeight: state.bottomToolsHeight,
    bottomToolsSplitRatios: [...state.bottomToolsSplitRatios],
  };
}

function readProjectLayoutState(pid: string): ProjectLayoutState {
  const cached = projectLayoutCache.get(pid);
  if (cached) return cloneProjectLayoutState(cached);

  const loaded: ProjectLayoutState = {
    rightPanelWidth: readNumber(`harnss-${pid}-right-panel-width`, DEFAULT_RIGHT_PANEL, MIN_RIGHT_PANEL, MAX_RIGHT_PANEL),
    toolsPanelWidth: readNumber(`harnss-${pid}-tools-panel-width`, DEFAULT_TOOLS_PANEL, MIN_TOOLS_PANEL, MAX_TOOLS_PANEL),
    toolsSplitRatios: readToolsSplitRatios(pid),
    rightSplitRatio: readNumber(`harnss-${pid}-right-split`, DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT),
    bottomToolsHeight: readNumber(`harnss-${pid}-bottom-tools-height`, DEFAULT_BOTTOM_HEIGHT, MIN_BOTTOM_HEIGHT, MAX_BOTTOM_HEIGHT),
    bottomToolsSplitRatios: readJson<number[]>(`harnss-${pid}-bottom-tools-split-ratios`, []),
  };
  projectLayoutCache.set(pid, loaded);
  return cloneProjectLayoutState(loaded);
}

function writeProjectLayoutState(pid: string, next: ProjectLayoutState): void {
  projectLayoutCache.set(pid, cloneProjectLayoutState(next));
}

export function useSettings(projectId: string | null, engine: EngineId = "claude"): Settings {
  const pid = projectId ?? "__none__";

  const normalizeToolIds = useCallback((items: ToolId[]) => {
    const next = new Set<ToolId>();
    for (const item of items) {
      if (!VALID_TOOL_IDS.has(item)) continue;
      next.add(item === "files" ? "project-files" : item);
    }
    return [...next];
  }, []);

  // ── Global settings ──

  const [theme, setThemeRaw] = useState<ThemeOption>(() => {
    const stored = localStorage.getItem("harnss-theme");
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    return "dark";
  });
  const setTheme = useCallback((t: ThemeOption) => {
    setThemeRaw(t);
    localStorage.setItem("harnss-theme", t);
  }, []);

  const [islandLayout, setIslandLayoutRaw] = useState(() =>
    readBool("harnss-island-layout", true),
  );
  const setIslandLayout = useCallback((enabled: boolean) => {
    setIslandLayoutRaw(enabled);
    localStorage.setItem("harnss-island-layout", String(enabled));
  }, []);

  const [transparency, setTransparencyRaw] = useState(() =>
    readBool("harnss-transparency", true),
  );
  const setTransparency = useCallback((enabled: boolean) => {
    setTransparencyRaw(enabled);
    localStorage.setItem("harnss-transparency", String(enabled));
  }, []);

  const [planMode, setPlanModeRaw] = useState(() => {
    const stored = localStorage.getItem("harnss-plan-mode");
    if (stored !== null) return stored === "true";
    // Legacy migration: old builds encoded plan in permissionMode.
    const legacyPermissionMode = localStorage.getItem("harnss-permission-mode");
    if (legacyPermissionMode === "plan") return true;
    return DEFAULT_PLAN_MODE;
  });
  const setPlanMode = useCallback((enabled: boolean) => {
    setPlanModeRaw(enabled);
    localStorage.setItem("harnss-plan-mode", String(enabled));
  }, []);

  const [permissionMode, setPermissionModeRaw] = useState(() =>
    (() => {
      const stored = localStorage.getItem("harnss-permission-mode");
      if (!stored || stored === "plan") return DEFAULT_PERMISSION_MODE;
      return stored;
    })(),
  );
  const setPermissionMode = useCallback((mode: string) => {
    // Legacy fallback: treat selecting "plan" as enabling the dedicated plan toggle.
    if (mode === "plan") {
      setPlanModeRaw(true);
      localStorage.setItem("harnss-plan-mode", "true");
      mode = DEFAULT_PERMISSION_MODE;
    }
    setPermissionModeRaw(mode);
    localStorage.setItem("harnss-permission-mode", mode);
  }, []);

  const [acpPermissionBehavior, setAcpPermissionBehaviorRaw] = useState<AcpPermissionBehavior>(() => {
    const stored = localStorage.getItem("harnss-acp-permission-behavior");
    const valid: AcpPermissionBehavior[] = ["ask", "auto_accept", "allow_all"];
    return stored && valid.includes(stored as AcpPermissionBehavior)
      ? (stored as AcpPermissionBehavior)
      : "ask";
  });
  const setAcpPermissionBehavior = useCallback((behavior: AcpPermissionBehavior) => {
    setAcpPermissionBehaviorRaw(behavior);
    localStorage.setItem("harnss-acp-permission-behavior", behavior);
  }, []);

  const [thinking, setThinkingRaw] = useState(() =>
    readBool("harnss-thinking", true),
  );
  const setThinking = useCallback((on: boolean) => {
    setThinkingRaw(on);
    localStorage.setItem("harnss-thinking", String(on));
  }, []);

  const [claudeEffort, setClaudeEffortRaw] = useState<ClaudeEffort>(() => {
    const stored = localStorage.getItem("harnss-claude-effort");
    return stored === "low" || stored === "medium" || stored === "high" || stored === "max"
      ? stored
      : DEFAULT_CLAUDE_EFFORT;
  });
  const setClaudeEffort = useCallback((effort: ClaudeEffort) => {
    setClaudeEffortRaw(effort);
    localStorage.setItem("harnss-claude-effort", effort);
  }, []);

  const [autoGroupTools, setAutoGroupToolsRaw] = useState(() =>
    readBool("harnss-auto-group-tools", true),
  );
  const setAutoGroupTools = useCallback((on: boolean) => {
    setAutoGroupToolsRaw(on);
    localStorage.setItem("harnss-auto-group-tools", String(on));
  }, []);

  const [avoidGroupingEdits, setAvoidGroupingEditsRaw] = useState(() =>
    readBool("harnss-avoid-grouping-edits", false),
  );
  const setAvoidGroupingEdits = useCallback((on: boolean) => {
    setAvoidGroupingEditsRaw(on);
    localStorage.setItem("harnss-avoid-grouping-edits", String(on));
  }, []);

  const [autoExpandTools, setAutoExpandToolsRaw] = useState(() =>
    readBool("harnss-auto-expand-tools", false),
  );
  const setAutoExpandTools = useCallback((on: boolean) => {
    setAutoExpandToolsRaw(on);
    localStorage.setItem("harnss-auto-expand-tools", String(on));
  }, []);

  const [transparentToolPicker, setTransparentToolPickerRaw] = useState(() =>
    readBool("harnss-transparent-tool-picker", false),
  );
  const setTransparentToolPicker = useCallback((on: boolean) => {
    setTransparentToolPickerRaw(on);
    localStorage.setItem("harnss-transparent-tool-picker", String(on));
  }, []);

  const [coloredSidebarIcons, setColoredSidebarIconsRaw] = useState(() =>
    readBool("harnss-colored-sidebar-icons", true),
  );
  const setColoredSidebarIcons = useCallback((on: boolean) => {
    setColoredSidebarIconsRaw(on);
    localStorage.setItem("harnss-colored-sidebar-icons", String(on));
  }, []);

  // ── Per-project settings ──

  const [modelsByEngine, setModelsByEngineRaw] = useState<Record<EngineId, string>>(() =>
    readEngineModels(pid),
  );
  const model = modelsByEngine[engine] ?? DEFAULT_ENGINE_MODELS[engine];
  const getModelForEngine = useCallback(
    (targetEngine: EngineId) => modelsByEngine[targetEngine] ?? DEFAULT_ENGINE_MODELS[targetEngine],
    [modelsByEngine],
  );
  const setModelForEngine = useCallback(
    (targetEngine: EngineId, nextModel: string) => {
      const normalized = nextModel.trim();
      if (!normalized) return;
      setModelsByEngineRaw((prev) => {
        if (prev[targetEngine] === normalized) return prev;
        localStorage.setItem(engineModelKey(pid, targetEngine), normalized);
        return { ...prev, [targetEngine]: normalized };
      });
    },
    [pid],
  );
  const setModel = useCallback(
    (nextModel: string) => {
      setModelForEngine(engine, nextModel);
    },
    [engine, setModelForEngine],
  );

  const [gitCwd, setGitCwdRaw] = useState<string | null>(() =>
    localStorage.getItem(`harnss-${pid}-git-cwd`),
  );
  const setGitCwd = useCallback(
    (nextPath: string | null) => {
      setGitCwdRaw(nextPath);
      const key = `harnss-${pid}-git-cwd`;
      if (nextPath && nextPath.trim()) localStorage.setItem(key, nextPath.trim());
      else localStorage.removeItem(key);
    },
    [pid],
  );

  const [activeTools, setActiveToolsRaw] = useState<Set<ToolId>>(() => {
    const arr = normalizeToolIds(readJson<ToolId[]>(`harnss-${pid}-active-tools`, []));
    return new Set<ToolId>(arr);
  });
  const setActiveTools = useCallback(
    (updater: Set<ToolId> | ((prev: Set<ToolId>) => Set<ToolId>)) => {
      setActiveToolsRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        localStorage.setItem(`harnss-${pid}-active-tools`, JSON.stringify([...next]));
        return next;
      });
    },
    [pid],
  );

  const [layoutState, setLayoutState] = useState(() => ({
    pid,
    values: readProjectLayoutState(pid),
  }));
  const currentLayout = layoutState.pid === pid ? layoutState.values : readProjectLayoutState(pid);

  useEffect(() => {
    if (layoutState.pid === pid) return;
    setLayoutState({ pid, values: currentLayout });
  }, [currentLayout, layoutState.pid, pid]);

  const rightPanelWidth = currentLayout.rightPanelWidth;
  const setRightPanelWidth = useCallback((width: number) => {
    setLayoutState((prev) => {
      const base = prev.pid === pid ? prev.values : readProjectLayoutState(pid);
      const next = { ...base, rightPanelWidth: width };
      writeProjectLayoutState(pid, next);
      return { pid, values: next };
    });
  }, [pid]);
  const rightPanelWidthRef = useRef(rightPanelWidth);
  rightPanelWidthRef.current = rightPanelWidth;
  const saveRightPanelWidth = useCallback(() => {
    writeProjectLayoutState(pid, { ...readProjectLayoutState(pid), rightPanelWidth: rightPanelWidthRef.current });
    localStorage.setItem(`harnss-${pid}-right-panel-width`, String(rightPanelWidthRef.current));
  }, [pid]);

  const toolsPanelWidth = currentLayout.toolsPanelWidth;
  const setToolsPanelWidth = useCallback((width: number) => {
    setLayoutState((prev) => {
      const base = prev.pid === pid ? prev.values : readProjectLayoutState(pid);
      const next = { ...base, toolsPanelWidth: width };
      writeProjectLayoutState(pid, next);
      return { pid, values: next };
    });
  }, [pid]);
  const toolsPanelWidthRef = useRef(toolsPanelWidth);
  toolsPanelWidthRef.current = toolsPanelWidth;
  const saveToolsPanelWidth = useCallback(() => {
    writeProjectLayoutState(pid, { ...readProjectLayoutState(pid), toolsPanelWidth: toolsPanelWidthRef.current });
    localStorage.setItem(`harnss-${pid}-tools-panel-width`, String(toolsPanelWidthRef.current));
  }, [pid]);

  // ── Tools split ratios (replaces old single toolsSplitRatio) ──

  const toolsSplitRatios = currentLayout.toolsSplitRatios;
  const toolsSplitRatiosRef = useRef(toolsSplitRatios);
  toolsSplitRatiosRef.current = toolsSplitRatios;
  const setToolsSplitRatios = useCallback((ratios: number[]) => {
    setLayoutState((prev) => {
      const base = prev.pid === pid ? prev.values : readProjectLayoutState(pid);
      const next = { ...base, toolsSplitRatios: [...ratios] };
      writeProjectLayoutState(pid, next);
      return { pid, values: next };
    });
  }, [pid]);
  const saveToolsSplitRatios = useCallback(() => {
    writeProjectLayoutState(pid, { ...readProjectLayoutState(pid), toolsSplitRatios: [...toolsSplitRatiosRef.current] });
    localStorage.setItem(`harnss-${pid}-tools-split-ratios`, JSON.stringify(toolsSplitRatiosRef.current));
  }, [pid]);

  // ── Tool order (display order in the tools column) ──

  const [toolOrder, setToolOrderRaw] = useState<ToolId[]>(() => readToolOrder(pid));
  const setToolOrder = useCallback(
    (updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => {
      setToolOrderRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        localStorage.setItem(`harnss-${pid}-tool-order`, JSON.stringify(next));
        return next;
      });
    },
    [pid],
  );

  // ── Right panel split (Tasks / Agents vertical ratio) ──

  const rightSplitRatio = currentLayout.rightSplitRatio;
  const rightSplitRatioRef = useRef(rightSplitRatio);
  rightSplitRatioRef.current = rightSplitRatio;
  const setRightSplitRatio = useCallback((r: number) => {
    setLayoutState((prev) => {
      const base = prev.pid === pid ? prev.values : readProjectLayoutState(pid);
      const next = { ...base, rightSplitRatio: r };
      writeProjectLayoutState(pid, next);
      return { pid, values: next };
    });
  }, [pid]);
  const saveRightSplitRatio = useCallback(() => {
    writeProjectLayoutState(pid, { ...readProjectLayoutState(pid), rightSplitRatio: rightSplitRatioRef.current });
    localStorage.setItem(`harnss-${pid}-right-split`, String(rightSplitRatioRef.current));
  }, [pid]);

  // ── Collapsed repos ──

  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(() => {
    const arr = readJson<string[]>(`harnss-${pid}-collapsed-repos`, []);
    return new Set(arr);
  });
  const toggleRepoCollapsed = useCallback(
    (path: string) => {
      setCollapsedRepos((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        localStorage.setItem(`harnss-${pid}-collapsed-repos`, JSON.stringify([...next]));
        return next;
      });
    },
    [pid],
  );

  // ── Suppressed panels ──

  const [suppressedPanels, setSuppressedPanels] = useState<Set<ToolId>>(() => {
    const arr = readJson<ToolId[]>(`harnss-${pid}-suppressed-panels`, []);
    return new Set(arr);
  });
  const suppressPanel = useCallback(
    (id: ToolId) => {
      setSuppressedPanels((prev) => {
        const next = new Set(prev);
        next.add(id);
        localStorage.setItem(`harnss-${pid}-suppressed-panels`, JSON.stringify([...next]));
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
        localStorage.setItem(`harnss-${pid}-suppressed-panels`, JSON.stringify([...next]));
        return next;
      });
    },
    [pid],
  );

  // ── Bottom tools placement ──

  const [bottomTools, setBottomToolsRaw] = useState<Set<ToolId>>(() => {
    const arr = normalizeToolIds(readJson<ToolId[]>(`harnss-${pid}-bottom-tools`, []));
    return new Set<ToolId>(arr);
  });
  const moveToolToBottom = useCallback(
    (id: ToolId) => {
      setBottomToolsRaw((prev) => {
        const next = new Set(prev);
        next.add(id);
        localStorage.setItem(`harnss-${pid}-bottom-tools`, JSON.stringify([...next]));
        return next;
      });
    },
    [pid],
  );
  const moveToolToSide = useCallback(
    (id: ToolId) => {
      setBottomToolsRaw((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        localStorage.setItem(`harnss-${pid}-bottom-tools`, JSON.stringify([...next]));
        return next;
      });
    },
    [pid],
  );

  const bottomToolsHeight = currentLayout.bottomToolsHeight;
  const setBottomToolsHeight = useCallback((height: number) => {
    setLayoutState((prev) => {
      const base = prev.pid === pid ? prev.values : readProjectLayoutState(pid);
      const next = { ...base, bottomToolsHeight: height };
      writeProjectLayoutState(pid, next);
      return { pid, values: next };
    });
  }, [pid]);
  const bottomToolsHeightRef = useRef(bottomToolsHeight);
  bottomToolsHeightRef.current = bottomToolsHeight;
  const saveBottomToolsHeight = useCallback(() => {
    writeProjectLayoutState(pid, { ...readProjectLayoutState(pid), bottomToolsHeight: bottomToolsHeightRef.current });
    localStorage.setItem(`harnss-${pid}-bottom-tools-height`, String(bottomToolsHeightRef.current));
  }, [pid]);

  const bottomToolsSplitRatios = currentLayout.bottomToolsSplitRatios;
  const bottomToolsSplitRatiosRef = useRef(bottomToolsSplitRatios);
  bottomToolsSplitRatiosRef.current = bottomToolsSplitRatios;
  const setBottomToolsSplitRatios = useCallback((ratios: number[]) => {
    setLayoutState((prev) => {
      const base = prev.pid === pid ? prev.values : readProjectLayoutState(pid);
      const next = { ...base, bottomToolsSplitRatios: [...ratios] };
      writeProjectLayoutState(pid, next);
      return { pid, values: next };
    });
  }, [pid]);
  const saveBottomToolsSplitRatios = useCallback(() => {
    writeProjectLayoutState(pid, { ...readProjectLayoutState(pid), bottomToolsSplitRatios: [...bottomToolsSplitRatiosRef.current] });
    localStorage.setItem(`harnss-${pid}-bottom-tools-split-ratios`, JSON.stringify(bottomToolsSplitRatiosRef.current));
  }, [pid]);

  // ── Split chat settings ──

  const [splitMode, setSplitModeRaw] = useState(() =>
    readBool(`harnss-${pid}-split-mode`, false),
  );
  const setSplitMode = useCallback(
    (on: boolean) => {
      setSplitModeRaw(on);
      localStorage.setItem(`harnss-${pid}-split-mode`, String(on));
    },
    [pid],
  );

  const [chatSplitRatio, setChatSplitRatioRaw] = useState(() =>
    readNumber(`harnss-${pid}-chat-split-ratio`, DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT),
  );
  const setChatSplitRatio = useCallback(
    (r: number) => {
      const clamped = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, r));
      setChatSplitRatioRaw(clamped);
    },
    [],
  );
  const chatSplitRatioRef = useRef(chatSplitRatio);
  chatSplitRatioRef.current = chatSplitRatio;
  const saveChatSplitRatio = useCallback(() => {
    localStorage.setItem(`harnss-${pid}-chat-split-ratio`, String(chatSplitRatioRef.current));
  }, [pid]);

  const [pane1GitCwd, setPane1GitCwdRaw] = useState<string | null>(() =>
    localStorage.getItem(`harnss-${pid}-pane1-git-cwd`),
  );
  const setPane1GitCwd = useCallback(
    (nextPath: string | null) => {
      setPane1GitCwdRaw(nextPath);
      const key = `harnss-${pid}-pane1-git-cwd`;
      if (nextPath && nextPath.trim()) localStorage.setItem(key, nextPath.trim());
      else localStorage.removeItem(key);
    },
    [pid],
  );

  const [workspaceMode, setWorkspaceModeRaw] = useState<WorkspaceMode>(() => {
    const stored = localStorage.getItem(`harnss-${pid}-workspace-mode`);
    if (stored === "chat" || stored === "code" || stored === "both") return stored;
    return DEFAULT_WORKSPACE_MODE;
  });
  const setWorkspaceMode = useCallback(
    (mode: WorkspaceMode) => {
      setWorkspaceModeRaw(mode);
      localStorage.setItem(`harnss-${pid}-workspace-mode`, mode);
    },
    [pid],
  );

  const [workspaceSplitRatio, setWorkspaceSplitRatioRaw] = useState(() =>
    readNumber(
      `harnss-${pid}-workspace-split-ratio`,
      DEFAULT_WORKSPACE_SPLIT,
      MIN_WORKSPACE_SPLIT,
      MAX_WORKSPACE_SPLIT,
    ),
  );
  const setWorkspaceSplitRatio = useCallback(
    (r: number) => {
      const clamped = Math.max(MIN_WORKSPACE_SPLIT, Math.min(MAX_WORKSPACE_SPLIT, r));
      setWorkspaceSplitRatioRaw(clamped);
      localStorage.setItem(`harnss-${pid}-workspace-split-ratio`, String(clamped));
    },
    [pid],
  );

  // ── Re-read per-project values when projectId changes ──

  useEffect(() => {
    setModelsByEngineRaw(readEngineModels(pid));
    setGitCwdRaw(localStorage.getItem(`harnss-${pid}-git-cwd`));

    const tools = normalizeToolIds(readJson<ToolId[]>(`harnss-${pid}-active-tools`, []));
    setActiveToolsRaw(new Set<ToolId>(tools));
    setToolOrderRaw(readToolOrder(pid));

    const repos = readJson<string[]>(`harnss-${pid}-collapsed-repos`, []);
    setCollapsedRepos(new Set(repos));

    const suppressed = readJson<ToolId[]>(`harnss-${pid}-suppressed-panels`, []);
    setSuppressedPanels(new Set(suppressed));

    const bottom = normalizeToolIds(readJson<ToolId[]>(`harnss-${pid}-bottom-tools`, []));
    setBottomToolsRaw(new Set<ToolId>(bottom));

    setSplitModeRaw(readBool(`harnss-${pid}-split-mode`, false));
    setChatSplitRatioRaw(readNumber(`harnss-${pid}-chat-split-ratio`, DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT));
    setPane1GitCwdRaw(localStorage.getItem(`harnss-${pid}-pane1-git-cwd`));
    const nextWorkspaceMode = localStorage.getItem(`harnss-${pid}-workspace-mode`);
    if (nextWorkspaceMode === "chat" || nextWorkspaceMode === "code" || nextWorkspaceMode === "both") {
      setWorkspaceModeRaw(nextWorkspaceMode);
    } else {
      setWorkspaceModeRaw(DEFAULT_WORKSPACE_MODE);
    }
    setWorkspaceSplitRatioRaw(
      readNumber(
        `harnss-${pid}-workspace-split-ratio`,
        DEFAULT_WORKSPACE_SPLIT,
        MIN_WORKSPACE_SPLIT,
        MAX_WORKSPACE_SPLIT,
      ),
    );
  }, [normalizeToolIds, pid]);

  return {
    theme,
    setTheme,
    islandLayout,
    setIslandLayout,
    transparency,
    setTransparency,
    planMode,
    setPlanMode,
    permissionMode,
    setPermissionMode,
    acpPermissionBehavior,
    setAcpPermissionBehavior,
    thinking,
    setThinking,
    claudeEffort,
    setClaudeEffort,
    autoGroupTools,
    setAutoGroupTools,
    avoidGroupingEdits,
    setAvoidGroupingEdits,
    autoExpandTools,
    setAutoExpandTools,
    transparentToolPicker,
    setTransparentToolPicker,
    coloredSidebarIcons,
    setColoredSidebarIcons,
    model,
    setModel,
    getModelForEngine,
    setModelForEngine,
    gitCwd,
    setGitCwd,
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
    bottomTools,
    moveToolToBottom,
    moveToolToSide,
    bottomToolsHeight,
    setBottomToolsHeight,
    saveBottomToolsHeight,
    bottomToolsSplitRatios,
    setBottomToolsSplitRatios,
    saveBottomToolsSplitRatios,
    splitMode,
    setSplitMode,
    chatSplitRatio,
    setChatSplitRatio,
    saveChatSplitRatio,
    pane1GitCwd,
    setPane1GitCwd,
    workspaceMode,
    setWorkspaceMode,
    workspaceSplitRatio,
    setWorkspaceSplitRatio,
  };
}
