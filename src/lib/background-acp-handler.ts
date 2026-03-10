import type { ACPSessionEvent } from "../types/acp";
import type { InternalState } from "./background-session-store";
import {
  mergeToolInput as acpMergeToolInput,
  normalizeToolInput as acpNormalizeToolInput,
  normalizeToolResult as acpNormalizeToolResult,
  deriveToolName,
} from "./acp-adapter";
import { extractTaskSubagentSteps, getTaskStatus, isTaskToolName } from "./acp-task-adapter";

// ── Shared ACP streaming helpers (also used by Codex handler) ──

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Ensure a streaming assistant message exists for delta accumulation. */
export function ensureACPStreamingMsg(state: InternalState): void {
  if (state.currentStreamingMsgId) return;
  const id = nextId("stream-bg");
  state.currentStreamingMsgId = id;
  state.messages.push({
    id,
    role: "assistant",
    content: "",
    isStreaming: true,
    timestamp: Date.now(),
  });
}

/** Finalize the current streaming message. */
export function finalizeACPStreamingMsg(state: InternalState): void {
  if (!state.currentStreamingMsgId) return;
  const target = state.messages.find(m => m.id === state.currentStreamingMsgId);
  if (target) {
    if (target.thinking && !target.thinkingComplete) {
      target.thinkingComplete = true;
    }
    target.isStreaming = false;
  }
  state.currentStreamingMsgId = null;
}

/** Mark pending tool_call messages as completed (fast tools that skip tool_call_update).
 *  Task/Agent tools are excluded — they stay open until their tool_call_update arrives. */
export function closePendingACPTools(state: InternalState): void {
  for (const msg of state.messages) {
    if (msg.role === "tool_call" && !msg.toolResult && !msg.toolError && !isTaskToolName(msg.toolName)) {
      msg.toolResult = { status: "completed" };
    }
  }
}

// ── ACP event handler ──

/**
 * Process an ACP session event for a background session, mutating `state` in place.
 */
export function handleACPEvent(state: InternalState, event: ACPSessionEvent): void {
  state.isConnected = true;
  const update = event.update;

  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      closePendingACPTools(state);
      if (update.content?.type === "text" && update.content.text) {
        // If an ACP task has inner tools running, accumulate text as task content
        if (state.activeTask?.hasInnerTools) {
          state.activeTask.textBuffer += update.content.text;
          break;
        }
        ensureACPStreamingMsg(state);
        const target = state.messages.find(m => m.id === state.currentStreamingMsgId);
        if (target) {
          // Text arriving means thinking phase is over
          if (target.thinking && !target.thinkingComplete) {
            target.thinkingComplete = true;
          }
          target.content += update.content.text;
        }
      }
      break;
    }
    case "agent_thought_chunk": {
      closePendingACPTools(state);
      if (update.content?.type === "text" && update.content.text) {
        ensureACPStreamingMsg(state);
        const target = state.messages.find(m => m.id === state.currentStreamingMsgId);
        if (target) target.thinking = (target.thinking ?? "") + update.content.text;
      }
      break;
    }
    case "tool_call": {
      closePendingACPTools(state);
      finalizeACPStreamingMsg(state);
      const msgId = `tool-${update.toolCallId}`;
      if (!state.messages.some(m => m.id === msgId)) {
        const isAlreadyDone = update.status === "completed" || update.status === "failed";
        const initialResult = isAlreadyDone ? acpNormalizeToolResult(update.rawOutput, update.content) : undefined;
        const toolName = deriveToolName(update.title, update.kind, update.rawInput);

        // Route as subagent step if there's an active task
        if (state.activeTask && !isTaskToolName(toolName)) {
          state.activeTask.hasInnerTools = true;
          const taskMsg = state.messages.find(m => m.id === state.activeTask!.msgId);
          if (taskMsg) {
            const step = {
              toolName,
              toolUseId: update.toolCallId,
              toolInput: acpNormalizeToolInput(update.rawInput, update.kind, update.locations),
              ...(initialResult ? { toolResult: initialResult } : {}),
              ...(update.status === "failed" ? { toolError: true } : {}),
            };
            taskMsg.subagentSteps = [...(taskMsg.subagentSteps ?? []), step];
          }
          break;
        }

        const isTask = isTaskToolName(toolName);
        const taskSteps = isTask ? extractTaskSubagentSteps(initialResult) : undefined;
        state.messages.push({
          id: msgId,
          role: "tool_call",
          content: "",
          toolName,
          toolInput: acpNormalizeToolInput(update.rawInput, update.kind, update.locations),
          ...(initialResult ? { toolResult: initialResult } : {}),
          ...(update.status === "failed" ? { toolError: true } : {}),
          ...(isTask ? { subagentStatus: getTaskStatus(update.status), subagentSteps: taskSteps ?? [] } : {}),
          timestamp: Date.now(),
        });
        // Start tracking if this is a Task tool
        if (isTask && !isAlreadyDone) {
          state.activeTask = { msgId, toolCallId: update.toolCallId, hasInnerTools: false, textBuffer: "" };
        }
      }
      break;
    }
    case "tool_call_update": {
      const result = acpNormalizeToolResult(update.rawOutput, update.content);

      // Check if this is for the active task itself
      if (state.activeTask && update.toolCallId === state.activeTask.toolCallId) {
        const taskMsg = state.messages.find(m => m.id === state.activeTask!.msgId);
        const isDone = update.status === "completed" || update.status === "failed" || update.status === "cancelled";

        if (isDone && taskMsg) {
          // Task finished — set final result with accumulated text, clear activeTask
          const textContent = state.activeTask.textBuffer;
          const finalResult = result ?? (textContent ? { content: textContent } : undefined);
          if (finalResult && textContent && typeof finalResult.content !== "string") {
            finalResult.content = textContent;
          }
          taskMsg.toolResult = finalResult ?? taskMsg.toolResult ?? { status: "completed" };
          if (update.status === "failed") taskMsg.toolError = true;
          taskMsg.subagentStatus = getTaskStatus(update.status);
          const taskSteps = extractTaskSubagentSteps(finalResult);
          if (taskSteps) taskMsg.subagentSteps = taskSteps;
          state.activeTask = null;
        } else if (taskMsg) {
          const updatedInput = acpMergeToolInput(taskMsg.toolInput, update.rawInput, update.kind, update.locations);
          if (updatedInput) {
            taskMsg.toolInput = updatedInput;
          }
        }
        break;
      }

      // Check if this updates a subagent step inside the active task
      if (state.activeTask) {
        const taskMsg = state.messages.find(m => m.id === state.activeTask!.msgId);
        if (taskMsg) {
          const step = (taskMsg.subagentSteps ?? []).find(s => s.toolUseId === update.toolCallId);
          if (step) {
            step.toolInput = acpMergeToolInput(step.toolInput, update.rawInput, update.kind, update.locations) ?? step.toolInput;
            if (result) step.toolResult = result;
            else if (!step.toolResult) step.toolResult = { status: "completed" };
            if (update.status === "failed") step.toolError = true;
            break;
          }
        }
      }

      // Normal tool_call_update for top-level tools
      const msgId = `tool-${update.toolCallId}`;
      const msg = state.messages.find(m => m.id === msgId);
      if (msg) {
        msg.toolInput = acpMergeToolInput(msg.toolInput, update.rawInput, update.kind, update.locations) ?? msg.toolInput;
        if (result) msg.toolResult = result;
        if (update.status === "failed") msg.toolError = true;
        if (isTaskToolName(msg.toolName)) {
          msg.subagentStatus = getTaskStatus(update.status);
          const taskSteps = extractTaskSubagentSteps(result);
          if (taskSteps) msg.subagentSteps = taskSteps;
        }
      }
      break;
    }
    case "usage_update": {
      if (update.size != null || update.used != null) {
        state.contextUsage = {
          inputTokens: update.used ?? state.contextUsage?.inputTokens ?? 0,
          outputTokens: state.contextUsage?.outputTokens ?? 0,
          cacheReadTokens: state.contextUsage?.cacheReadTokens ?? 0,
          cacheCreationTokens: state.contextUsage?.cacheCreationTokens ?? 0,
          contextWindow: update.size ?? state.contextUsage?.contextWindow ?? 0,
        };
      }
      if (update.cost) {
        state.totalCost += update.cost.amount;
      }
      break;
    }
    case "available_commands_update": {
      const acu = update as { availableCommands?: Array<{ name: string; description: string; input?: { hint?: string } }> };
      state.slashCommands = (acu.availableCommands ?? []).map(cmd => ({
        name: cmd.name,
        description: cmd.description ?? "",
        argumentHint: cmd.input?.hint,
        source: "acp" as const,
      }));
      break;
    }
  }
}

/**
 * Handle ACP turn completion — finalize streaming, close tools, reset processing.
 * Returns true so the caller knows to fire onProcessingChange.
 */
export function handleACPTurnComplete(state: InternalState): void {
  finalizeACPStreamingMsg(state);
  closePendingACPTools(state);
  state.activeTask = null;
  state.isProcessing = false;
}
