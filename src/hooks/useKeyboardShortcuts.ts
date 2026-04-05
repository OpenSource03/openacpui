import { useEffect } from "react";

interface UseKeyboardShortcutsOptions {
  /** Current plan mode state */
  planMode: boolean;
  /** Setter for plan mode */
  setPlanMode: (enabled: boolean) => void;
  /** Propagate plan mode change to the active session */
  setActivePlanMode: (enabled: boolean) => void;
  /** Current engine for the active session or selected agent */
  activeEngine: string;
  /** Active session ID (keyboard shortcuts are disabled without a session) */
  activeSessionId: string | null;
  /** Setter for chat search overlay visibility */
  setChatSearchOpen: (updater: (prev: boolean) => boolean) => void;
}

/**
 * Global keyboard shortcuts:
 * - Shift+Tab: toggle plan mode (Claude/Codex only, not ACP)
 * - Cmd+F / Ctrl+F: toggle in-chat search overlay
 */
export function useKeyboardShortcuts({
  planMode,
  setPlanMode,
  setActivePlanMode,
  activeEngine,
  activeSessionId,
  setChatSearchOpen,
}: UseKeyboardShortcutsOptions): void {
  // Shift+Tab — toggle plan mode for Claude and Codex engines
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        if (activeEngine === "acp") return; // ACP doesn't support plan mode
        const next = !planMode;
        setPlanMode(next);
        setActivePlanMode(next);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [planMode, setPlanMode, setActivePlanMode, activeEngine]);

  // Cmd+F (Mac) / Ctrl+F — toggle in-chat search overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
        if (!activeSessionId) return;
        e.preventDefault();
        setChatSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSessionId, setChatSearchOpen]);
}
