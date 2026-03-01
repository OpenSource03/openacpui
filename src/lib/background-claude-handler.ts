import type {
  ClaudeEvent,
  StreamEvent,
  AssistantMessageEvent,
  ToolResultEvent,
  ResultEvent,
  SystemInitEvent,
  TaskProgressEvent,
  TaskNotificationEvent,
  SubagentToolStep,
} from "../types";
import {
  getParentId,
  extractTextContent,
  extractThinkingContent,
  normalizeToolResult,
} from "./protocol";
import { formatResultError } from "./message-factory";
import { bgAgentStore } from "./background-agent-store";
import type { InternalState } from "./background-session-store";

// ── Helpers ──

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ── Stream event handler ──

function handleStreamEvent(state: InternalState, event: StreamEvent): void {
  const streamEvt = event.event;

  switch (streamEvt.type) {
    case "message_start": {
      const id = nextId("stream-bg");
      state.currentStreamingMsgId = id;
      state.messages.push({
        id,
        role: "assistant",
        content: "",
        isStreaming: true,
        timestamp: Date.now(),
      });
      break;
    }

    case "content_block_delta": {
      if (!state.currentStreamingMsgId) break;
      const target = state.messages.find(
        (m) => m.id === state.currentStreamingMsgId,
      );
      if (!target) break;

      if (streamEvt.delta.type === "text_delta") {
        // Text arriving after thinking means thinking phase is over
        if (target.thinking && !target.thinkingComplete) {
          target.thinkingComplete = true;
        }
        target.content += streamEvt.delta.text;
      } else if (streamEvt.delta.type === "thinking_delta") {
        target.thinking =
          (target.thinking ?? "") + streamEvt.delta.thinking;
      }
      break;
    }

    case "message_delta": {
      if (!state.currentStreamingMsgId) break;
      const target = state.messages.find(
        (m) => m.id === state.currentStreamingMsgId,
      );
      if (target) {
        if (!target.content.trim() && !target.thinking) {
          state.messages = state.messages.filter(
            (m) => m.id !== target.id,
          );
        } else {
          target.isStreaming = false;
        }
      }
      state.currentStreamingMsgId = null;
      break;
    }

    case "message_stop": {
      state.currentStreamingMsgId = null;
      break;
    }
  }
}

// ── Subagent event handler ──

function handleSubagentEvent(
  state: InternalState,
  event: ClaudeEvent,
  parentId: string,
): void {
  const taskMsgId = state.parentToolMap.get(parentId);
  if (!taskMsgId) return;

  if (event.type === "assistant") {
    const evt = event as AssistantMessageEvent;
    for (const block of evt.message.content) {
      if (block.type === "tool_use") {
        const step: SubagentToolStep = {
          toolName: block.name,
          toolInput: block.input,
          toolUseId: block.id,
        };
        state.messages = state.messages.map((m) => {
          if (m.id !== taskMsgId) return m;
          return {
            ...m,
            subagentSteps: [...(m.subagentSteps ?? []), step],
          };
        });
      }
    }
  } else if (event.type === "user") {
    const evt = event as ToolResultEvent;
    const uc2 = evt.message.content;
    if (Array.isArray(uc2) && uc2[0]?.type === "tool_result") {
      const toolUseId = uc2[0].tool_use_id;
      const resultMeta = normalizeToolResult(
        evt.tool_use_result,
        uc2[0].content,
      );
      state.messages = state.messages.map((m) => {
        if (m.id !== taskMsgId) return m;
        const steps = (m.subagentSteps ?? []).map((s) =>
          s.toolUseId === toolUseId ? { ...s, toolResult: resultMeta } : s,
        );
        return { ...m, subagentSteps: steps };
      });
    }
  }
}

// ── Main Claude event handler ──

/**
 * Process a Claude SDK event for a background session, mutating `state` in place.
 * Returns `{ processingChanged: boolean, isProcessing: boolean }` when the
 * processing flag transitions, so the caller can fire the callback.
 */
export function handleClaudeEvent(
  state: InternalState,
  event: ClaudeEvent & { _sessionId?: string },
): { processingChanged: boolean; isProcessing: boolean } | undefined {
  const sessionId = event._sessionId;
  if (!sessionId) return undefined;

  // Route task progress/notification events to the shared background agent store.
  // task_started is NOT handled — it fires for all agents, not just background.
  // Background agents are registered from the tool_result with isAsync.
  if (event.type === "system" && "subtype" in event) {
    const sub = (event as { subtype: string }).subtype;
    if (sub === "task_progress") {
      bgAgentStore.handleTaskProgress(sessionId, event as TaskProgressEvent);
      return undefined;
    }
    if (sub === "task_notification") {
      bgAgentStore.handleTaskNotification(sessionId, event as TaskNotificationEvent);
      return undefined;
    }
  }

  const parentId = getParentId(event);

  if (parentId) {
    handleSubagentEvent(state, event, parentId);
    return undefined;
  }

  switch (event.type) {
    case "system": {
      // Skip status and compact_boundary subtypes — only process init
      if ("subtype" in event && (event.subtype === "status" || event.subtype === "compact_boundary")) {
        break;
      }
      const init = event as SystemInitEvent;
      state.sessionInfo = {
        sessionId: init.session_id,
        model: init.model,
        cwd: init.cwd,
        tools: init.tools,
        version: init.claude_code_version,
        permissionMode: init.permissionMode,
      };
      state.isConnected = true;
      state.isProcessing = true;
      return { processingChanged: true, isProcessing: true };
    }

    case "stream_event": {
      handleStreamEvent(state, event as StreamEvent);
      break;
    }

    case "assistant": {
      const evt = event as AssistantMessageEvent;
      const textContent = extractTextContent(evt.message.content);
      const thinkingContent = extractThinkingContent(evt.message.content);

      const target = state.currentStreamingMsgId
        ? state.messages.find((m) => m.id === state.currentStreamingMsgId)
        : state.messages.findLast(
            (m) => m.role === "assistant" && m.isStreaming,
          );

      if (target) {
        target.content = textContent || target.content;
        if (thinkingContent) {
          target.thinking = thinkingContent;
          target.thinkingComplete = true;
        }
        if (!target.content.trim() && !target.thinking) {
          state.messages = state.messages.filter((m) => m.id !== target.id);
        }
      } else if (textContent || thinkingContent) {
        state.messages.push({
          id: `assistant-${evt.uuid}`,
          role: "assistant",
          content: textContent,
          thinking: thinkingContent || undefined,
          ...(thinkingContent ? { thinkingComplete: true } : {}),
          isStreaming: false,
          timestamp: Date.now(),
        });
      }

      for (const block of evt.message.content) {
        if (block.type === "tool_use") {
          const isTask = block.name === "Task" || block.name === "Agent";
          const msgId = `tool-${block.id}`;
          if (!state.messages.some((m) => m.id === msgId)) {
            state.messages.push({
              id: msgId,
              role: "tool_call",
              content: "",
              toolName: block.name,
              toolInput: block.input,
              timestamp: Date.now(),
              ...(isTask
                ? {
                    subagentSteps: [],
                    subagentStatus: "running" as const,
                  }
                : {}),
            });
            if (isTask) {
              state.parentToolMap.set(block.id, msgId);
            }
          }
        }
      }
      break;
    }

    case "user": {
      const evt = event as ToolResultEvent;
      const uc = evt.message.content;

      // Task completion arrives as user text with <task-notification> XML
      if (typeof uc === "string" && uc.includes("<task-notification>")) {
        bgAgentStore.handleUserMessage(sessionId, uc);
      }

      if (Array.isArray(uc) && uc[0]?.type === "tool_result") {
        const toolResult = uc[0];
        const toolUseId = toolResult.tool_use_id;
        const toolName = state.messages.find((m) => m.id === `tool-${toolUseId}`)?.toolName;
        const isError = !!toolResult.is_error;
        const resultMeta = normalizeToolResult(
          evt.tool_use_result,
          toolResult.content,
        );

        // Register background (async) agents in the shared store
        if (resultMeta?.isAsync && resultMeta.outputFile && toolUseId) {
          bgAgentStore.registerAsyncAgent(sessionId, {
            toolUseId,
            agentId: resultMeta.agentId ?? toolUseId,
            description: String(resultMeta.description ?? "Background agent"),
            outputFile: resultMeta.outputFile,
          });
        }

        state.messages = state.messages.map((m) => {
          if (m.id !== `tool-${toolUseId}`) return m;
          if ((m.toolName === "Task" || m.toolName === "Agent") && resultMeta) {
            return {
              ...m,
              toolResult: resultMeta,
              subagentStatus: "completed" as const,
              subagentId: resultMeta.agentId,
              subagentDurationMs: resultMeta.totalDurationMs,
              subagentTokens: resultMeta.totalTokens,
            };
          }
          return { ...m, toolResult: resultMeta };
        });

        if (!isError && toolName === "EnterPlanMode" && state.sessionInfo) {
          state.sessionInfo = { ...state.sessionInfo, permissionMode: "plan" };
        }
      } else if (typeof uc === "string" && evt.uuid) {
        // Replayed user text message — stamp checkpoint UUID on first unmatched user message.
        // Mirrors the logic in useClaude.ts so background sessions also capture checkpoints.
        const userIdx = state.messages.findIndex(
          (m) => m.role === "user" && !m.checkpointId,
        );
        if (userIdx >= 0) {
          state.messages[userIdx] = { ...state.messages[userIdx], checkpointId: evt.uuid };
        }
      }
      break;
    }

    case "result": {
      const resultEvt = event as ResultEvent;
      state.isProcessing = false;
      state.totalCost += resultEvt.total_cost_usd ?? 0;

      // Surface SDK error results as system messages visible in chat
      if (resultEvt.is_error || resultEvt.subtype?.startsWith("error")) {
        const detail = resultEvt.errors?.join("; ") || resultEvt.result || "";
        const errorMsg = formatResultError(resultEvt.subtype, detail);
        state.messages.push({
          id: nextId("sys-err"),
          role: "system",
          content: errorMsg,
          isError: true,
          timestamp: Date.now(),
        });
      }
      return { processingChanged: true, isProcessing: false };
    }
  }

  return undefined;
}
