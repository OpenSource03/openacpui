import { useEffect, useMemo } from "react";
import { useBackgroundAgents } from "@/hooks/useBackgroundAgents";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useSettingsCompat } from "@/hooks/useSettingsCompat";
import { getTodoItems } from "@/lib/chat/todo-utils";
import { COLUMN_TOOL_IDS } from "@/lib/workspace/tool-island-utils";
import type { ToolId } from "@/types/tools";

type SessionManagerState = ReturnType<typeof useSessionManager>;
type SettingsState = ReturnType<typeof useSettingsCompat>;

interface UseAppContextualPanelsInput {
  manager: SessionManagerState;
  settings: SettingsState;
  isSpaceSwitching: boolean;
}

export function useAppContextualPanels(input: UseAppContextualPanelsInput) {
  const todoMsgCount = input.manager.messages.length;
  const activeTodos = useMemo(() => {
    if (input.manager.codexTodoItems && input.manager.codexTodoItems.length > 0) {
      return input.manager.codexTodoItems;
    }
    for (let i = input.manager.messages.length - 1; i >= 0; i -= 1) {
      const msg = input.manager.messages[i];
      if (
        msg.role === "tool_call" &&
        msg.toolName === "TodoWrite" &&
        msg.toolInput &&
        "todos" in msg.toolInput
      ) {
        return getTodoItems(msg.toolInput.todos);
      }
    }
    return [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoMsgCount, input.manager.codexTodoItems]);

  const bgAgents = useBackgroundAgents({ sessionId: input.manager.activeSessionId });
  const hasTodos = activeTodos.length > 0;
  const hasAgents = bgAgents.agents.length > 0;

  const availableContextual = useMemo(() => {
    const next = new Set<ToolId>();
    if (hasTodos) next.add("tasks");
    if (hasAgents) next.add("agents");
    return next;
  }, [hasAgents, hasTodos]);

  useEffect(() => {
    if (!hasTodos) {
      input.settings.unsuppressPanel("tasks");
      return;
    }
    if (input.settings.suppressedPanels.has("tasks")) return;
    input.settings.setActiveTools((prev) => {
      if (prev.has("tasks")) return prev;
      const next = new Set(prev);
      next.add("tasks");
      return next;
    });
  }, [hasTodos, input.settings]);

  useEffect(() => {
    if (!hasAgents) {
      input.settings.unsuppressPanel("agents");
      return;
    }
    if (input.settings.suppressedPanels.has("agents")) return;
    input.settings.setActiveTools((prev) => {
      if (prev.has("agents")) return prev;
      const next = new Set(prev);
      next.add("agents");
      return next;
    });
  }, [hasAgents, input.settings]);

  const hasActiveSessionOrSwitching = !!input.manager.activeSessionId || input.isSpaceSwitching;
  const hasRightPanel = ((hasTodos && input.settings.activeTools.has("tasks")) || (hasAgents && input.settings.activeTools.has("agents"))) && hasActiveSessionOrSwitching;
  const hasToolsColumn = [...input.settings.activeTools].some((id) => COLUMN_TOOL_IDS.has(id) && !input.settings.bottomTools.has(id)) && hasActiveSessionOrSwitching;
  const hasBottomTools = [...input.settings.activeTools].some((id) => COLUMN_TOOL_IDS.has(id) && input.settings.bottomTools.has(id)) && hasActiveSessionOrSwitching;
  const showToolPicker = !!input.manager.activeSessionId || input.isSpaceSwitching;

  useEffect(() => {
    if (hasToolsColumn || hasBottomTools) window.dispatchEvent(new Event("resize"));
  }, [hasBottomTools, hasToolsColumn]);

  return {
    activeTodos,
    bgAgents,
    hasTodos,
    hasAgents,
    availableContextual,
    hasRightPanel,
    hasToolsColumn,
    hasBottomTools,
    showToolPicker,
  };
}
