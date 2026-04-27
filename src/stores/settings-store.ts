import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ToolId } from "@/types/tools";
import type { AcpPermissionBehavior, ClaudeEffort, EngineId, MacBackgroundEffect, ThemeOption } from "@/types";

// ── Constants ──

const DEFAULT_MODEL = "default";
const DEFAULT_PERMISSION_MODE = "default";
const DEFAULT_PLAN_MODE = true;
const DEFAULT_CLAUDE_EFFORT: ClaudeEffort = "high";
export const DEFAULT_ENGINE_MODELS: Record<EngineId, string> = {
  claude: DEFAULT_MODEL,
  acp: "",
  codex: "",
  // CLI engine forwards the chosen model via the `--model` flag at spawn
  // time; empty string means "let CLI use its own default" (same idiom as
  // ACP / Codex).
  cli: "",
};

const MIN_RIGHT_PANEL = 200;
const MAX_RIGHT_PANEL = 500;
const DEFAULT_RIGHT_PANEL = 288;

const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;
const DEFAULT_SPLIT = 0.5;

const MIN_BOTTOM_HEIGHT = 120;
const MAX_BOTTOM_HEIGHT = 600;
const DEFAULT_BOTTOM_HEIGHT = 250;

const DEFAULT_TOOL_ORDER: ToolId[] = ["terminal", "git", "browser", "files", "project-files", "mcp"];
const VALID_TOOL_IDS = new Set<ToolId>([
  "terminal",
  "browser",
  "git",
  "files",
  "project-files",
  "tasks",
  "agents",
  "mcp",
]);

const IS_MAC_PLATFORM = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

const STORE_KEY = "harnss-settings-store";
/**
 * Mirror of session/types.ts DRAFT_ID. Duplicated here to avoid a circular import
 * (settings-store has no other dependency on session code).
 */
const DRAFT_SESSION_ID = "__draft__";

// ── Shared helpers (also used by compat hook) ──

/** Normalize an array of ratios to sum to 1.0, respecting a per-element minimum. */
export function normalizeRatios(ratios: number[], count: number, min = 0.1): number[] {
  if (count <= 0) return [];
  if (count === 1) return [1];
  const equal = new Array<number>(count).fill(1 / count);
  if (ratios.length !== count) return equal;
  const clamped = ratios.map((r) => (Number.isFinite(r) ? Math.max(min, r) : min));
  const sum = clamped.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum === 0) return equal;
  return clamped.map((r) => r / sum);
}

// ── Types ──

/** Per-project settings keyed by projectId */
export interface ProjectSettings {
  /** Per-engine model selections (claude, acp, codex) */
  modelsByEngine: Record<EngineId, string>;
  /** Git working directory override */
  gitCwd: string | null;
  /** Active tool panels (serialized as array for persistence, exposed as Set) */
  activeTools: ToolId[];
  /** Display order of panel tools in the tools column */
  toolOrder: ToolId[];
  /** Right panel width in pixels */
  rightPanelWidth: number;
  /** Vertical split ratio between Tasks and Agents in the right panel (0.2-0.8) */
  rightSplitRatio: number;
  /** Collapsed repo paths in git panel */
  collapsedRepos: string[];
  /** Suppressed (auto-hidden) panel IDs */
  suppressedPanels: ToolId[];
  /** Tools placed in the bottom row instead of the right column */
  bottomTools: ToolId[];
  /** Bottom tools row height in pixels */
  bottomToolsHeight: number;
  /** Split ratios for bottom tools when multiple are active */
  bottomToolsSplitRatios: number[];
  /** Whether to group sidebar chats by git branch */
  organizeByChatBranch: boolean;
}

/**
 * Per-session tool panel settings. Subset of ProjectSettings that should
 * follow the current session, not the project. Sessions are materialized
 * lazily: a session entry only exists in the `sessions` map once the user
 * modifies any of its tool settings; before that, reads fall back to the
 * owning project's settings.
 */
export interface SessionScopedSettings {
  activeTools: ToolId[];
  toolOrder: ToolId[];
  rightPanelWidth: number;
  rightSplitRatio: number;
  suppressedPanels: ToolId[];
  bottomTools: ToolId[];
  bottomToolsHeight: number;
  bottomToolsSplitRatios: number[];
}

/** Global settings state (not per-project) */
interface GlobalSettingsState {
  theme: ThemeOption;
  islandLayout: boolean;
  islandShine: boolean;
  /** The native macOS background material (liquid-glass or vibrancy) — never "off" */
  macNativeBackgroundEffect: Exclude<MacBackgroundEffect, "off">;
  /** Whether transparency is enabled (combines with macNativeBackgroundEffect to derive macBackgroundEffect) */
  transparency: boolean;
  planMode: boolean;
  permissionMode: string;
  acpPermissionBehavior: AcpPermissionBehavior;
  thinking: boolean;
  claudeEffort: ClaudeEffort;
  autoGroupTools: boolean;
  avoidGroupingEdits: boolean;
  autoExpandTools: boolean;
  expandEditToolCallsByDefault: boolean;
  transparentToolPicker: boolean;
  coloredSidebarIcons: boolean;
  showToolIcons: boolean;
  coloredToolIcons: boolean;
}

/** Actions (setters) — excluded from persistence via partialize */
interface SettingsActions {
  // Global setters
  setTheme: (t: ThemeOption) => void;
  setIslandLayout: (enabled: boolean) => void;
  setIslandShine: (enabled: boolean) => void;
  setMacBackgroundEffect: (effect: MacBackgroundEffect) => void;
  setTransparency: (enabled: boolean) => void;
  setPlanMode: (enabled: boolean) => void;
  setPermissionMode: (mode: string) => void;
  setAcpPermissionBehavior: (b: AcpPermissionBehavior) => void;
  setThinking: (on: boolean) => void;
  setClaudeEffort: (effort: ClaudeEffort) => void;
  setAutoGroupTools: (on: boolean) => void;
  setAvoidGroupingEdits: (on: boolean) => void;
  setAutoExpandTools: (on: boolean) => void;
  setExpandEditToolCallsByDefault: (on: boolean) => void;
  setTransparentToolPicker: (on: boolean) => void;
  setColoredSidebarIcons: (on: boolean) => void;
  setShowToolIcons: (on: boolean) => void;
  setColoredToolIcons: (on: boolean) => void;

  // Per-project setters (all take projectId as first arg)
  setModelForEngine: (projectId: string, engine: EngineId, model: string) => void;
  setGitCwd: (projectId: string, path: string | null) => void;
  setActiveTools: (projectId: string, updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => void;
  setToolOrder: (projectId: string, updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => void;
  setRightPanelWidth: (projectId: string, width: number) => void;
  setRightSplitRatio: (projectId: string, ratio: number) => void;
  setCollapsedRepos: (projectId: string, updater: string[] | ((prev: string[]) => string[])) => void;
  toggleRepoCollapsed: (projectId: string, path: string) => void;
  setSuppressedPanels: (projectId: string, updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => void;
  suppressPanel: (projectId: string, id: ToolId) => void;
  unsuppressPanel: (projectId: string, id: ToolId) => void;
  setBottomTools: (projectId: string, updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => void;
  setBottomToolsHeight: (projectId: string, height: number) => void;
  setBottomToolsSplitRatios: (projectId: string, ratios: number[]) => void;
  setOrganizeByChatBranch: (projectId: string, on: boolean) => void;

  // ── Per-session setters (tool panel state scoped to the active session) ──
  // All take (sessionId, projectId) so the store can materialize a session
  // entry from project defaults on first write.
  setSessionActiveTools: (sessionId: string, projectId: string, updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => void;
  setSessionToolOrder: (sessionId: string, projectId: string, updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => void;
  setSessionRightPanelWidth: (sessionId: string, projectId: string, width: number) => void;
  setSessionRightSplitRatio: (sessionId: string, projectId: string, ratio: number) => void;
  setSessionSuppressedPanels: (sessionId: string, projectId: string, updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => void;
  suppressSessionPanel: (sessionId: string, projectId: string, id: ToolId) => void;
  unsuppressSessionPanel: (sessionId: string, projectId: string, id: ToolId) => void;
  setSessionBottomTools: (sessionId: string, projectId: string, updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => void;
  setSessionBottomToolsHeight: (sessionId: string, projectId: string, height: number) => void;
  setSessionBottomToolsSplitRatios: (sessionId: string, projectId: string, ratios: number[]) => void;
  /** Remove all session-scoped settings for a session. Called on session delete. */
  clearSessionSettings: (sessionId: string) => void;
  /** Move session-scoped settings from one id to another. Called on draft→real materialization. */
  remapSessionSettings: (fromId: string, toId: string) => void;
}

export interface SettingsStore extends GlobalSettingsState, SettingsActions {
  /** Per-project settings map, keyed by projectId (or "__none__" for no project) */
  projects: Record<string, ProjectSettings>;
  /**
   * Per-session tool panel settings, keyed by sessionId. Only contains entries
   * for sessions the user has explicitly customized. Missing entries resolve
   * via project fallback (see `selectSessionScopedSettings`).
   */
  sessions: Record<string, SessionScopedSettings>;
}

// ── Default project settings ──

/**
 * Stable module-level default — same reference every call.
 * CRITICAL: Zustand selectors return this for projects with no stored settings.
 * If this were a fresh object each time, useShallow would see "changed" references
 * for the array/object fields and trigger an infinite re-render loop.
 */
const DEFAULT_PROJECT_SETTINGS: ProjectSettings = Object.freeze({
  modelsByEngine: DEFAULT_ENGINE_MODELS,
  gitCwd: null,
  activeTools: [] as ToolId[],
  toolOrder: DEFAULT_TOOL_ORDER,
  rightPanelWidth: DEFAULT_RIGHT_PANEL,
  rightSplitRatio: DEFAULT_SPLIT,
  collapsedRepos: [] as string[],
  suppressedPanels: [] as ToolId[],
  bottomTools: [] as ToolId[],
  bottomToolsHeight: DEFAULT_BOTTOM_HEIGHT,
  bottomToolsSplitRatios: [] as number[],
  organizeByChatBranch: false,
});

/** Get project settings. Returns stable DEFAULT_PROJECT_SETTINGS reference when no project exists. */
function getProjectSettings(projects: Record<string, ProjectSettings>, projectId: string): ProjectSettings {
  const existing = projects[projectId];
  if (!existing) return DEFAULT_PROJECT_SETTINGS;
  return existing;
}

/** Immutably update a single project's settings */
function updateProject(
  projects: Record<string, ProjectSettings>,
  projectId: string,
  patch: Partial<ProjectSettings>,
): Record<string, ProjectSettings> {
  const current = getProjectSettings(projects, projectId);
  return { ...projects, [projectId]: { ...current, ...patch } };
}

/**
 * Extract the session-scoped subset from ProjectSettings. Used as fallback
 * when reading a session that hasn't materialized its own entry yet.
 */
function projectAsSessionSettings(project: ProjectSettings): SessionScopedSettings {
  return {
    activeTools: project.activeTools,
    toolOrder: project.toolOrder,
    rightPanelWidth: project.rightPanelWidth,
    rightSplitRatio: project.rightSplitRatio,
    suppressedPanels: project.suppressedPanels,
    bottomTools: project.bottomTools,
    bottomToolsHeight: project.bottomToolsHeight,
    bottomToolsSplitRatios: project.bottomToolsSplitRatios,
  };
}

/**
 * Materialize a session entry by copying current resolved values (session
 * entry if present, else project fallback). Used by session setters before
 * applying a patch.
 */
function materializeSession(
  sessions: Record<string, SessionScopedSettings>,
  projects: Record<string, ProjectSettings>,
  sessionId: string,
  projectId: string,
): { nextSessions: Record<string, SessionScopedSettings>; current: SessionScopedSettings } {
  const existing = sessions[sessionId];
  if (existing) return { nextSessions: sessions, current: existing };
  const seed = projectAsSessionSettings(getProjectSettings(projects, projectId));
  return { nextSessions: { ...sessions, [sessionId]: seed }, current: seed };
}

/** Immutably patch a single session's settings */
function updateSession(
  sessions: Record<string, SessionScopedSettings>,
  sessionId: string,
  patch: Partial<SessionScopedSettings>,
): Record<string, SessionScopedSettings> {
  const current = sessions[sessionId];
  if (!current) {
    // Defensive: caller should have materialized first. Seed from project defaults
    // projected into the session-scoped subset.
    return {
      ...sessions,
      [sessionId]: { ...projectAsSessionSettings(DEFAULT_PROJECT_SETTINGS), ...patch },
    };
  }
  return { ...sessions, [sessionId]: { ...current, ...patch } };
}

// ── Legacy localStorage migration ──

/**
 * One-time migration: read all existing harnss-* localStorage keys into the
 * Zustand store shape. This runs only when the store key doesn't exist yet.
 */
function migrateFromLegacyLocalStorage(): { global: GlobalSettingsState; projects: Record<string, ProjectSettings> } {
  const global = readLegacyGlobalSettings();

  // Scan localStorage for all project-scoped keys to discover project IDs
  const projectIds = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("harnss-") || key === STORE_KEY) continue;

    // Global keys don't have a second segment that looks like a project ID.
    // Per-project keys follow the pattern: harnss-{projectId}-{setting}
    // We detect project keys by checking for known per-project suffixes.
    const perProjectSuffixes = [
      "-model-claude", "-model-acp", "-model-codex", "-model",
      "-git-cwd", "-active-tools", "-tool-order",
      "-right-panel-width", "-right-split",
      "-collapsed-repos", "-suppressed-panels",
      "-bottom-tools", "-bottom-tools-height", "-bottom-tools-split-ratios",
      "-organize-by-branch",
    ];

    for (const suffix of perProjectSuffixes) {
      if (key.endsWith(suffix)) {
        const pid = key.slice("harnss-".length, key.length - suffix.length);
        if (pid.length > 0) projectIds.add(pid);
        break;
      }
    }
  }

  const projects: Record<string, ProjectSettings> = {};
  for (const pid of projectIds) {
    projects[pid] = readLegacyProjectSettings(pid);
  }

  return { global, projects };
}

function readLegacyBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "true";
}

function readLegacyNumber(key: string, fallback: number, min: number, max: number): number {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function readLegacyJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function readLegacyGlobalSettings(): GlobalSettingsState {
  const themeRaw = localStorage.getItem("harnss-theme");
  const theme: ThemeOption = (themeRaw === "light" || themeRaw === "dark" || themeRaw === "system") ? themeRaw : "dark";

  // Plan mode with legacy migration
  let planMode = DEFAULT_PLAN_MODE;
  const storedPlanMode = localStorage.getItem("harnss-plan-mode");
  if (storedPlanMode !== null) {
    planMode = storedPlanMode === "true";
  } else {
    const legacyPermission = localStorage.getItem("harnss-permission-mode");
    if (legacyPermission === "plan") planMode = true;
  }

  // Permission mode with legacy migration
  const storedPermission = localStorage.getItem("harnss-permission-mode");
  const permissionMode = (!storedPermission || storedPermission === "plan") ? DEFAULT_PERMISSION_MODE : storedPermission;

  // ACP permission behavior
  const storedAcpBehavior = localStorage.getItem("harnss-acp-permission-behavior");
  const validAcpBehaviors: AcpPermissionBehavior[] = ["ask", "auto_accept", "allow_all"];
  const acpPermissionBehavior: AcpPermissionBehavior =
    storedAcpBehavior && validAcpBehaviors.includes(storedAcpBehavior as AcpPermissionBehavior)
      ? (storedAcpBehavior as AcpPermissionBehavior)
      : "ask";

  // Claude effort
  const storedEffort = localStorage.getItem("harnss-claude-effort");
  const claudeEffort: ClaudeEffort =
    (storedEffort === "low" || storedEffort === "medium" || storedEffort === "high" || storedEffort === "max")
      ? storedEffort
      : DEFAULT_CLAUDE_EFFORT;

  return {
    theme,
    islandLayout: readLegacyBool("harnss-island-layout", true),
    islandShine: readLegacyBool("harnss-island-shine", true),
    macNativeBackgroundEffect: "liquid-glass",
    transparency: readLegacyBool("harnss-transparency", true),
    planMode,
    permissionMode,
    acpPermissionBehavior,
    thinking: readLegacyBool("harnss-thinking", true),
    claudeEffort,
    autoGroupTools: readLegacyBool("harnss-auto-group-tools", true),
    avoidGroupingEdits: readLegacyBool("harnss-avoid-grouping-edits", false),
    autoExpandTools: readLegacyBool("harnss-auto-expand-tools", false),
    expandEditToolCallsByDefault: readLegacyBool("harnss-expand-edit-tool-calls-by-default", true),
    transparentToolPicker: readLegacyBool("harnss-transparent-tool-picker", false),
    coloredSidebarIcons: readLegacyBool("harnss-colored-sidebar-icons", true),
    showToolIcons: readLegacyBool("harnss-show-tool-icons", true),
    coloredToolIcons: readLegacyBool("harnss-colored-tool-icons", false),
  };
}

function isCodexLikeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return /^gpt[-\w.]*$/i.test(normalized) || /^o[0-9][\w.-]*$/i.test(normalized);
}

function readLegacyModelForEngine(pid: string, engine: EngineId): string {
  const byEngine = localStorage.getItem(`harnss-${pid}-model-${engine}`);
  if (byEngine && byEngine.trim().length > 0) return byEngine.trim();

  const legacy = localStorage.getItem(`harnss-${pid}-model`);
  if (!legacy || legacy.trim().length === 0) return DEFAULT_ENGINE_MODELS[engine];
  const legacyValue = legacy.trim();

  if (engine === "claude") {
    return isCodexLikeModel(legacyValue) ? DEFAULT_ENGINE_MODELS.claude : legacyValue;
  }
  if (engine === "codex") {
    return isCodexLikeModel(legacyValue) ? legacyValue : DEFAULT_ENGINE_MODELS.codex;
  }
  return DEFAULT_ENGINE_MODELS[engine];
}

function readLegacyToolOrder(pid: string): ToolId[] {
  const stored = readLegacyJson<ToolId[]>(`harnss-${pid}-tool-order`, []).filter((id) => VALID_TOOL_IDS.has(id));
  if (stored.length === 0) return [...DEFAULT_TOOL_ORDER];
  const set = new Set(stored);
  const result = [...stored];
  for (const id of DEFAULT_TOOL_ORDER) {
    if (!set.has(id)) result.push(id);
  }
  return result;
}

function readLegacyProjectSettings(pid: string): ProjectSettings {
  return {
    modelsByEngine: {
      claude: readLegacyModelForEngine(pid, "claude"),
      acp: readLegacyModelForEngine(pid, "acp"),
      codex: readLegacyModelForEngine(pid, "codex"),
      cli: readLegacyModelForEngine(pid, "cli"),
    },
    gitCwd: localStorage.getItem(`harnss-${pid}-git-cwd`),
    activeTools: readLegacyJson<ToolId[]>(`harnss-${pid}-active-tools`, []).filter((id) => VALID_TOOL_IDS.has(id)),
    toolOrder: readLegacyToolOrder(pid),
    rightPanelWidth: readLegacyNumber(`harnss-${pid}-right-panel-width`, DEFAULT_RIGHT_PANEL, MIN_RIGHT_PANEL, MAX_RIGHT_PANEL),
    rightSplitRatio: readLegacyNumber(`harnss-${pid}-right-split`, DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT),
    collapsedRepos: readLegacyJson<string[]>(`harnss-${pid}-collapsed-repos`, []),
    suppressedPanels: readLegacyJson<ToolId[]>(`harnss-${pid}-suppressed-panels`, []),
    bottomTools: readLegacyJson<ToolId[]>(`harnss-${pid}-bottom-tools`, []).filter((id) => VALID_TOOL_IDS.has(id)),
    bottomToolsHeight: readLegacyNumber(`harnss-${pid}-bottom-tools-height`, DEFAULT_BOTTOM_HEIGHT, MIN_BOTTOM_HEIGHT, MAX_BOTTOM_HEIGHT),
    bottomToolsSplitRatios: readLegacyJson<number[]>(`harnss-${pid}-bottom-tools-split-ratios`, []),
    organizeByChatBranch: readLegacyBool(`harnss-${pid}-organize-by-branch`, false),
  };
}

// ── Side-effect: persist macBackgroundEffect to AppSettings ──

function persistMacBackgroundEffect(effect: Exclude<MacBackgroundEffect, "off">): void {
  if (!IS_MAC_PLATFORM || typeof window === "undefined" || !window.claude?.settings) return;
  void window.claude.settings.set({ macBackgroundEffect: effect });
}

// ── Validation helpers ──

function validateToolOrder(stored: ToolId[]): ToolId[] {
  const valid = stored.filter((id) => VALID_TOOL_IDS.has(id));
  if (valid.length === 0) return [...DEFAULT_TOOL_ORDER];
  const set = new Set(valid);
  const result = [...valid];
  for (const id of DEFAULT_TOOL_ORDER) {
    if (!set.has(id)) result.push(id);
  }
  return result;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function hasSameOrderedValues<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

/**
 * Strip any DRAFT_SESSION_ID entry before persisting. Drafts are ephemeral by
 * definition — they're either materialized into a real session (remapped)
 * or abandoned. Persisting them would cause stale draft customizations to
 * bleed into the next draft across app restarts.
 */
function stripDraftFromSessions(
  sessions: Record<string, SessionScopedSettings>,
): Record<string, SessionScopedSettings> {
  if (!(DRAFT_SESSION_ID in sessions)) return sessions;
  const next = { ...sessions };
  delete next[DRAFT_SESSION_ID];
  return next;
}

// ── Store creation ──

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      // ── Global state defaults ──
      theme: "dark",
      islandLayout: true,
      islandShine: true,
      macNativeBackgroundEffect: "liquid-glass",
      transparency: true,
      planMode: DEFAULT_PLAN_MODE,
      permissionMode: DEFAULT_PERMISSION_MODE,
      acpPermissionBehavior: "ask",
      thinking: true,
      claudeEffort: DEFAULT_CLAUDE_EFFORT,
      autoGroupTools: true,
      avoidGroupingEdits: false,
      autoExpandTools: false,
      expandEditToolCallsByDefault: true,
      transparentToolPicker: false,
      coloredSidebarIcons: true,
      showToolIcons: true,
      coloredToolIcons: false,

      projects: {},
      sessions: {},

      // ── Global setters ──

      setTheme: (t) => set({ theme: t }),

      setIslandLayout: (enabled) => set({ islandLayout: enabled }),

      setIslandShine: (enabled) => set({ islandShine: enabled }),

      setMacBackgroundEffect: (effect) => {
        if (effect === "off") {
          set({ transparency: false });
          return;
        }
        set({ macNativeBackgroundEffect: effect, transparency: true });
        persistMacBackgroundEffect(effect);
      },

      setTransparency: (enabled) => {
        set({ transparency: enabled });
        if (IS_MAC_PLATFORM && enabled) {
          persistMacBackgroundEffect(get().macNativeBackgroundEffect);
        }
      },

      setPlanMode: (enabled) => set({ planMode: enabled }),

      setPermissionMode: (mode) => {
        // Legacy: treat "plan" as enabling the dedicated plan toggle
        if (mode === "plan") {
          set({ planMode: true, permissionMode: DEFAULT_PERMISSION_MODE });
          return;
        }
        set({ permissionMode: mode });
      },

      setAcpPermissionBehavior: (b) => set({ acpPermissionBehavior: b }),

      setThinking: (on) => set({ thinking: on }),

      setClaudeEffort: (effort) => set({ claudeEffort: effort }),

      setAutoGroupTools: (on) => set({ autoGroupTools: on }),

      setAvoidGroupingEdits: (on) => set({ avoidGroupingEdits: on }),

      setAutoExpandTools: (on) => set({ autoExpandTools: on }),

      setExpandEditToolCallsByDefault: (on) => set({ expandEditToolCallsByDefault: on }),

      setTransparentToolPicker: (on) => set({ transparentToolPicker: on }),

      setColoredSidebarIcons: (on) => set({ coloredSidebarIcons: on }),

      setShowToolIcons: (on) => set({ showToolIcons: on }),

      setColoredToolIcons: (on) => set({ coloredToolIcons: on }),

      // ── Per-project setters ──

      setModelForEngine: (projectId, engine, model) => {
        const normalized = model.trim();
        if (!normalized) return;
        const { projects } = get();
        const current = getProjectSettings(projects, projectId);
        if (current.modelsByEngine[engine] === normalized) return;
        const nextModels = { ...current.modelsByEngine, [engine]: normalized };
        set({ projects: updateProject(projects, projectId, { modelsByEngine: nextModels }) });
      },

      setGitCwd: (projectId, path) => {
        const trimmed = path?.trim() || null;
        const { projects } = get();
        set({ projects: updateProject(projects, projectId, { gitCwd: trimmed }) });
      },

      setActiveTools: (projectId, updater) => {
        const { projects } = get();
        const current = getProjectSettings(projects, projectId);
        const next = typeof updater === "function" ? updater(current.activeTools) : updater;
        const valid = next.filter((id) => VALID_TOOL_IDS.has(id));
        if (hasSameOrderedValues(current.activeTools, valid)) return;
        set({ projects: updateProject(projects, projectId, { activeTools: valid }) });
      },

      setToolOrder: (projectId, updater) => {
        const { projects } = get();
        const current = getProjectSettings(projects, projectId);
        const next = typeof updater === "function" ? updater(current.toolOrder) : updater;
        set({ projects: updateProject(projects, projectId, { toolOrder: validateToolOrder(next) }) });
      },

      setRightPanelWidth: (projectId, width) => {
        const clamped = clampNumber(width, MIN_RIGHT_PANEL, MAX_RIGHT_PANEL, DEFAULT_RIGHT_PANEL);
        const { projects } = get();
        set({ projects: updateProject(projects, projectId, { rightPanelWidth: clamped }) });
      },

      setRightSplitRatio: (projectId, ratio) => {
        const clamped = clampNumber(ratio, MIN_SPLIT, MAX_SPLIT, DEFAULT_SPLIT);
        const { projects } = get();
        set({ projects: updateProject(projects, projectId, { rightSplitRatio: clamped }) });
      },

      setCollapsedRepos: (projectId, updater) => {
        const { projects } = get();
        const current = getProjectSettings(projects, projectId);
        const next = typeof updater === "function" ? updater(current.collapsedRepos) : updater;
        set({ projects: updateProject(projects, projectId, { collapsedRepos: next }) });
      },

      toggleRepoCollapsed: (projectId, path) => {
        const { projects } = get();
        const current = getProjectSettings(projects, projectId);
        const repos = current.collapsedRepos;
        const next = repos.includes(path) ? repos.filter((r) => r !== path) : [...repos, path];
        set({ projects: updateProject(projects, projectId, { collapsedRepos: next }) });
      },

      setSuppressedPanels: (projectId, updater) => {
        const { projects } = get();
        const current = getProjectSettings(projects, projectId);
        const next = typeof updater === "function" ? updater(current.suppressedPanels) : updater;
        set({ projects: updateProject(projects, projectId, { suppressedPanels: next }) });
      },

      suppressPanel: (projectId, id) => {
        const { projects } = get();
        const current = getProjectSettings(projects, projectId);
        if (current.suppressedPanels.includes(id)) return;
        set({ projects: updateProject(projects, projectId, { suppressedPanels: [...current.suppressedPanels, id] }) });
      },

      unsuppressPanel: (projectId, id) => {
        const { projects } = get();
        const current = getProjectSettings(projects, projectId);
        if (!current.suppressedPanels.includes(id)) return;
        set({ projects: updateProject(projects, projectId, { suppressedPanels: current.suppressedPanels.filter((p) => p !== id) }) });
      },

      setBottomTools: (projectId, updater) => {
        const { projects } = get();
        const current = getProjectSettings(projects, projectId);
        const next = typeof updater === "function" ? updater(current.bottomTools) : updater;
        const valid = next.filter((id) => VALID_TOOL_IDS.has(id));
        set({ projects: updateProject(projects, projectId, { bottomTools: valid }) });
      },

      setBottomToolsHeight: (projectId, height) => {
        const clamped = clampNumber(height, MIN_BOTTOM_HEIGHT, MAX_BOTTOM_HEIGHT, DEFAULT_BOTTOM_HEIGHT);
        const { projects } = get();
        set({ projects: updateProject(projects, projectId, { bottomToolsHeight: clamped }) });
      },

      setBottomToolsSplitRatios: (projectId, ratios) => {
        const { projects } = get();
        set({ projects: updateProject(projects, projectId, { bottomToolsSplitRatios: [...ratios] }) });
      },

      setOrganizeByChatBranch: (projectId, on) => {
        const { projects } = get();
        set({ projects: updateProject(projects, projectId, { organizeByChatBranch: on }) });
      },

      // ── Per-session setters ──

      setSessionActiveTools: (sessionId, projectId, updater) => {
        const { sessions, projects } = get();
        const { nextSessions, current } = materializeSession(sessions, projects, sessionId, projectId);
        const next = typeof updater === "function" ? updater(current.activeTools) : updater;
        const valid = next.filter((id) => VALID_TOOL_IDS.has(id));
        if (hasSameOrderedValues(current.activeTools, valid)) return;
        set({ sessions: updateSession(nextSessions, sessionId, { activeTools: valid }) });
      },

      setSessionToolOrder: (sessionId, projectId, updater) => {
        const { sessions, projects } = get();
        const { nextSessions, current } = materializeSession(sessions, projects, sessionId, projectId);
        const next = typeof updater === "function" ? updater(current.toolOrder) : updater;
        set({ sessions: updateSession(nextSessions, sessionId, { toolOrder: validateToolOrder(next) }) });
      },

      setSessionRightPanelWidth: (sessionId, projectId, width) => {
        const clamped = clampNumber(width, MIN_RIGHT_PANEL, MAX_RIGHT_PANEL, DEFAULT_RIGHT_PANEL);
        const { sessions, projects } = get();
        const { nextSessions, current } = materializeSession(sessions, projects, sessionId, projectId);
        // Skip when the value hasn't changed. Prevents a drag that ends on the
        // original pixel from forking the session from project defaults.
        if (current.rightPanelWidth === clamped) return;
        set({ sessions: updateSession(nextSessions, sessionId, { rightPanelWidth: clamped }) });
      },

      setSessionRightSplitRatio: (sessionId, projectId, ratio) => {
        const clamped = clampNumber(ratio, MIN_SPLIT, MAX_SPLIT, DEFAULT_SPLIT);
        const { sessions, projects } = get();
        const { nextSessions, current } = materializeSession(sessions, projects, sessionId, projectId);
        if (current.rightSplitRatio === clamped) return;
        set({ sessions: updateSession(nextSessions, sessionId, { rightSplitRatio: clamped }) });
      },

      setSessionSuppressedPanels: (sessionId, projectId, updater) => {
        const { sessions, projects } = get();
        const { nextSessions, current } = materializeSession(sessions, projects, sessionId, projectId);
        const next = typeof updater === "function" ? updater(current.suppressedPanels) : updater;
        set({ sessions: updateSession(nextSessions, sessionId, { suppressedPanels: next }) });
      },

      suppressSessionPanel: (sessionId, projectId, id) => {
        const { sessions, projects } = get();
        const { nextSessions, current } = materializeSession(sessions, projects, sessionId, projectId);
        if (current.suppressedPanels.includes(id)) return;
        set({ sessions: updateSession(nextSessions, sessionId, { suppressedPanels: [...current.suppressedPanels, id] }) });
      },

      unsuppressSessionPanel: (sessionId, projectId, id) => {
        const { sessions, projects } = get();
        const { nextSessions, current } = materializeSession(sessions, projects, sessionId, projectId);
        if (!current.suppressedPanels.includes(id)) return;
        set({ sessions: updateSession(nextSessions, sessionId, { suppressedPanels: current.suppressedPanels.filter((p) => p !== id) }) });
      },

      setSessionBottomTools: (sessionId, projectId, updater) => {
        const { sessions, projects } = get();
        const { nextSessions, current } = materializeSession(sessions, projects, sessionId, projectId);
        const next = typeof updater === "function" ? updater(current.bottomTools) : updater;
        const valid = next.filter((id) => VALID_TOOL_IDS.has(id));
        set({ sessions: updateSession(nextSessions, sessionId, { bottomTools: valid }) });
      },

      setSessionBottomToolsHeight: (sessionId, projectId, height) => {
        const clamped = clampNumber(height, MIN_BOTTOM_HEIGHT, MAX_BOTTOM_HEIGHT, DEFAULT_BOTTOM_HEIGHT);
        const { sessions, projects } = get();
        const { nextSessions, current } = materializeSession(sessions, projects, sessionId, projectId);
        if (current.bottomToolsHeight === clamped) return;
        set({ sessions: updateSession(nextSessions, sessionId, { bottomToolsHeight: clamped }) });
      },

      setSessionBottomToolsSplitRatios: (sessionId, projectId, ratios) => {
        const { sessions, projects } = get();
        const { nextSessions, current } = materializeSession(sessions, projects, sessionId, projectId);
        const nextRatios = [...ratios];
        if (hasSameOrderedValues(current.bottomToolsSplitRatios, nextRatios)) return;
        set({ sessions: updateSession(nextSessions, sessionId, { bottomToolsSplitRatios: nextRatios }) });
      },

      clearSessionSettings: (sessionId) => {
        const { sessions } = get();
        if (!(sessionId in sessions)) return;
        const next = { ...sessions };
        delete next[sessionId];
        set({ sessions: next });
      },

      remapSessionSettings: (fromId, toId) => {
        if (fromId === toId) return;
        const { sessions } = get();
        const src = sessions[fromId];
        if (!src) return;
        if (sessions[toId]) {
          // Should not happen in practice — two drafts racing or logic bug.
          // Log and overwrite so the more recent (fromId) customizations win.
          console.warn(`[settings-store] remapSessionSettings: overwriting existing entry at ${toId}`);
        }
        const next = { ...sessions };
        delete next[fromId];
        next[toId] = src;
        set({ sessions: next });
      },
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Global state
        theme: state.theme,
        islandLayout: state.islandLayout,
        islandShine: state.islandShine,
        macNativeBackgroundEffect: state.macNativeBackgroundEffect,
        transparency: state.transparency,
        planMode: state.planMode,
        permissionMode: state.permissionMode,
        acpPermissionBehavior: state.acpPermissionBehavior,
        thinking: state.thinking,
        claudeEffort: state.claudeEffort,
        autoGroupTools: state.autoGroupTools,
        avoidGroupingEdits: state.avoidGroupingEdits,
        autoExpandTools: state.autoExpandTools,
        expandEditToolCallsByDefault: state.expandEditToolCallsByDefault,
        transparentToolPicker: state.transparentToolPicker,
        coloredSidebarIcons: state.coloredSidebarIcons,
        showToolIcons: state.showToolIcons,
        coloredToolIcons: state.coloredToolIcons,
        // Per-project
        projects: state.projects,
        // Per-session (tool panel state). DRAFT_ID is ephemeral — never persist it.
        sessions: stripDraftFromSessions(state.sessions),
      }),
      // Merge incoming persisted state with defaults (handles new fields added later)
      merge: (persisted, current) => {
        const incoming = persisted as Partial<SettingsStore> | undefined;
        if (!incoming) return current;
        return {
          ...current,
          ...incoming,
          // Ensure projects / sessions are always objects, never undefined.
          // Defensive: strip DRAFT entry in case a prior version persisted it.
          projects: incoming.projects ?? current.projects,
          sessions: incoming.sessions ? stripDraftFromSessions(incoming.sessions) : current.sessions,
        };
      },
    },
  ),
);

// ── Legacy migration bootstrap ──

/**
 * Call once at app startup (e.g., in main.tsx) to migrate from the old
 * scattered localStorage keys to the unified Zustand store.
 * No-op if the store key already exists.
 */
export function migrateSettingsIfNeeded(): void {
  // If the store already has data, skip migration
  if (localStorage.getItem(STORE_KEY)) return;

  const { global, projects } = migrateFromLegacyLocalStorage();

  // Hydrate the store with migrated data
  useSettingsStore.setState({
    ...global,
    projects,
  });
}

// ── Selector helpers (for efficient subscriptions) ──

/**
 * Select a specific project's settings from the store.
 * Returns defaults for projects that haven't been configured yet.
 */
export function selectProjectSettings(state: SettingsStore, projectId: string): ProjectSettings {
  return getProjectSettings(state.projects, projectId);
}

/**
 * Resolve session-scoped settings. If the session has materialized its own
 * entry, return it. Otherwise return the project's settings projected into
 * the session-scoped subset.
 *
 * Note: when no session entry exists, this constructs a new object per call.
 * Use with `useShallow` to avoid unnecessary re-renders; the nested array
 * fields come from a stable ProjectSettings reference so shallow compare sees
 * no change even though the wrapper object is new.
 */
export function selectSessionScopedSettings(
  state: SettingsStore,
  sessionId: string,
  projectId: string,
): SessionScopedSettings {
  const session = state.sessions[sessionId];
  if (session) return session;
  return projectAsSessionSettings(getProjectSettings(state.projects, projectId));
}

/** Derive macBackgroundEffect from transparency + macNativeBackgroundEffect */
export function deriveMacBackgroundEffect(state: Pick<GlobalSettingsState, "transparency" | "macNativeBackgroundEffect">): MacBackgroundEffect {
  if (!IS_MAC_PLATFORM) {
    return state.transparency ? "liquid-glass" : "off";
  }
  return state.transparency ? state.macNativeBackgroundEffect : "off";
}
