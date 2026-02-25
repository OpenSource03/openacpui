/**
 * useCodex — renderer-side hook for Codex app-server sessions.
 *
 * Manages Codex event subscriptions, streaming text via rAF batching,
 * tool call state, and approval bridging. Returns the same interface shape
 * as useClaude/useACP so useSessionManager can dispatch generically.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { UIMessage, PermissionRequest, SessionInfo, ContextUsage, TodoItem, PermissionBehavior, ModelInfo } from "@/types";
import type { CodexSessionEvent, CodexApprovalRequest, CodexExitEvent } from "@/types/codex";
import type { CodexThreadItem } from "@/types/codex";
import {
  CodexStreamingBuffer,
  codexItemToToolName,
  codexItemToToolInput,
  codexItemToToolResult,
  codexPlanToTodos,
} from "@/lib/codex-adapter";

interface UseCodexOptions {
  sessionId: string | null;
  initialMessages?: UIMessage[];
  initialMeta?: {
    isProcessing: boolean;
    isConnected: boolean;
    sessionInfo: SessionInfo | null;
    totalCost: number;
  } | null;
  initialPermission?: PermissionRequest | null;
}

let codexIdCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${codexIdCounter++}`;
}

export function useCodex({ sessionId, initialMessages, initialMeta, initialPermission }: UseCodexOptions) {
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages ?? []);
  const [isProcessing, setIsProcessing] = useState(initialMeta?.isProcessing ?? false);
  const [isConnected, setIsConnected] = useState(initialMeta?.isConnected ?? false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(initialMeta?.sessionInfo ?? null);
  const [totalCost, setTotalCost] = useState(initialMeta?.totalCost ?? 0);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(initialPermission ?? null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [codexModels, setCodexModels] = useState<ModelInfo[]>([]);
  /** Reasoning effort for the current Codex session — sent on the next turn/start */
  const [codexEffort, setCodexEffort] = useState<string>("medium");

  // Refs for rAF streaming flush (avoid React 19 batching issues)
  const bufferRef = useRef(new CodexStreamingBuffer());
  const rafRef = useRef<number | null>(null);
  const sessionIdRef = useRef(sessionId);
  const approvalRef = useRef<CodexApprovalRequest | null>(null);
  // Map Codex itemId → UIMessage id for updating tool_call messages
  const itemMapRef = useRef(new Map<string, string>());
  // Track command output per itemId
  const commandOutputRef = useRef(new Map<string, string>());

  // Sync sessionId ref
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Reset state when sessionId changes
  useEffect(() => {
    if (!sessionId) {
      setMessages(initialMessages ?? []);
      setIsProcessing(initialMeta?.isProcessing ?? false);
      setIsConnected(initialMeta?.isConnected ?? false);
      setSessionInfo(initialMeta?.sessionInfo ?? null);
      setTotalCost(initialMeta?.totalCost ?? 0);
      setPendingPermission(initialPermission ?? null);
      setContextUsage(null);
      setIsCompacting(false);
      setTodoItems([]);
      bufferRef.current.reset();
      itemMapRef.current.clear();
      commandOutputRef.current.clear();
      approvalRef.current = null;
    } else {
      setIsConnected(true);
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── rAF flush: push streaming buffer contents into React state ──
  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const buf = bufferRef.current;
      if (!buf.messageId) return;

      const text = buf.getText();
      const thinking = buf.getThinking();
      const thinkingComplete = buf.thinkingComplete;

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === buf.messageId);
        if (idx === -1) return prev;
        const msg = prev[idx];
        if (msg.content === text && msg.thinking === thinking && msg.thinkingComplete === thinkingComplete) return prev;
        const updated = [...prev];
        updated[idx] = {
          ...msg,
          content: text,
          thinking: thinking || undefined,
          thinkingComplete,
          isStreaming: true,
        };
        return updated;
      });
    });
  }, []);

  // ── Notification handler ──
  const handleNotification = useCallback((event: CodexSessionEvent) => {
    if (event._sessionId !== sessionIdRef.current) return;
    const { method, params } = event;

    switch (method) {
      case "turn/started":
        setIsProcessing(true);
        break;

      case "turn/completed":
        handleTurnComplete(params);
        break;

      case "item/started":
        handleItemStarted(params);
        break;

      case "item/completed":
        handleItemCompleted(params);
        break;

      case "item/agentMessage/delta":
        handleAgentDelta(params);
        break;

      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        handleReasoningDelta(params);
        break;

      case "item/commandExecution/outputDelta":
        handleCommandOutputDelta(params);
        break;

      case "thread/tokenUsage/updated":
        handleTokenUsage(params);
        break;

      case "turn/plan/updated":
        handlePlanUpdate(params);
        break;

      case "thread/compacted":
        handleCompacted();
        setMessages((prev) => [
          ...prev,
          {
            id: nextId("compact"),
            role: "summary",
            content: "Context compacted",
            timestamp: Date.now(),
            compactTrigger: "auto",
          },
        ]);
        break;

      case "codex:auth_required":
        // Auth required — UI will handle this
        break;

      case "error": {
        const errMsg = (params as Record<string, unknown>).error as Record<string, unknown> | undefined;
        const errorText = errMsg?.message ? String(errMsg.message) : "Unknown error";
        setMessages((prev) => [
          ...prev,
          {
            id: nextId("err"),
            role: "system",
            content: errorText,
            timestamp: Date.now(),
            isError: true,
          },
        ]);
        break;
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Item started: create UIMessage for tool calls, start streaming for agentMessage ──
  const handleItemStarted = useCallback((params: Record<string, unknown>) => {
    const item = params.item as CodexThreadItem | undefined;
    if (!item) return;

    if (item.type === "agentMessage") {
      // Start or continue streaming assistant message
      const buf = bufferRef.current;
      if (!buf.messageId) {
        const msgId = nextId("codex-msg");
        buf.messageId = msgId;
        setMessages((prev) => [
          ...prev,
          {
            id: msgId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            isStreaming: true,
          },
        ]);
      }
    } else if (item.type === "reasoning") {
      // Start thinking on the current streaming message
      const buf = bufferRef.current;
      if (!buf.messageId) {
        const msgId = nextId("codex-msg");
        buf.messageId = msgId;
        setMessages((prev) => [
          ...prev,
          {
            id: msgId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            isStreaming: true,
          },
        ]);
      }
    } else {
      // contextCompaction is handled via thread/compacted notification, not item/started
      // Tool-type item — create a tool_call message
      const toolName = codexItemToToolName(item);
      if (toolName) {
        const msgId = nextId("codex-tool");
        itemMapRef.current.set(item.id, msgId);
        setMessages((prev) => [
          ...prev,
          {
            id: msgId,
            role: "tool_call",
            content: "",
            toolName,
            toolInput: codexItemToToolInput(item),
            timestamp: Date.now(),
          },
        ]);
      }
    }
  }, []);

  // ── Item completed: finalize tool call with result ──
  const handleItemCompleted = useCallback((params: Record<string, unknown>) => {
    const item = params.item as CodexThreadItem | undefined;
    if (!item) return;

    if (item.type === "agentMessage") {
      // Finalize streaming message
      const buf = bufferRef.current;
      if (buf.messageId) {
        const finalText = (item as Record<string, unknown>).text as string | undefined;
        if (finalText) {
          buf.appendText(""); // no-op but ensures flush
        }
        // Mark not streaming
        setMessages((prev) =>
          prev.map((m) =>
            m.id === buf.messageId
              ? { ...m, content: finalText ?? buf.getText(), isStreaming: false }
              : m,
          ),
        );
        buf.reset();
      }
      return;
    }

    // Finalize tool_call messages
    const msgId = itemMapRef.current.get(item.id);
    if (!msgId) return;

    const toolResult = codexItemToToolResult(item);
    const isError =
      (item.type === "commandExecution" && (item.status === "failed" || item.status === "declined")) ||
      (item.type === "fileChange" && (item.status === "failed" || item.status === "declined")) ||
      (item.type === "mcpToolCall" && item.status === "failed");

    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? {
              ...m,
              toolResult: toolResult ?? m.toolResult,
              toolError: isError || undefined,
              // For command execution, also include accumulated output
              ...(item.type === "commandExecution" && commandOutputRef.current.has(item.id)
                ? {
                    toolResult: {
                      content: commandOutputRef.current.get(item.id)! +
                        (item.exitCode != null ? `\nExit code: ${item.exitCode}` : ""),
                    },
                  }
                : {}),
            }
          : m,
      ),
    );

    itemMapRef.current.delete(item.id);
    commandOutputRef.current.delete(item.id);
  }, []);

  // ── Agent message delta: accumulate text for rAF flush ──
  const handleAgentDelta = useCallback((params: Record<string, unknown>) => {
    const delta = params.delta as string | undefined;
    if (!delta) return;

    const buf = bufferRef.current;
    // Mark thinking as done when text starts arriving
    if (buf.getThinking() && !buf.thinkingComplete) {
      buf.thinkingComplete = true;
    }
    buf.appendText(delta);
    scheduleFlush();
  }, [scheduleFlush]);

  // ── Reasoning delta: accumulate thinking text ──
  const handleReasoningDelta = useCallback((params: Record<string, unknown>) => {
    const delta = params.delta as string | undefined;
    if (!delta) return;

    bufferRef.current.appendThinking(delta);
    scheduleFlush();
  }, [scheduleFlush]);

  // ── Command output delta: stream into tool_call ──
  const handleCommandOutputDelta = useCallback((params: Record<string, unknown>) => {
    const itemId = params.itemId as string | undefined;
    const delta = params.delta as string | undefined;
    if (!itemId || !delta) return;

    const existing = commandOutputRef.current.get(itemId) ?? "";
    commandOutputRef.current.set(itemId, existing + delta);

    // Update the tool_call message with live output
    const msgId = itemMapRef.current.get(itemId);
    if (msgId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, toolResult: { content: commandOutputRef.current.get(itemId)! } }
            : m,
        ),
      );
    }
  }, []);

  // ── Turn complete: finalize everything ──
  const handleTurnComplete = useCallback((params: Record<string, unknown>) => {
    setIsProcessing(false);

    // Finalize any lingering streaming message
    const buf = bufferRef.current;
    if (buf.messageId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === buf.messageId ? { ...m, isStreaming: false } : m,
        ),
      );
      buf.reset();
    }

    // Check for failed turn
    const turn = params.turn as Record<string, unknown> | undefined;
    if (turn?.status === "failed") {
      const error = turn.error as Record<string, unknown> | undefined;
      const msg = error?.message ? String(error.message) : "Turn failed";
      setMessages((prev) => [
        ...prev,
        {
          id: nextId("err"),
          role: "system",
          content: msg,
          timestamp: Date.now(),
          isError: true,
        },
      ]);
    }
  }, []);

  // ── Token usage ──
  const handleTokenUsage = useCallback((params: Record<string, unknown>) => {
    const usage = params as Record<string, unknown>;
    setContextUsage({
      inputTokens: (usage.inputTokens as number) ?? 0,
      outputTokens: (usage.outputTokens as number) ?? 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      contextWindow: 200000, // Default context window
    });
  }, []);

  // ── Plan updates ──
  const handlePlanUpdate = useCallback((params: Record<string, unknown>) => {
    const plan = params.plan as Array<{ step: string; status: string }> | undefined;
    if (plan) {
      setTodoItems(codexPlanToTodos(plan));
    }
  }, []);

  // ── Compaction ──
  const handleCompacted = useCallback(() => {
    setIsCompacting(false);
  }, []);

  // ── Approval handling ──
  const handleApproval = useCallback((data: CodexApprovalRequest) => {
    if (data._sessionId !== sessionIdRef.current) return;

    approvalRef.current = data;
    const isCommand = data.method === "item/commandExecution/requestApproval";

    setPendingPermission({
      requestId: String(data.rpcId),
      toolName: isCommand ? "Bash" : "Edit",
      toolInput: isCommand ? {} : {},
      toolUseId: data.itemId,
    });
  }, []);

  // ── Exit handling ──
  const handleExit = useCallback((data: CodexExitEvent) => {
    if (data._sessionId !== sessionIdRef.current) return;
    setIsConnected(false);
    setIsProcessing(false);
  }, []);

  // ── Subscribe to events ──
  useEffect(() => {
    if (!sessionId) return;

    const unsubEvent = window.claude.codex.onEvent(handleNotification);
    const unsubApproval = window.claude.codex.onApprovalRequest(handleApproval);
    const unsubExit = window.claude.codex.onExit(handleExit);

    return () => {
      unsubEvent();
      unsubApproval();
      unsubExit();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [sessionId, handleNotification, handleApproval, handleExit]);

  // ── Actions ──
  const send = useCallback(
    async (text: string, images?: unknown[]) => {
      if (!sessionId) return;
      // Add user message to UI immediately
      setMessages((prev) => [
        ...prev,
        {
          id: nextId("user"),
          role: "user",
          content: text,
          timestamp: Date.now(),
        },
      ]);
      setIsProcessing(true);
      await window.claude.codex.send(sessionId, text, images, codexEffort);
    },
    [sessionId, codexEffort],
  );

  const sendRaw = send; // Codex doesn't differentiate

  const stop = useCallback(async () => {
    if (!sessionId) return;
    await window.claude.codex.stop(sessionId);
  }, [sessionId]);

  const interrupt = useCallback(async () => {
    if (!sessionId) return;
    await window.claude.codex.interrupt(sessionId);
  }, [sessionId]);

  const compact = useCallback(async () => {
    if (!sessionId) return;
    setIsCompacting(true);
    await window.claude.codex.compact(sessionId);
  }, [sessionId]);

  const respondPermission = useCallback(
    async (behavior: PermissionBehavior, _updatedInput?: Record<string, unknown>, _newPermissionMode?: string) => {
      if (!sessionId || !approvalRef.current) return;
      const rpcId = approvalRef.current.rpcId;
      const decision = behavior === "allow" ? "accept" : behavior === "allowForSession" ? "accept" : "decline";
      const acceptSettings = behavior === "allowForSession" ? { forSession: true } : undefined;
      await window.claude.codex.respondApproval(sessionId, rpcId, decision, acceptSettings);
      setPendingPermission(null);
      approvalRef.current = null;
    },
    [sessionId],
  );

  const setPermissionMode = useCallback(async (_mode: string) => {
    // Codex doesn't support live permission mode changes — applied on next turn
  }, []);

  return {
    messages, setMessages,
    isProcessing, setIsProcessing,
    isConnected, setIsConnected,
    sessionInfo, setSessionInfo,
    totalCost, setTotalCost,
    contextUsage,
    isCompacting,
    send, sendRaw, stop, interrupt, compact,
    pendingPermission, respondPermission,
    setPermissionMode,
    todoItems,
    codexModels, setCodexModels,
    codexEffort, setCodexEffort,
  };
}
