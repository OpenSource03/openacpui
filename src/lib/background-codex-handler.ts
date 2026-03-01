import type { CodexSessionEvent } from "../types/codex";
import type { CodexThreadItem } from "../types/codex";
import type { InternalState } from "./background-session-store";
import { codexItemToToolName, codexItemToToolInput, codexItemToToolResult, codexPlanToTodos } from "./codex-adapter";
import { ensureACPStreamingMsg, finalizeACPStreamingMsg } from "./background-acp-handler";
import type { PermissionRequest } from "../types";

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Process a Codex notification for a background session, mutating `state` in place.
 * Returns `{ processingChanged, isProcessing, permissionRequest? }` when the caller
 * needs to fire callbacks.
 */
export function handleCodexEvent(
  state: InternalState,
  event: CodexSessionEvent,
): {
  processingChanged?: boolean;
  isProcessing?: boolean;
  permissionRequest?: PermissionRequest;
} | undefined {
  state.isConnected = true;
  const { method, params } = event;

  switch (method) {
    case "turn/started":
      state.isProcessing = true;
      state.codexPlanText = "";
      state.codexPlanTurnCounter += 1;
      return { processingChanged: true, isProcessing: true };

    case "turn/completed":
      finalizeACPStreamingMsg(state); // reuse — same pattern
      state.isProcessing = false;
      return { processingChanged: true, isProcessing: false };

    case "item/started": {
      const item = (params as Record<string, unknown>).item as CodexThreadItem | undefined;
      if (!item) break;
      if (item.type === "agentMessage" || item.type === "reasoning") {
        ensureACPStreamingMsg(state);
      } else {
        // Non-assistant item is a hard boundary — finalize streaming first
        finalizeACPStreamingMsg(state);
        const toolName = codexItemToToolName(item);
        if (toolName) {
          // Deterministic ID matches active hook so completions work after switch-back
          const msgId = `codex-tool-${item.id}`;
          state.parentToolMap.set(item.id, msgId);
          state.messages.push({
            id: msgId,
            role: "tool_call",
            content: "",
            toolName,
            toolInput: codexItemToToolInput(item),
            timestamp: Date.now(),
          });
        }
      }
      break;
    }

    case "item/completed": {
      const item = (params as Record<string, unknown>).item as CodexThreadItem | undefined;
      if (!item) break;
      if (item.type === "agentMessage") {
        const text = (item as Record<string, unknown>).text as string | undefined;
        const target = state.messages.find(m => m.id === state.currentStreamingMsgId);
        if (target && text) target.content = text;
        finalizeACPStreamingMsg(state);
      } else if (item.type === "reasoning") {
        // Mark thinking as complete on the current streaming message
        if (state.currentStreamingMsgId) {
          const target = state.messages.find(m => m.id === state.currentStreamingMsgId);
          if (target?.thinking) target.thinkingComplete = true;
        }
      } else if (item.type === "plan") {
        // Finalize plan: mark codex-plan-stream as completed, synthesize ExitPlanMode prompt
        finalizeACPStreamingMsg(state);
        const finalText = (item as Record<string, unknown>).text as string | undefined;
        const planContent = finalText ?? state.codexPlanText;
        if (planContent) {
          const existing = state.messages.find(m => m.id === "codex-plan-stream");
          if (existing) {
            existing.toolInput = { plan: planContent };
            existing.toolResult = { type: "plan" };
          } else {
            state.messages.push({
              id: nextId("plan"),
              role: "tool_call",
              content: "",
              toolName: "ExitPlanMode",
              toolInput: { plan: planContent },
              toolResult: { type: "plan" },
              timestamp: Date.now(),
            });
          }
          // Set plan permission mode on sessionInfo
          if (state.sessionInfo) {
            state.sessionInfo = { ...state.sessionInfo, permissionMode: "plan" };
          }
          // Synthesize ExitPlanMode permission so it's restored on switch-back
          const permission: PermissionRequest = {
            requestId: `codex-plan-${Date.now()}`,
            toolName: "ExitPlanMode",
            toolInput: {},
            toolUseId: "codex-plan",
          };
          state.pendingPermission = permission;
          return { permissionRequest: permission };
        }
      } else {
        // Generic tool completion — deterministic fallback for cross-session mapping
        const msgId = state.parentToolMap.get(item.id) ?? `codex-tool-${item.id}`;
        const msg = state.messages.find(m => m.id === msgId);
        if (msg) {
          const result = codexItemToToolResult(item);
          if (result) msg.toolResult = result;
          const isError =
            (item.type === "commandExecution" && (item.status === "failed" || item.status === "declined")) ||
            (item.type === "fileChange" && (item.status === "failed" || item.status === "declined")) ||
            (item.type === "mcpToolCall" && item.status === "failed");
          if (isError) msg.toolError = true;
        }
        state.parentToolMap.delete(item.id);
      }
      break;
    }

    case "item/agentMessage/delta": {
      const delta = (params as Record<string, unknown>).delta as string | undefined;
      if (delta) {
        ensureACPStreamingMsg(state);
        const target = state.messages.find(m => m.id === state.currentStreamingMsgId);
        if (target) {
          if (target.thinking && !target.thinkingComplete) target.thinkingComplete = true;
          target.content += delta;
        }
      }
      break;
    }

    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta": {
      const delta = (params as Record<string, unknown>).delta as string | undefined;
      if (delta) {
        ensureACPStreamingMsg(state);
        const target = state.messages.find(m => m.id === state.currentStreamingMsgId);
        if (target) target.thinking = (target.thinking ?? "") + delta;
      }
      break;
    }

    case "item/commandExecution/outputDelta": {
      const itemId = (params as Record<string, unknown>).itemId as string | undefined;
      const delta = (params as Record<string, unknown>).delta as string | undefined;
      if (!itemId || !delta) break;

      // Deterministic fallback for tools created by the active hook before switch-away
      const msgId = state.parentToolMap.get(itemId) ?? `codex-tool-${itemId}`;
      if (!msgId) break;

      const msg = state.messages.find(m => m.id === msgId);
      if (!msg) break;

      const existingStdout =
        typeof msg.toolResult?.stdout === "string"
          ? msg.toolResult.stdout
          : typeof msg.toolResult?.content === "string"
            ? msg.toolResult.content
            : "";

      msg.toolResult = {
        ...(msg.toolResult ?? {}),
        type: "text",
        stdout: existingStdout + delta,
      };
      break;
    }

    case "item/plan/delta": {
      const p = params as Record<string, unknown>;
      const delta = typeof p.delta === "string" ? p.delta : "";
      if (!delta) break;
      state.codexPlanText += delta;
      const planText = state.codexPlanText;
      const existing = state.messages.find(m => m.id === "codex-plan-stream");
      if (existing) {
        existing.toolInput = { plan: planText };
      } else {
        finalizeACPStreamingMsg(state);
        state.messages.push({
          id: "codex-plan-stream",
          role: "tool_call",
          content: "",
          toolName: "ExitPlanMode",
          toolInput: { plan: planText },
          // No toolResult yet — renders as "Preparing plan" shimmer
          timestamp: Date.now(),
        });
      }
      break;
    }

    case "turn/plan/updated": {
      const p = params as Record<string, unknown>;
      const plan = p.plan as Array<{ step: string; status: string }> | undefined;
      if (!plan) break;
      const todos = codexPlanToTodos(plan);
      const explanation = p.explanation as string | null | undefined;
      const planMsgId = `codex-plan-update-${state.codexPlanTurnCounter}`;
      const toolInput = { todos, ...(explanation ? { explanation } : {}) };
      const toolResult = { content: `Plan: ${plan.length} step${plan.length !== 1 ? "s" : ""}` };
      const existingMsg = state.messages.find(m => m.id === planMsgId);
      if (existingMsg) {
        existingMsg.toolInput = toolInput;
        existingMsg.toolResult = toolResult;
      } else {
        state.messages.push({
          id: planMsgId,
          role: "tool_call",
          content: "",
          toolName: "TodoWrite",
          toolInput,
          toolResult,
          timestamp: Date.now(),
        });
      }
      break;
    }
  }

  return undefined;
}
