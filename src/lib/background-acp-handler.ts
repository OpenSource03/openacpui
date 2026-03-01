import type { ACPSessionEvent } from "../types/acp";
import type { InternalState } from "./background-session-store";
import {
  normalizeToolInput as acpNormalizeToolInput,
  normalizeToolResult as acpNormalizeToolResult,
  deriveToolName,
} from "./acp-adapter";

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

/** Mark pending tool_call messages as completed (fast tools that skip tool_call_update). */
export function closePendingACPTools(state: InternalState): void {
  for (const msg of state.messages) {
    if (msg.role === "tool_call" && !msg.toolResult && !msg.toolError) {
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
      // Finalize streaming message
      finalizeACPStreamingMsg(state);
      const msgId = `tool-${update.toolCallId}`;
      if (!state.messages.some(m => m.id === msgId)) {
        // Handle pre-completed tools (tool arrives with status already set)
        const isAlreadyDone = update.status === "completed" || update.status === "failed";
        const initialResult = isAlreadyDone ? acpNormalizeToolResult(update.rawOutput, update.content) : undefined;
        state.messages.push({
          id: msgId,
          role: "tool_call",
          content: "",
          toolName: deriveToolName(update.title, update.kind),
          toolInput: acpNormalizeToolInput(update.rawInput, update.kind, update.locations),
          ...(initialResult ? { toolResult: initialResult } : {}),
          ...(update.status === "failed" ? { toolError: true } : {}),
          timestamp: Date.now(),
        });
      }
      break;
    }
    case "tool_call_update": {
      const msgId = `tool-${update.toolCallId}`;
      const msg = state.messages.find(m => m.id === msgId);
      if (msg) {
        const result = acpNormalizeToolResult(update.rawOutput, update.content);
        if (result) msg.toolResult = result;
        if (update.status === "failed") msg.toolError = true;
      }
      break;
    }
    case "usage_update": {
      if (update.cost) {
        state.totalCost += update.cost.amount;
      }
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
  state.isProcessing = false;
}
