/**
 * Compatibility shim: provides the same interface as the legacy useSettings hook
 * but reads from the Zustand settings store internally.
 *
 * Allows gradual migration — existing consumers call useSettingsCompat() with the
 * same signature and get the same return shape. Once all consumers move to direct
 * store selectors, this file can be deleted.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/shallow";
import type { ToolId } from "@/types/tools";
import type { EngineId, MacBackgroundEffect } from "@/types";
import type { Settings } from "@/hooks/useSettings";
import {
  useSettingsStore,
  selectProjectSettings,
  deriveMacBackgroundEffect,
  DEFAULT_ENGINE_MODELS,
} from "@/stores/settings-store";

/**
 * Drop-in replacement for the legacy `useSettings` hook.
 *
 * Internally subscribes to the Zustand store with fine-grained selectors,
 * then reassembles the same `Settings` object that consumers expect.
 */
export function useSettingsCompat(projectId: string | null, engine: EngineId = "claude"): Settings {
  const pid = projectId ?? "__none__";

  // ── Global state (single shallow subscription) ──

  const globalState = useSettingsStore(
    useShallow((s) => ({
      theme: s.theme,
      islandLayout: s.islandLayout,
      islandShine: s.islandShine,
      macNativeBackgroundEffect: s.macNativeBackgroundEffect,
      transparency: s.transparency,
      planMode: s.planMode,
      permissionMode: s.permissionMode,
      acpPermissionBehavior: s.acpPermissionBehavior,
      thinking: s.thinking,
      claudeEffort: s.claudeEffort,
      autoGroupTools: s.autoGroupTools,
      avoidGroupingEdits: s.avoidGroupingEdits,
      autoExpandTools: s.autoExpandTools,
      expandEditToolCallsByDefault: s.expandEditToolCallsByDefault,
      transparentToolPicker: s.transparentToolPicker,
      coloredSidebarIcons: s.coloredSidebarIcons,
      showToolIcons: s.showToolIcons,
      coloredToolIcons: s.coloredToolIcons,
    })),
  );

  // ── Global setters (stable references from the store) ──

  const setTheme = useSettingsStore((s) => s.setTheme);
  const setIslandLayout = useSettingsStore((s) => s.setIslandLayout);
  const setIslandShine = useSettingsStore((s) => s.setIslandShine);
  const setMacBackgroundEffect = useSettingsStore((s) => s.setMacBackgroundEffect);
  const setTransparency = useSettingsStore((s) => s.setTransparency);
  const setPlanMode = useSettingsStore((s) => s.setPlanMode);
  const storeSetPermissionMode = useSettingsStore((s) => s.setPermissionMode);
  const setAcpPermissionBehavior = useSettingsStore((s) => s.setAcpPermissionBehavior);
  const setThinking = useSettingsStore((s) => s.setThinking);
  const setClaudeEffort = useSettingsStore((s) => s.setClaudeEffort);
  const setAutoGroupTools = useSettingsStore((s) => s.setAutoGroupTools);
  const setAvoidGroupingEdits = useSettingsStore((s) => s.setAvoidGroupingEdits);
  const setAutoExpandTools = useSettingsStore((s) => s.setAutoExpandTools);
  const setExpandEditToolCallsByDefault = useSettingsStore((s) => s.setExpandEditToolCallsByDefault);
  const setTransparentToolPicker = useSettingsStore((s) => s.setTransparentToolPicker);
  const setColoredSidebarIcons = useSettingsStore((s) => s.setColoredSidebarIcons);
  const setShowToolIcons = useSettingsStore((s) => s.setShowToolIcons);
  const setColoredToolIcons = useSettingsStore((s) => s.setColoredToolIcons);

  // ── Per-project state ──

  const projectSettings = useSettingsStore(
    useShallow((s) => selectProjectSettings(s, pid)),
  );

  // ── Per-project store setters (require projectId binding) ──

  const storeSetModelForEngine = useSettingsStore((s) => s.setModelForEngine);
  const storeSetGitCwd = useSettingsStore((s) => s.setGitCwd);
  const storeSetActiveTools = useSettingsStore((s) => s.setActiveTools);
  const storeSetToolOrder = useSettingsStore((s) => s.setToolOrder);
  const storeSetRightPanelWidth = useSettingsStore((s) => s.setRightPanelWidth);
  const storeSetRightSplitRatio = useSettingsStore((s) => s.setRightSplitRatio);
  const storeToggleRepoCollapsed = useSettingsStore((s) => s.toggleRepoCollapsed);
  const storeSuppressPanel = useSettingsStore((s) => s.suppressPanel);
  const storeUnsuppressPanel = useSettingsStore((s) => s.unsuppressPanel);
  const storeSetBottomToolsHeight = useSettingsStore((s) => s.setBottomToolsHeight);
  const storeSetBottomToolsSplitRatios = useSettingsStore((s) => s.setBottomToolsSplitRatios);
  const storeSetOrganizeByChatBranch = useSettingsStore((s) => s.setOrganizeByChatBranch);

  // ── Derived: macBackgroundEffect ──

  const macBackgroundEffect: MacBackgroundEffect = deriveMacBackgroundEffect(globalState);

  // ── Derived: model for the current engine ──

  const modelsByEngine = projectSettings.modelsByEngine;
  const model = modelsByEngine[engine] ?? DEFAULT_ENGINE_MODELS[engine];

  // ── Derived: Set wrappers for array-backed collections ──

  const activeTools = useMemo(() => new Set(projectSettings.activeTools), [projectSettings.activeTools]);
  const collapsedRepos = useMemo(() => new Set(projectSettings.collapsedRepos), [projectSettings.collapsedRepos]);
  const suppressedPanels = useMemo(() => new Set(projectSettings.suppressedPanels), [projectSettings.suppressedPanels]);
  const bottomTools = useMemo(() => new Set(projectSettings.bottomTools), [projectSettings.bottomTools]);

  // ── Bound callbacks (match old useSettings signatures) ──

  const setPermissionMode = useCallback(
    (mode: string) => storeSetPermissionMode(mode),
    [storeSetPermissionMode],
  );

  const setModel = useCallback(
    (m: string) => storeSetModelForEngine(pid, engine, m),
    [storeSetModelForEngine, pid, engine],
  );

  const getModelForEngine = useCallback(
    (targetEngine: EngineId) => modelsByEngine[targetEngine] ?? DEFAULT_ENGINE_MODELS[targetEngine],
    [modelsByEngine],
  );

  const setModelForEngine = useCallback(
    (targetEngine: EngineId, m: string) => storeSetModelForEngine(pid, targetEngine, m),
    [storeSetModelForEngine, pid],
  );

  const setGitCwd = useCallback(
    (path: string | null) => storeSetGitCwd(pid, path),
    [storeSetGitCwd, pid],
  );

  const setActiveTools = useCallback(
    (updater: Set<ToolId> | ((prev: Set<ToolId>) => Set<ToolId>)) => {
      if (typeof updater === "function") {
        storeSetActiveTools(pid, (prevArr) => {
          const prevSet = new Set(prevArr);
          const nextSet = updater(prevSet);
          return [...nextSet];
        });
      } else {
        storeSetActiveTools(pid, [...updater]);
      }
    },
    [storeSetActiveTools, pid],
  );

  const setToolOrder = useCallback(
    (updater: ToolId[] | ((prev: ToolId[]) => ToolId[])) => storeSetToolOrder(pid, updater),
    [storeSetToolOrder, pid],
  );

  const setRightPanelWidth = useCallback(
    (w: number) => storeSetRightPanelWidth(pid, w),
    [storeSetRightPanelWidth, pid],
  );

  // Save callbacks: Zustand auto-persists, so these are no-ops that
  // maintain API compatibility. The old hook needed explicit saves because
  // it used refs for in-flight values during drag operations. With Zustand
  // persist middleware, every set() is automatically written to localStorage.
  const saveRightPanelWidth = useCallback(() => { /* persisted automatically */ }, []);

  const setRightSplitRatio = useCallback(
    (r: number) => storeSetRightSplitRatio(pid, r),
    [storeSetRightSplitRatio, pid],
  );

  const saveRightSplitRatio = useCallback(() => { /* persisted automatically */ }, []);

  const toggleRepoCollapsed = useCallback(
    (path: string) => storeToggleRepoCollapsed(pid, path),
    [storeToggleRepoCollapsed, pid],
  );

  const suppressPanel = useCallback(
    (id: ToolId) => storeSuppressPanel(pid, id),
    [storeSuppressPanel, pid],
  );

  const unsuppressPanel = useCallback(
    (id: ToolId) => storeUnsuppressPanel(pid, id),
    [storeUnsuppressPanel, pid],
  );

  const setBottomToolsHeight = useCallback(
    (h: number) => storeSetBottomToolsHeight(pid, h),
    [storeSetBottomToolsHeight, pid],
  );

  const saveBottomToolsHeight = useCallback(() => { /* persisted automatically */ }, []);

  const setBottomToolsSplitRatios = useCallback(
    (r: number[]) => storeSetBottomToolsSplitRatios(pid, r),
    [storeSetBottomToolsSplitRatios, pid],
  );

  const saveBottomToolsSplitRatios = useCallback(() => { /* persisted automatically */ }, []);

  const setOrganizeByChatBranch = useCallback(
    (on: boolean) => storeSetOrganizeByChatBranch(pid, on),
    [storeSetOrganizeByChatBranch, pid],
  );

  // ── Sync macNativeBackgroundEffect from AppSettings on mount ──

  const hasSyncedMacEffect = useRef(false);
  useEffect(() => {
    if (hasSyncedMacEffect.current) return;
    hasSyncedMacEffect.current = true;

    if (typeof window === "undefined" || !window.claude?.settings) return;
    if (typeof navigator === "undefined" || !/mac/i.test(navigator.platform)) return;

    void window.claude.settings.get().then((appSettings) => {
      if (!appSettings) return;
      const effect = appSettings.macBackgroundEffect === "vibrancy" ? "vibrancy" as const : "liquid-glass" as const;
      useSettingsStore.setState({ macNativeBackgroundEffect: effect });
    }).catch(() => {
      // Keep default when AppSettings unavailable
    });
  }, []);

  // ── Return the same shape as legacy Settings interface ──

  return {
    // Global
    theme: globalState.theme,
    setTheme,
    islandLayout: globalState.islandLayout,
    setIslandLayout,
    islandShine: globalState.islandShine,
    setIslandShine,
    macBackgroundEffect,
    setMacBackgroundEffect,
    transparency: globalState.transparency,
    setTransparency,
    planMode: globalState.planMode,
    setPlanMode,
    permissionMode: globalState.permissionMode,
    setPermissionMode,
    acpPermissionBehavior: globalState.acpPermissionBehavior,
    setAcpPermissionBehavior,
    thinking: globalState.thinking,
    setThinking,
    claudeEffort: globalState.claudeEffort,
    setClaudeEffort,
    autoGroupTools: globalState.autoGroupTools,
    setAutoGroupTools,
    avoidGroupingEdits: globalState.avoidGroupingEdits,
    setAvoidGroupingEdits,
    autoExpandTools: globalState.autoExpandTools,
    setAutoExpandTools,
    expandEditToolCallsByDefault: globalState.expandEditToolCallsByDefault,
    setExpandEditToolCallsByDefault,
    transparentToolPicker: globalState.transparentToolPicker,
    setTransparentToolPicker,
    coloredSidebarIcons: globalState.coloredSidebarIcons,
    setColoredSidebarIcons,
    showToolIcons: globalState.showToolIcons,
    setShowToolIcons,
    coloredToolIcons: globalState.coloredToolIcons,
    setColoredToolIcons,

    // Per-project
    model,
    setModel,
    getModelForEngine,
    setModelForEngine,
    gitCwd: projectSettings.gitCwd,
    setGitCwd,
    activeTools,
    setActiveTools,
    rightPanelWidth: projectSettings.rightPanelWidth,
    setRightPanelWidth,
    saveRightPanelWidth,
    toolOrder: projectSettings.toolOrder,
    setToolOrder,
    rightSplitRatio: projectSettings.rightSplitRatio,
    setRightSplitRatio,
    saveRightSplitRatio,
    collapsedRepos,
    toggleRepoCollapsed,
    suppressedPanels,
    suppressPanel,
    unsuppressPanel,
    bottomTools,
    bottomToolsHeight: projectSettings.bottomToolsHeight,
    setBottomToolsHeight,
    saveBottomToolsHeight,
    bottomToolsSplitRatios: projectSettings.bottomToolsSplitRatios,
    setBottomToolsSplitRatios,
    saveBottomToolsSplitRatios,
    organizeByChatBranch: projectSettings.organizeByChatBranch,
    setOrganizeByChatBranch,
  };
}
