import type {
  ClaudeEvent,
  StreamEvent,
  SystemInitEvent,
  AssistantMessageEvent,
  ToolResultEvent,
  ResultEvent,
  UIMessage,
  SessionInfo,
  PermissionRequest,
  SubagentToolStep,
} from "../types";
import type { ACPSessionEvent, ACPPermissionEvent } from "../types/acp";
import type { CodexSessionEvent } from "../types/codex";
import { codexItemToToolName, codexItemToToolInput, codexItemToToolResult } from "./codex-adapter";
import type { CodexThreadItem } from "../types/codex";
import {
  getParentId,
  extractTextContent,
  extractThinkingContent,
  normalizeToolResult,
} from "./protocol";
import {
  normalizeToolInput as acpNormalizeToolInput,
  normalizeToolResult as acpNormalizeToolResult,
  deriveToolName,
} from "./acp-adapter";

export interface BackgroundSessionState {
  messages: UIMessage[];
  isProcessing: boolean;
  isConnected: boolean;
  sessionInfo: SessionInfo | null;
  totalCost: number;
  pendingPermission: PermissionRequest | null;
  /** Raw ACP permission event — needed for optionId lookup when responding */
  rawAcpPermission: ACPPermissionEvent | null;
}

interface InternalState extends BackgroundSessionState {
  parentToolMap: Map<string, string>;
  currentStreamingMsgId: string | null;
}

/** Callback fired when a background session receives a permission request */
type PermissionRequestCallback = (sessionId: string, permission: PermissionRequest) => void;

/**
 * Accumulates UIMessages for sessions not currently active in useClaude.
 * Prevents event loss when switching between sessions with ongoing responses.
 */
export class BackgroundSessionStore {
  private sessions = new Map<string, InternalState>();
  private idCounter = 0;
  onProcessingChange?: (sessionId: string, isProcessing: boolean) => void;
  onPermissionRequest?: PermissionRequestCallback;

  private nextId(prefix: string): string {
    return `${prefix}-${Date.now()}-${this.idCounter++}`;
  }

  private formatResultError(subtype: string, detail: string): string {
    switch (subtype) {
      case "error_max_turns":
        return "Session reached the maximum number of turns. Start a new session to continue.";
      case "error_max_budget_usd":
        return "Session exceeded the cost budget limit.";
      case "error_max_structured_output_retries":
        return "Structured output failed after maximum retries.";
      case "error_during_execution":
        return detail || "An error occurred during execution.";
      default:
        return detail || "An unexpected error occurred.";
    }
  }

  private getOrCreate(sessionId: string): InternalState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        messages: [],
        isProcessing: false,
        isConnected: false,
        sessionInfo: null,
        totalCost: 0,
        pendingPermission: null,
        rawAcpPermission: null,
        parentToolMap: new Map(),
        currentStreamingMsgId: null,
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  handleEvent(event: ClaudeEvent & { _sessionId?: string }): void {
    const sessionId = event._sessionId;
    if (!sessionId) return;

    const state = this.getOrCreate(sessionId);
    const parentId = getParentId(event);

    if (parentId) {
      this.handleSubagentEvent(state, event, parentId);
      return;
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
        };
        state.isConnected = true;
        state.isProcessing = true;
        this.onProcessingChange?.(sessionId, true);
        break;
      }

      case "stream_event": {
        this.handleStreamEvent(state, event as StreamEvent);
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
            const isTask = block.name === "Task";
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
        if (Array.isArray(uc) && uc[0]?.type === "tool_result") {
          const toolResult = uc[0];
          const toolUseId = toolResult.tool_use_id;
          const resultMeta = normalizeToolResult(
            evt.tool_use_result,
            toolResult.content,
          );

          state.messages = state.messages.map((m) => {
            if (m.id !== `tool-${toolUseId}`) return m;
            if (m.toolName === "Task" && resultMeta) {
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
        this.onProcessingChange?.(sessionId, false);
        state.totalCost += resultEvt.total_cost_usd ?? 0;

        // Surface SDK error results as system messages visible in chat
        if (resultEvt.is_error || resultEvt.subtype?.startsWith("error")) {
          const detail = resultEvt.errors?.join("; ") || resultEvt.result || "";
          const errorMsg = this.formatResultError(resultEvt.subtype, detail);
          state.messages.push({
            id: this.nextId("sys-err"),
            role: "system",
            content: errorMsg,
            isError: true,
            timestamp: Date.now(),
          });
        }
        break;
      }
    }
  }

  private handleStreamEvent(state: InternalState, event: StreamEvent): void {
    const streamEvt = event.event;

    switch (streamEvt.type) {
      case "message_start": {
        const id = this.nextId("stream-bg");
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

  private handleSubagentEvent(
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

  handleACPEvent(event: ACPSessionEvent): void {
    const sessionId = event._sessionId;
    if (!sessionId) return;

    const state = this.getOrCreate(sessionId);
    state.isConnected = true;
    const update = event.update;

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        this.closePendingACPTools(state);
        if (update.content?.type === "text" && update.content.text) {
          this.ensureACPStreamingMsg(state);
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
        this.closePendingACPTools(state);
        if (update.content?.type === "text" && update.content.text) {
          this.ensureACPStreamingMsg(state);
          const target = state.messages.find(m => m.id === state.currentStreamingMsgId);
          if (target) target.thinking = (target.thinking ?? "") + update.content.text;
        }
        break;
      }
      case "tool_call": {
        this.closePendingACPTools(state);
        // Finalize streaming message
        this.finalizeACPStreamingMsg(state);
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
            toolInput: acpNormalizeToolInput(update.rawInput, update.kind, update.locations, update.title),
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

  /** Handle ACP turn completion — finalize streaming, close tools, reset processing. */
  handleACPTurnComplete(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    this.finalizeACPStreamingMsg(state);
    this.closePendingACPTools(state);
    state.isProcessing = false;
    this.onProcessingChange?.(sessionId, false);
  }

  /** Ensure a streaming assistant message exists for ACP delta accumulation. */
  private ensureACPStreamingMsg(state: InternalState): void {
    if (state.currentStreamingMsgId) return;
    const id = this.nextId("stream-bg");
    state.currentStreamingMsgId = id;
    state.messages.push({
      id,
      role: "assistant",
      content: "",
      isStreaming: true,
      timestamp: Date.now(),
    });
  }

  /** Finalize the current ACP streaming message. */
  private finalizeACPStreamingMsg(state: InternalState): void {
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

  /** Mark pending ACP tool_call messages as completed (fast tools that skip tool_call_update). */
  private closePendingACPTools(state: InternalState): void {
    for (const msg of state.messages) {
      if (msg.role === "tool_call" && !msg.toolResult && !msg.toolError) {
        msg.toolResult = { status: "completed" };
      }
    }
  }

  // ── Codex background event handling ──

  /** Handle a Codex notification for a background (non-active) session. */
  handleCodexEvent(event: CodexSessionEvent): void {
    const sessionId = event._sessionId;
    if (!sessionId) return;

    const state = this.getOrCreate(sessionId);
    state.isConnected = true;
    const { method, params } = event;

    switch (method) {
      case "turn/started":
        state.isProcessing = true;
        this.onProcessingChange?.(sessionId, true);
        break;

      case "turn/completed":
        this.finalizeACPStreamingMsg(state); // reuse — same pattern
        state.isProcessing = false;
        this.onProcessingChange?.(sessionId, false);
        break;

      case "item/started": {
        const item = (params as Record<string, unknown>).item as CodexThreadItem | undefined;
        if (!item) break;
        if (item.type === "agentMessage") {
          this.ensureACPStreamingMsg(state); // reuse streaming msg pattern
        } else {
          const toolName = codexItemToToolName(item);
          if (toolName) {
            this.finalizeACPStreamingMsg(state);
            const msgId = `codex-tool-bg-${item.id}`;
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
          this.finalizeACPStreamingMsg(state);
        } else {
          const msgId = state.parentToolMap.get(item.id);
          if (msgId) {
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
        }
        break;
      }

      case "item/agentMessage/delta": {
        const delta = (params as Record<string, unknown>).delta as string | undefined;
        if (delta) {
          this.ensureACPStreamingMsg(state);
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
          this.ensureACPStreamingMsg(state);
          const target = state.messages.find(m => m.id === state.currentStreamingMsgId);
          if (target) target.thinking = (target.thinking ?? "") + delta;
        }
        break;
      }
    }
  }

  /** Store a pending permission for a background session and fire the callback. */
  setPermission(sessionId: string, permission: PermissionRequest, rawAcpPermission?: ACPPermissionEvent | null): void {
    const state = this.getOrCreate(sessionId);
    state.pendingPermission = permission;
    state.rawAcpPermission = rawAcpPermission ?? null;
    this.onPermissionRequest?.(sessionId, permission);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get(sessionId: string): BackgroundSessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    // Clone messages to prevent external mutation of internal state
    return {
      messages: state.messages.map(m => ({ ...m })),
      isProcessing: state.isProcessing,
      isConnected: state.isConnected,
      sessionInfo: state.sessionInfo ? { ...state.sessionInfo } : null,
      totalCost: state.totalCost,
      pendingPermission: state.pendingPermission ? { ...state.pendingPermission } : null,
      rawAcpPermission: state.rawAcpPermission,
    };
  }

  consume(sessionId: string): BackgroundSessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    // Transfer ownership — no clone needed since we delete the store entry
    this.sessions.delete(sessionId);
    return {
      messages: state.messages,
      isProcessing: state.isProcessing,
      isConnected: state.isConnected,
      sessionInfo: state.sessionInfo,
      totalCost: state.totalCost,
      pendingPermission: state.pendingPermission,
      rawAcpPermission: state.rawAcpPermission,
    };
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Seed store with current state when switching away from a live session. */
  initFromState(sessionId: string, state: BackgroundSessionState): void {
    const parentToolMap = new Map<string, string>();
    // Clone messages to prevent external mutation from leaking in
    const messages = state.messages.map(m => ({ ...m }));
    for (const msg of messages) {
      if (msg.role === "tool_call" && msg.subagentSteps !== undefined) {
        const toolUseId = msg.id.replace(/^tool-/, "");
        parentToolMap.set(toolUseId, msg.id);
      }
    }

    // Detect a mid-stream message so we can continue accumulating deltas
    const streamingMsg = messages.findLast(
      (m) => m.role === "assistant" && m.isStreaming,
    );

    this.sessions.set(sessionId, {
      messages,
      isProcessing: state.isProcessing,
      isConnected: state.isConnected,
      sessionInfo: state.sessionInfo ? { ...state.sessionInfo } : null,
      totalCost: state.totalCost,
      pendingPermission: state.pendingPermission ? { ...state.pendingPermission } : null,
      rawAcpPermission: state.rawAcpPermission ?? null,
      parentToolMap,
      currentStreamingMsgId: streamingMsg?.id ?? null,
    });
  }

  /** Mark a session as disconnected (process exited). */
  markDisconnected(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.isConnected = false;
    // Dead process = dead permission — clear both
    state.pendingPermission = null;
    state.rawAcpPermission = null;
    if (state.isProcessing) {
      state.isProcessing = false;
      this.onProcessingChange?.(sessionId, false);
    }
    for (const msg of state.messages) {
      if (msg.isStreaming) {
        msg.isStreaming = false;
      }
    }
  }
}
