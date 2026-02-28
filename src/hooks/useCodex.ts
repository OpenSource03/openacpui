/**
 * useCodex — renderer-side hook for Codex app-server sessions.
 *
 * Manages Codex event subscriptions, streaming text via rAF batching,
 * tool call state, and approval bridging. Returns the same interface shape
 * as useClaude/useACP so useSessionManager can dispatch generically.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { UIMessage, PermissionRequest, SessionInfo, ContextUsage, TodoItem, PermissionBehavior, ModelInfo, ImageAttachment } from "@/types";
import type { CodexSessionEvent, CodexServerRequest, CodexExitEvent } from "@/types/codex";
import type { CodexThreadItem } from "@/types/codex";
import type { CodexTokenUsageNotification } from "@/types/codex";
import type { CollaborationMode } from "@/types/codex-protocol/CollaborationMode";
import {
  CodexStreamingBuffer,
  codexItemToToolName,
  codexItemToToolInput,
  codexItemToToolResult,
  codexPlanToTodos,
  imageAttachmentsToCodexInputs,
} from "@/lib/codex-adapter";

interface UseCodexOptions {
  sessionId: string | null;
  sessionModel?: string;
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

interface CodexQuestionOption {
  label: string;
  description: string;
}

interface CodexQuestionInput {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options?: CodexQuestionOption[];
  multiSelect: boolean;
}

export function useCodex({ sessionId, sessionModel, initialMessages, initialMeta, initialPermission }: UseCodexOptions) {
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
  const messagesRef = useRef<UIMessage[]>(messages);
  messagesRef.current = messages;

  // Refs for rAF streaming flush (avoid React 19 batching issues)
  const bufferRef = useRef(new CodexStreamingBuffer());
  const rafRef = useRef<number | null>(null);
  const sessionIdRef = useRef(sessionId);
  const sessionModelRef = useRef(sessionModel);
  const serverRequestRef = useRef<CodexServerRequest | null>(null);
  // Map Codex itemId → UIMessage id for updating tool_call messages
  const itemMapRef = useRef(new Map<string, string>());
  // Map Codex assistant itemId (reasoning/agentMessage) → assistant UIMessage id
  const assistantItemMapRef = useRef(new Map<string, string>());
  // Currently active assistant item id (used when deltas omit itemId unexpectedly)
  const activeAssistantItemIdRef = useRef<string | null>(null);
  // Track command output per itemId
  const commandOutputRef = useRef(new Map<string, string>());
  // Accumulate plan text from item/plan/delta events
  const planTextRef = useRef("");
  // Per-turn counter for unique plan card message IDs
  const planTurnCounterRef = useRef(0);

  // Sync sessionId ref
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    sessionModelRef.current = sessionModel;
  }, [sessionModel]);

  // Reset state when sessionId changes
  useEffect(() => {
    setMessages(initialMessages ?? []);
    setIsProcessing(initialMeta?.isProcessing ?? false);
    setIsConnected(initialMeta?.isConnected ?? false);
    setSessionInfo(initialMeta?.sessionInfo ?? null);
    setTotalCost(initialMeta?.totalCost ?? 0);
    setPendingPermission(initialPermission ?? null);
    setContextUsage(null);
    setIsCompacting(false);
    setTodoItems([]);
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    bufferRef.current.reset();
    itemMapRef.current.clear();
    assistantItemMapRef.current.clear();
    activeAssistantItemIdRef.current = null;
    commandOutputRef.current.clear();
    serverRequestRef.current = null;

    // Rebuild Codex tool mappings from restored messages so completions
    // arriving after switch-back can find their tool_call messages
    if (initialMessages) {
      for (const msg of initialMessages) {
        if (msg.role === "tool_call" && msg.id.startsWith("codex-tool-")) {
          const itemId = msg.id.replace("codex-tool-", "");
          itemMapRef.current.set(itemId, msg.id);
          // Seed command output accumulator to preserve background-accumulated output
          if (typeof msg.toolResult?.stdout === "string") {
            commandOutputRef.current.set(itemId, msg.toolResult.stdout);
          }
        }
      }
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── rAF flush: push streaming buffer contents into React state ──
  const flushBufferToState = useCallback(() => {
    const buf = bufferRef.current;
    if (!buf.messageId) return;

    const messageId = buf.messageId;
    const text = buf.getText();
    const thinking = buf.getThinking();
    const thinkingComplete = buf.thinkingComplete;

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
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
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      flushBufferToState();
    });
  }, [flushBufferToState]);

  const rebindBufferToMessage = useCallback((messageId: string) => {
    const target = messagesRef.current.find((m) => m.id === messageId);
    if (!target) return;

    const buf = bufferRef.current;
    if (buf.messageId === messageId) return;

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    buf.reset();
    buf.messageId = messageId;
    if (target.content) buf.appendText(target.content);
    if (target.thinking) {
      buf.appendThinking(target.thinking);
      if (target.thinkingComplete) buf.thinkingComplete = true;
    }
  }, []);

  const ensureStreamingAssistantMessage = useCallback((): string => {
    const buf = bufferRef.current;
    if (buf.messageId) return buf.messageId;

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
    return msgId;
  }, []);

  const bindAssistantItem = useCallback((itemId: string): string => {
    const msgId = ensureStreamingAssistantMessage();
    assistantItemMapRef.current.set(itemId, msgId);
    activeAssistantItemIdRef.current = itemId;
    rebindBufferToMessage(msgId);
    return msgId;
  }, [ensureStreamingAssistantMessage, rebindBufferToMessage]);

  const finalizeStreamingAssistant = useCallback(() => {
    const buf = bufferRef.current;
    if (!buf.messageId) return;

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const msgId = buf.messageId;
    const text = buf.getText();
    const thinking = buf.getThinking();
    const thinkingComplete = buf.thinkingComplete;

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const mergedThinking = thinking || m.thinking;
        return {
          ...m,
          content: text || m.content,
          ...(mergedThinking ? { thinking: mergedThinking } : {}),
          ...(mergedThinking ? { thinkingComplete: thinkingComplete || m.thinkingComplete } : {}),
          isStreaming: false,
        };
      }),
    );

    buf.reset();
    activeAssistantItemIdRef.current = null;
  }, []);

  // ── Notification handler ──
  const handleNotification = useCallback((event: CodexSessionEvent) => {
    if (event._sessionId !== sessionIdRef.current) return;
    switch (event.method) {
      case "turn/started":
        setIsProcessing(true);
        planTextRef.current = ""; // Reset plan accumulator for new turn
        planTurnCounterRef.current += 1; // New turn → new plan card ID
        break;

      case "turn/completed":
        handleTurnComplete(event.params);
        break;

      case "item/started":
        handleItemStarted(event.params);
        break;

      case "item/completed":
        handleItemCompleted(event.params);
        break;

      case "item/agentMessage/delta":
        handleAgentDelta(event.params);
        break;

      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        handleReasoningDelta(event.params);
        break;

      case "item/commandExecution/outputDelta":
        handleCommandOutputDelta(event.params);
        break;

      case "thread/tokenUsage/updated":
        handleTokenUsage(event.params);
        break;

      case "turn/plan/updated":
        handlePlanUpdate(event.params);
        break;

      case "item/plan/delta":
        handlePlanDelta(event.params);
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
        const errMsg = (event.params as Record<string, unknown>).error as Record<string, unknown> | undefined;
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

    if (item.type === "agentMessage" || item.type === "reasoning") {
      bindAssistantItem(item.id);
      return;
    }

    // Any non-assistant item (tools/plan/etc.) is a hard boundary. Finalize the
    // previous assistant stream so future deltas append below these items.
    finalizeStreamingAssistant();

    // contextCompaction is handled via thread/compacted notification, not item/started
    // Tool-type item — create a tool_call message
    const toolName = codexItemToToolName(item);
    if (toolName) {
      // Deterministic ID so background-restored sessions can still match completions
      const msgId = `codex-tool-${item.id}`;
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
  }, [bindAssistantItem, finalizeStreamingAssistant]);

  // ── Item completed: finalize tool call with result ──
  const handleItemCompleted = useCallback((params: Record<string, unknown>) => {
    const item = params.item as CodexThreadItem | undefined;
    if (!item) return;

    if (item.type === "agentMessage") {
      const finalText = (item as Record<string, unknown>).text as string | undefined;
      const mappedMsgId = assistantItemMapRef.current.get(item.id) ?? bufferRef.current.messageId;
      const bufferedTextForItem =
        mappedMsgId && bufferRef.current.messageId === mappedMsgId
          ? bufferRef.current.getText()
          : undefined;
      if (mappedMsgId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === mappedMsgId
              ? {
                  ...m,
                  content: finalText ?? bufferedTextForItem ?? m.content,
                  ...(m.thinking ? { thinkingComplete: true } : {}),
                  isStreaming: false,
                }
              : m,
          ),
        );
      } else if (finalText) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId("codex-msg"),
            role: "assistant",
            content: finalText,
            timestamp: Date.now(),
            isStreaming: false,
          },
        ]);
      }

      assistantItemMapRef.current.delete(item.id);
      if (activeAssistantItemIdRef.current === item.id) {
        activeAssistantItemIdRef.current = null;
      }
      if (mappedMsgId && bufferRef.current.messageId === mappedMsgId) {
        bufferRef.current.reset();
      }
      return;
    }

    if (item.type === "reasoning") {
      const mappedMsgId = assistantItemMapRef.current.get(item.id);
      if (mappedMsgId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === mappedMsgId
              ? { ...m, ...(m.thinking ? { thinkingComplete: true } : {}) }
              : m,
          ),
        );
      }
      assistantItemMapRef.current.delete(item.id);
      if (activeAssistantItemIdRef.current === item.id) {
        activeAssistantItemIdRef.current = null;
      }
      return;
    }

    // Finalize plan item — mark as completed ExitPlanMode tool_call (matching Claude's rendering)
    // Then spawn a fake ExitPlanMode permission prompt so the user can pick how to implement.
    if (item.type === "plan") {
      finalizeStreamingAssistant();
      const finalText = (item as Record<string, unknown>).text as string | undefined;
      const planContent = finalText ?? planTextRef.current;
      if (planContent) {
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === "codex-plan-stream");
          if (existing) {
            // Add toolResult to mark it as completed — switches from "Preparing plan" to "Presented plan"
            return prev.map((m) =>
              m.id === "codex-plan-stream"
                ? { ...m, toolInput: { plan: planContent }, toolResult: { type: "plan" } }
                : m,
            );
          }
          // No streaming message existed — create the final tool_call directly
          return [
            ...prev,
            {
              id: nextId("plan"),
              role: "tool_call" as const,
              content: "",
              toolName: "ExitPlanMode",
              toolInput: { plan: planContent },
              toolResult: { type: "plan" },
              timestamp: Date.now(),
            },
          ];
        });

        // Ensure sessionInfo has permissionMode "plan" so AppLayout's sync effect
        // can toggle plan mode off when the user accepts ExitPlanMode.
        setSessionInfo((prev) => prev
          ? { ...prev, permissionMode: "plan" }
          : { permissionMode: "plan" } as SessionInfo,
        );

        // Synthesize a fake ExitPlanMode permission prompt — reuses the same
        // ExitPlanModePrompt UI that Claude shows ("Ready to implement. How should
        // permissions work?" with Accept Edits / Ask First / Allow All / Stay in Plan).
        setPendingPermission({
          requestId: `codex-plan-${Date.now()}`,
          toolName: "ExitPlanMode",
          toolInput: {},
          toolUseId: "codex-plan",
        });
      }
      return;
    }

    // Finalize tool_call messages — deterministic fallback works even if
    // itemMapRef was cleared after a session switch
    const msgId = itemMapRef.current.get(item.id) ?? `codex-tool-${item.id}`;

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
                      type: "text",
                      stdout: commandOutputRef.current.get(item.id)! +
                        (item.exitCode != null ? `\nExit code: ${item.exitCode}` : "") +
                        (item.durationMs != null ? `\nDuration: ${item.durationMs}ms` : ""),
                      ...(item.exitCode != null ? { exitCode: item.exitCode } : {}),
                      ...(item.durationMs != null ? { durationMs: item.durationMs } : {}),
                    },
                  }
                : {}),
            }
          : m,
      ),
    );

    itemMapRef.current.delete(item.id);
    commandOutputRef.current.delete(item.id);
  }, [finalizeStreamingAssistant]);

  // ── Agent message delta: accumulate text for rAF flush ──
  const handleAgentDelta = useCallback((params: Record<string, unknown>) => {
    const itemId = params.itemId as string | undefined;
    const delta = params.delta as string | undefined;
    if (!delta) return;

    const resolvedItemId = itemId ?? activeAssistantItemIdRef.current ?? null;
    const msgId = resolvedItemId
      ? (assistantItemMapRef.current.get(resolvedItemId) ?? bindAssistantItem(resolvedItemId))
      : ensureStreamingAssistantMessage();

    rebindBufferToMessage(msgId);
    const buf = bufferRef.current;
    // Mark thinking as done when text starts arriving
    if (buf.getThinking() && !buf.thinkingComplete) {
      buf.thinkingComplete = true;
    }
    buf.appendText(delta);
    scheduleFlush();
  }, [bindAssistantItem, ensureStreamingAssistantMessage, rebindBufferToMessage, scheduleFlush]);

  // ── Reasoning delta: accumulate thinking text ──
  const handleReasoningDelta = useCallback((params: Record<string, unknown>) => {
    const itemId = params.itemId as string | undefined;
    const delta = params.delta as string | undefined;
    if (!delta) return;

    const resolvedItemId = itemId ?? activeAssistantItemIdRef.current ?? null;
    const msgId = resolvedItemId
      ? (assistantItemMapRef.current.get(resolvedItemId) ?? bindAssistantItem(resolvedItemId))
      : ensureStreamingAssistantMessage();

    rebindBufferToMessage(msgId);
    bufferRef.current.appendThinking(delta);
    scheduleFlush();
  }, [bindAssistantItem, ensureStreamingAssistantMessage, rebindBufferToMessage, scheduleFlush]);

  // ── Command output delta: stream into tool_call ──
  const handleCommandOutputDelta = useCallback((params: Record<string, unknown>) => {
    const itemId = params.itemId as string | undefined;
    const delta = params.delta as string | undefined;
    if (!itemId || !delta) return;

    const existing = commandOutputRef.current.get(itemId) ?? "";
    commandOutputRef.current.set(itemId, existing + delta);

    // Update the tool_call message with live output — deterministic fallback
    // for sessions restored from the background store
    const msgId = itemMapRef.current.get(itemId) ?? `codex-tool-${itemId}`;
    if (msgId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                toolResult: {
                  ...(m.toolResult ?? {}),
                  type: "text",
                  stdout: commandOutputRef.current.get(itemId)!,
                },
              }
            : m,
        ),
      );
    }
  }, []);

  // ── Turn complete: finalize everything ──
  const handleTurnComplete = useCallback((params: Record<string, unknown>) => {
    setIsProcessing(false);
    finalizeStreamingAssistant();
    assistantItemMapRef.current.clear();
    activeAssistantItemIdRef.current = null;

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
  }, [finalizeStreamingAssistant]);

  // ── Token usage ──
  const handleTokenUsage = useCallback((params: CodexTokenUsageNotification) => {
    const usage = params.tokenUsage;
    setContextUsage({
      // Context meter should reflect current context pressure, not cumulative thread spend.
      inputTokens: usage.last.inputTokens,
      outputTokens: usage.last.outputTokens,
      cacheReadTokens: usage.last.cachedInputTokens,
      cacheCreationTokens: 0,
      contextWindow: usage.modelContextWindow ?? 200_000,
    });
  }, []);

  // ── Plan updates (step checklist + chat tool card) ──
  // Codex emits turn/plan/updated as a turn-level notification (not an item lifecycle event),
  // so we synthesize a tool_call UIMessage to show it in chat alongside the TodoPanel update.
  const handlePlanUpdate = useCallback((params: Record<string, unknown>) => {
    const plan = params.plan as Array<{ step: string; status: string }> | undefined;
    if (!plan) return;

    const todos = codexPlanToTodos(plan);
    setTodoItems(todos);

    // Synthesize a TodoWrite-style tool_call message so the plan appears in chat.
    // ID is per-turn so each turn gets its own card (avoids stale cards from prior turns).
    const planMsgId = `codex-plan-update-${planTurnCounterRef.current}`;
    setMessages((prev) => {
      const existing = prev.find((m) => m.id === planMsgId);
      const explanation = params.explanation as string | null | undefined;
      const toolInput = {
        todos,
        ...(explanation ? { explanation } : {}),
      };
      const toolResult = {
        content: `Plan: ${plan.length} step${plan.length !== 1 ? "s" : ""}`,
      };

      if (existing) {
        // Update the existing plan card in-place as steps change status
        return prev.map((m) =>
          m.id === planMsgId
            ? { ...m, toolInput, toolResult }
            : m,
        );
      }
      return [
        ...prev,
        {
          id: planMsgId,
          role: "tool_call" as const,
          content: "",
          toolName: "TodoWrite",
          toolInput,
          toolResult,
          timestamp: Date.now(),
        },
      ];
    });
  }, []);

  // ── Plan deltas (streaming plan text) ──
  // Accumulates item/plan/delta events and surfaces them as a tool_call message
  // with toolName "ExitPlanMode" — matching how Claude renders plans via the SDK's
  // ExitPlanMode tool. This gives identical rendering: Map icon, "Preparing plan"
  // shimmer while streaming, "Presented plan" when complete, collapsible markdown body.
  const handlePlanDelta = useCallback((params: Record<string, unknown>) => {
    const delta = typeof params.delta === "string" ? params.delta : "";
    if (!delta) return;
    planTextRef.current += delta;
    const planText = planTextRef.current;

    setMessages((prev) => {
      const planMsgId = "codex-plan-stream";
      const existing = prev.find((m) => m.id === planMsgId);
      if (existing) {
        // Update the plan text in toolInput while keeping it "running" (no toolResult yet)
        return prev.map((m) =>
          m.id === planMsgId
            ? { ...m, toolInput: { plan: planText } }
            : m,
        );
      }
      // Create a tool_call message matching Claude's ExitPlanMode shape
      return [
        ...prev,
        {
          id: planMsgId,
          role: "tool_call" as const,
          content: "",
          toolName: "ExitPlanMode",
          toolInput: { plan: planText },
          // No toolResult yet — renders as "Preparing plan" shimmer
          timestamp: Date.now(),
        },
      ];
    });
  }, []);

  // ── Compaction ──
  const handleCompacted = useCallback(() => {
    setIsCompacting(false);
  }, []);

  // ── Approval handling ──
  const handleApproval = useCallback((data: CodexServerRequest) => {
    if (data._sessionId !== sessionIdRef.current) return;

    serverRequestRef.current = data;
    if (data.method === "item/tool/requestUserInput") {
      const questions: CodexQuestionInput[] = data.questions.map((question) => ({
        id: question.id,
        header: question.header,
        question: question.question,
        isOther: question.isOther,
        isSecret: question.isSecret,
        options: question.options ?? undefined,
        multiSelect: false,
      }));
      setPendingPermission({
        requestId: String(data.rpcId),
        toolName: "AskUserQuestion",
        toolInput: {
          source: "codex_request_user_input",
          questions,
        },
        toolUseId: data.itemId,
      });
      return;
    }

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
  const sendRaw = useCallback(
    async (text: string, images?: ImageAttachment[], collaborationMode?: CollaborationMode): Promise<boolean> => {
      if (!sessionId) return false;
      setIsProcessing(true);
      try {
        const result = await window.claude.codex.send(
          sessionId,
          text,
          imageAttachmentsToCodexInputs(images),
          codexEffort,
          collaborationMode,
        );
        if (result?.error) {
          setIsProcessing(false);
          return false;
        }
        return true;
      } catch {
        setIsProcessing(false);
        return false;
      }
    },
    [sessionId, codexEffort],
  );

  const send = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string, collaborationMode?: CollaborationMode): Promise<boolean> => {
      if (!sessionId) return false;
      // Add user message to UI immediately
      setMessages((prev) => [
        ...prev,
        {
          id: nextId("user"),
          role: "user",
          content: text,
          timestamp: Date.now(),
          ...(images?.length ? { images } : {}),
          ...(displayText ? { displayContent: displayText } : {}),
        },
      ]);
      const ok = await sendRaw(text, images, collaborationMode);
      if (!ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId("err"),
            role: "system",
            content: "Unable to send message.",
            timestamp: Date.now(),
            isError: true,
          },
        ]);
      }
      return ok;
    },
    [sessionId, sendRaw],
  );

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
      // Synthetic ExitPlanMode prompt (no real RPC) — just clear the prompt.
      // AppLayout's sync effect handles toggling plan mode off when
      // sessionInfo.permissionMode changes away from "plan".
      if (pendingPermission?.toolName === "ExitPlanMode") {
        setPendingPermission(null);

        if (behavior === "deny") {
          // Send user feedback as a plan-mode message so Codex refines the plan
          const denyMessage = typeof _updatedInput?.denyMessage === "string"
            ? _updatedInput.denyMessage.trim() : "";
          if (denyMessage) {
            const model = sessionInfo?.model?.trim() || sessionModelRef.current?.trim();
            if (!model) {
              setMessages((prev) => [
                ...prev,
                {
                  id: nextId("err"),
                  role: "system",
                  content: "Codex plan mode is enabled, but no model is selected. Select a Codex model and try again.",
                  timestamp: Date.now(),
                  isError: true,
                },
              ]);
              return;
            }
            const planCollabMode: CollaborationMode = {
              mode: "plan",
              settings: { model, reasoning_effort: null, developer_instructions: null },
            };
            await send(denyMessage, undefined, undefined, planCollabMode);
          }
          return;
        }

        if (_newPermissionMode) {
          const model = sessionInfo?.model?.trim() || sessionModelRef.current?.trim();
          if (!model) {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId("err"),
                role: "system",
                content: "Codex plan mode is enabled, but no model is selected. Select a Codex model and try again.",
                timestamp: Date.now(),
                isError: true,
              },
            ]);
            return;
          }

          // User accepted — update sessionInfo so AppLayout's planMode sync fires
          setSessionInfo((prev) => prev ? { ...prev, permissionMode: _newPermissionMode } : prev);
          const collaborationMode: CollaborationMode = {
            mode: "default",
            settings: {
              model,
              reasoning_effort: null,
              developer_instructions: null,
            },
          };
          // Send implementation prompt — plan is already in conversation context
          await send("Implement the plan.", undefined, undefined, collaborationMode);
        }
        return;
      }

      if (!sessionId) return;

      const activeRequest = serverRequestRef.current
        ?? (pendingPermission
          ? {
            method: pendingPermission.toolName === "AskUserQuestion"
              ? "item/tool/requestUserInput"
              : "item/commandExecution/requestApproval",
            rpcId: pendingPermission.requestId,
            itemId: pendingPermission.toolUseId,
          }
          : null);
      if (!activeRequest) return;

      if (activeRequest.method === "item/tool/requestUserInput") {
        if (behavior === "deny") {
          await window.claude.codex.respondServerRequestError(
            sessionId,
            activeRequest.rpcId,
            -32001,
            "User declined requestUserInput",
          );
          setPendingPermission(null);
          serverRequestRef.current = null;
          return;
        }

        const updatedAnswers = (_updatedInput?.answersByQuestionId ?? {}) as Record<string, string[]>;
        const answers: Record<string, { answers: string[] }> = {};
        for (const [questionId, values] of Object.entries(updatedAnswers)) {
          const cleaned = values
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
          if (cleaned.length > 0) {
            answers[questionId] = { answers: cleaned };
          }
        }
        await window.claude.codex.respondUserInput(sessionId, activeRequest.rpcId, answers);
        setPendingPermission(null);
        serverRequestRef.current = null;
        return;
      }

      const decision = behavior === "allow" ? "accept" : behavior === "allowForSession" ? "accept" : "decline";
      const acceptSettings = behavior === "allowForSession" ? { forSession: true } : undefined;
      await window.claude.codex.respondApproval(sessionId, activeRequest.rpcId, decision, acceptSettings);
      setPendingPermission(null);
      serverRequestRef.current = null;
    },
    [sessionId, pendingPermission, send, sessionInfo?.model],
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
