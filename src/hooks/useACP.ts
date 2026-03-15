import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImageAttachment, AcpPermissionBehavior, AppPermissionBehavior, SessionMeta, SlashCommand } from "@/types";
import type { ACPSessionEvent, ACPPermissionEvent, ACPTurnCompleteEvent, ACPConfigOption, ACPAvailableCommandsUpdate } from "@/types/acp";
import { ACPStreamingBuffer, normalizeToolInput, normalizeToolResult, deriveToolName, mergeToolInput, pickAutoResponseOption } from "@/lib/acp-adapter";
import { extractTaskSubagentSteps, getTaskStatus, isTaskToolName } from "@/lib/acp-task-adapter";
import { suppressNextSessionCompletion } from "@/lib/notification-utils";
import { captureException } from "@/lib/analytics";
import { useEngineBase } from "./useEngineBase";

interface UseACPOptions {
  sessionId: string | null;
  initialMessages?: import("@/types").UIMessage[];
  initialConfigOptions?: ACPConfigOption[];
  initialSlashCommands?: SlashCommand[];
  initialMeta?: SessionMeta | null;
  /** Restore a pending permission when switching back to this session */
  initialPermission?: import("@/types").PermissionRequest | null;
  /** Restore the raw ACP permission event (needed for optionId lookup) */
  initialRawAcpPermission?: ACPPermissionEvent | null;
  /** Client-side ACP permission behavior — controls auto-response to permission requests */
  acpPermissionBehavior?: AcpPermissionBehavior;
}

/** Renderer-side ACP log — forwarded to main process log file as [ACP_UI:TAG] */
function acpLog(label: string, data: unknown): void {
  window.claude.acp.log(label, data);
}

function nextAcpId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function useACP({ sessionId, initialMessages, initialConfigOptions, initialSlashCommands, initialMeta, initialPermission, initialRawAcpPermission, acpPermissionBehavior }: UseACPOptions) {
  const base = useEngineBase({ sessionId, initialMessages, initialMeta, initialPermission });
  const {
    messages, setMessages,
    isProcessing, setIsProcessing,
    isConnected, setIsConnected,
    sessionInfo, setSessionInfo,
    totalCost, setTotalCost,
    pendingPermission, setPendingPermission,
    contextUsage, setContextUsage,
    sessionIdRef,
    scheduleFlush: scheduleRaf,
    cancelPendingFlush,
  } = base;

  const [configOptions, setConfigOptions] = useState<ACPConfigOption[]>(initialConfigOptions ?? []);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>(initialSlashCommands ?? []);

  // Sync initialConfigOptions prop → state (useState ignores prop changes after mount)
  useEffect(() => {
    setConfigOptions(initialConfigOptions ?? []);
  }, [initialConfigOptions]);

  // Sync initialSlashCommands prop → state
  useEffect(() => {
    setSlashCommands(initialSlashCommands ?? []);
  }, [initialSlashCommands]);

  const buffer = useRef(new ACPStreamingBuffer());
  /** Track the active ACP task/subagent tool so inner tool_calls + text are routed into its card. */
  const activeTaskRef = useRef<{ msgId: string; toolCallId: string; hasInnerTools: boolean; textBuffer: string } | null>(null);
  const acpPermissionRef = useRef<ACPPermissionEvent | null>(null);
  // Track latest permission behavior to avoid stale closures in event listeners
  const acpPermissionBehaviorRef = useRef<AcpPermissionBehavior>(acpPermissionBehavior ?? "ask");
  acpPermissionBehaviorRef.current = acpPermissionBehavior ?? "ask";

  // Engine-specific reset — runs after base reset via the same sessionId dependency
  useEffect(() => {
    acpPermissionRef.current = initialRawAcpPermission ?? null;
    activeTaskRef.current = null;
    setConfigOptions(initialConfigOptions ?? []);
    setSlashCommands(initialSlashCommands ?? []);
    buffer.current.reset();
    cancelPendingFlush();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const flushStreamingToState = useCallback(() => {
    const buf = buffer.current;
    if (!buf.messageId) return;
    const text = buf.getText();
    const thinking = buf.getThinking();
    const thinkingComplete = buf.thinkingComplete;
    setMessages(prev => prev.map(m => {
      if (m.id !== buf.messageId) return m;
      return {
        ...m,
        content: text,
        thinking: thinking || m.thinking,
        ...(thinkingComplete ? { thinkingComplete: true } : {}),
      };
    }));
  }, [setMessages]);

  const scheduleFlush = useCallback(() => {
    scheduleRaf(flushStreamingToState);
  }, [scheduleRaf, flushStreamingToState]);

  const pushSystemError = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: nextAcpId("system-acp-error"),
        role: "system",
        content,
        isError: true,
        timestamp: Date.now(),
      },
    ]);
  }, [setMessages]);

  const ensureStreamingMessage = useCallback(() => {
    if (buffer.current.messageId) return;
    const id = nextAcpId("stream");
    buffer.current.messageId = id;
    acpLog("MSG_START", { id });
    setMessages(prev => [...prev, {
      id,
      role: "assistant",
      content: "",
      isStreaming: true,
      timestamp: Date.now(),
    }]);
  }, []);

  const finalizeStreamingMessage = useCallback(() => {
    const buf = buffer.current;
    if (!buf.messageId) return;
    if (buf.getThinking()) buf.thinkingComplete = true;
    flushStreamingToState();
    acpLog("MSG_FINALIZE", { id: buf.messageId, textLen: buf.getText().length, thinkingLen: buf.getThinking().length });
    setMessages(prev => prev.map(m =>
      m.id === buf.messageId ? { ...m, isStreaming: false } : m
    ));
    buf.reset();
  }, [flushStreamingToState]);

  // Mark any tool_call messages still missing a result as completed.
  // Some ACP agents (e.g. Codex) skip sending tool_call_update for fast tools.
  // Task/Agent tools are excluded — they stay open until their tool_call_update arrives.
  const closePendingTools = useCallback(() => {
    setMessages(prev => {
      const pending = prev.filter(m => m.role === "tool_call" && !m.toolResult && !m.toolError && !isTaskToolName(m.toolName));
      if (pending.length === 0) return prev;
      acpLog("CLOSE_PENDING_TOOLS", { count: pending.length, ids: pending.map(m => m.id) });
      return prev.map(m => {
        if (m.role === "tool_call" && !m.toolResult && !m.toolError && !isTaskToolName(m.toolName)) {
          return { ...m, toolResult: { status: "completed" } };
        }
        return m;
      });
    });
  }, []);

  const handleSessionUpdate = useCallback((event: ACPSessionEvent) => {
    if (event._sessionId !== sessionIdRef.current) return;
    const { update } = event;
    const kind = update.sessionUpdate;

    if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
      // Agent moved on to generating text — close any pending tools
      closePendingTools();
      const content = update.content as { type: string; text?: string } | undefined;
      if (content?.type === "text" && content.text) {
        // If an ACP task has inner tools running, accumulate text as task content
        // (this is the subagent's output text, not the outer agent's)
        if (activeTaskRef.current?.hasInnerTools && kind === "agent_message_chunk") {
          activeTaskRef.current.textBuffer += content.text;
          return;
        }
        ensureStreamingMessage();
        if (kind === "agent_message_chunk") {
          // Text arriving means thinking phase is over
          if (buffer.current.getThinking()) {
            buffer.current.thinkingComplete = true;
          }
          buffer.current.appendText(content.text);
        } else {
          buffer.current.appendThinking(content.text);
        }
        scheduleFlush();
      }
    } else if (kind === "tool_call") {
      closePendingTools();
      finalizeStreamingMessage();
      const tc = update as Extract<typeof update, { sessionUpdate: "tool_call" }>;
      const toolName = deriveToolName(tc.title, tc.kind, tc.rawInput);
      const msgId = `tool-${tc.toolCallId}`;
      acpLog("TOOL_CALL", {
        toolCallId: tc.toolCallId?.slice(0, 12),
        title: tc.title,
        kind: tc.kind,
        toolName,
        msgId,
      });

      // If there's an active task, route this tool_call as a subagent step
      if (activeTaskRef.current && !isTaskToolName(toolName)) {
        activeTaskRef.current.hasInnerTools = true;
        const isAlreadyDone = tc.status === "completed" || tc.status === "failed";
        const stepResult = isAlreadyDone ? normalizeToolResult(tc.rawOutput, tc.content) : undefined;
        const step = {
          toolName,
          toolUseId: tc.toolCallId,
          toolInput: normalizeToolInput(tc.rawInput, tc.kind, tc.locations),
          ...(stepResult ? { toolResult: stepResult } : {}),
          ...(tc.status === "failed" ? { toolError: true } : {}),
        };
        setMessages(prev => prev.map(m => {
          if (m.id !== activeTaskRef.current!.msgId) return m;
          return { ...m, subagentSteps: [...(m.subagentSteps ?? []), step] };
        }));
        return;
      }

      // The initial tool_call event may already carry status/rawOutput (protocol allows it).
      // If the tool arrived completed, set toolResult immediately so it doesn't show as running.
      const isAlreadyDone = tc.status === "completed" || tc.status === "failed";
      const initialResult = isAlreadyDone ? normalizeToolResult(tc.rawOutput, tc.content) : undefined;
      const isTask = isTaskToolName(toolName);
      // Start tracking if this is a Task tool
      if (isTask && !isAlreadyDone) {
        activeTaskRef.current = { msgId, toolCallId: tc.toolCallId, hasInnerTools: false, textBuffer: "" };
      }
      setMessages(prev => {
        if (prev.some(m => m.id === msgId)) return prev;
        const taskSteps = isTask ? extractTaskSubagentSteps(initialResult) : undefined;
        return [...prev, {
          id: msgId,
          role: "tool_call" as const,
          content: "",
          toolName,
          toolInput: normalizeToolInput(tc.rawInput, tc.kind, tc.locations),
          ...(initialResult ? { toolResult: initialResult } : {}),
          ...(tc.status === "failed" ? { toolError: true } : {}),
          ...(isTask ? {
            subagentStatus: getTaskStatus(tc.status),
            subagentSteps: taskSteps ?? [],
          } : {}),
          timestamp: Date.now(),
        }];
      });
    } else if (kind === "tool_call_update") {
      const tcu = update as Extract<typeof update, { sessionUpdate: "tool_call_update" }>;
      const result = normalizeToolResult(tcu.rawOutput, tcu.content);
      acpLog("TOOL_RESULT", {
        toolCallId: tcu.toolCallId?.slice(0, 12),
        status: tcu.status,
        isError: tcu.status === "failed",
        hasResult: result != null,
      });

      // Check if this is for the active task itself
      if (activeTaskRef.current && tcu.toolCallId === activeTaskRef.current.toolCallId) {
        const taskMsgId = activeTaskRef.current.msgId;
        const isDone = tcu.status === "completed" || tcu.status === "failed" || tcu.status === "cancelled";

        if (isDone) {
          // Task finished — set final result with accumulated text, clear activeTask
          const textContent = activeTaskRef.current.textBuffer;
          const finalResult = result ?? (textContent ? { content: textContent } : undefined);
          if (finalResult && textContent && typeof finalResult.content !== "string") {
            finalResult.content = textContent;
          }
          activeTaskRef.current = null;
          setMessages(prev => prev.map(m => {
            if (m.id !== taskMsgId) return m;
            const nextTaskSteps = extractTaskSubagentSteps(finalResult) ?? m.subagentSteps;
            return {
              ...m,
              toolResult: finalResult ?? m.toolResult ?? { status: "completed" },
              toolError: tcu.status === "failed",
              subagentStatus: getTaskStatus(tcu.status),
              ...(nextTaskSteps ? { subagentSteps: nextTaskSteps } : {}),
            };
          }));
        } else {
          setMessages(prev => prev.map(m => {
            if (m.id !== taskMsgId) return m;
            const updatedInput = mergeToolInput(m.toolInput, tcu.rawInput, tcu.kind, tcu.locations);
            if (!updatedInput || updatedInput === m.toolInput) return m;
            return { ...m, toolInput: updatedInput };
          }));
        }
        return;
      }

      // Check if this updates a subagent step inside the active task
      if (activeTaskRef.current) {
        setMessages(prev => prev.map(m => {
          if (m.id !== activeTaskRef.current!.msgId) return m;
          const updated = (m.subagentSteps ?? []).some(s => s.toolUseId === tcu.toolCallId);
          if (!updated) return m;
          return {
            ...m,
            subagentSteps: (m.subagentSteps ?? []).map(step =>
              step.toolUseId === tcu.toolCallId
                ? {
                    ...step,
                    toolInput: mergeToolInput(step.toolInput, tcu.rawInput, tcu.kind, tcu.locations) ?? step.toolInput,
                    toolResult: result ?? step.toolResult ?? { status: "completed" },
                    toolError: tcu.status === "failed",
                  }
                : step
            ),
          };
        }));
        return;
      }

      // Normal tool_call_update for top-level tools
      const msgId = `tool-${tcu.toolCallId}`;
      setMessages(prev => prev.map(m => {
        if (m.id !== msgId) return m;
        const isTask = isTaskToolName(m.toolName);
        const nextTaskStatus = isTask ? getTaskStatus(tcu.status) : undefined;
        const nextTaskSteps = isTask ? extractTaskSubagentSteps(result) : undefined;
        return {
          ...m,
          toolInput: mergeToolInput(m.toolInput, tcu.rawInput, tcu.kind, tcu.locations) ?? m.toolInput,
          toolResult: result ?? m.toolResult,
          toolError: tcu.status === "failed",
          ...(nextTaskStatus ? { subagentStatus: nextTaskStatus } : {}),
          ...(nextTaskSteps ? { subagentSteps: nextTaskSteps } : {}),
        };
      }));
    } else if (kind === "config_option_update") {
      const cou = update as { sessionUpdate: "config_option_update"; configOptions: ACPConfigOption[] };
      acpLog("CONFIG_UPDATE", { optionCount: cou.configOptions?.length });
      setConfigOptions(cou.configOptions);
    } else if (kind === "usage_update") {
      const uu = update as Extract<typeof update, { sessionUpdate: "usage_update" }>;
      if (uu.size != null || uu.used != null) {
        setContextUsage(prev => ({
          inputTokens: uu.used ?? prev?.inputTokens ?? 0,
          outputTokens: prev?.outputTokens ?? 0,
          cacheReadTokens: prev?.cacheReadTokens ?? 0,
          cacheCreationTokens: prev?.cacheCreationTokens ?? 0,
          contextWindow: uu.size ?? prev?.contextWindow ?? 0,
        }));
      }
      if (uu.cost) {
        acpLog("COST", { amount: uu.cost.amount, currency: uu.cost.currency });
        setTotalCost(prev => prev + uu.cost!.amount);
      }
    } else if (kind === "session_info_update") {
      const si = update as Extract<typeof update, { sessionUpdate: "session_info_update" }>;
      acpLog("SESSION_INFO", { title: si.title });
    } else if (kind === "current_mode_update") {
      const cm = update as Extract<typeof update, { sessionUpdate: "current_mode_update" }>;
      acpLog("MODE_UPDATE", { modeId: cm.currentModeId });
    } else if (kind === "available_commands_update") {
      const acu = update as ACPAvailableCommandsUpdate;
      acpLog("COMMANDS_UPDATE", { count: acu.availableCommands?.length });
      setSlashCommands((acu.availableCommands ?? []).map(cmd => ({
        name: cmd.name,
        description: cmd.description ?? "",
        argumentHint: cmd.input?.hint,
        source: "acp" as const,
      })));
    } else if (kind === "plan") {
      const p = update as Extract<typeof update, { sessionUpdate: "plan" }>;
      acpLog("PLAN", { entryCount: p.entries?.length });
    }
  }, [closePendingTools, ensureStreamingMessage, finalizeStreamingMessage, scheduleFlush]);

  useEffect(() => {
    if (!sessionId) return;
    acpLog("SESSION_CONNECTED", { sessionId: sessionId.slice(0, 8) });
    setIsConnected(true);

    // Fetch any config options buffered in main process during the DRAFT→active transition
    // (events may have arrived before this listener was subscribed)
    window.claude.acp.getConfigOptions(sessionId).then(result => {
      if (result?.configOptions?.length) {
        acpLog("CONFIG_FETCHED", { count: result.configOptions.length });
        setConfigOptions(result.configOptions as ACPConfigOption[]);
      }
    }).catch(() => { /* session may have been stopped */ });

    // Fetch any available commands buffered in main process during the DRAFT→active transition
    window.claude.acp.getAvailableCommands(sessionId).then(result => {
      if (result?.commands?.length) {
        acpLog("COMMANDS_FETCHED", { count: result.commands.length });
        setSlashCommands(result.commands.map(cmd => ({
          name: cmd.name,
          description: cmd.description ?? "",
          argumentHint: cmd.input?.hint,
          source: "acp" as const,
        })));
      }
    }).catch(() => { /* session may have been stopped */ });

    const unsubEvent = window.claude.acp.onEvent(handleSessionUpdate);

    const unsubPermission = window.claude.acp.onPermissionRequest((data: ACPPermissionEvent) => {
      if (data._sessionId !== sessionIdRef.current) return;

      const behavior = acpPermissionBehaviorRef.current;
      acpLog("PERMISSION_REQUEST", {
        requestId: data.requestId,
        tool: data.toolCall.title,
        toolCallId: data.toolCall.toolCallId?.slice(0, 12),
        optionCount: data.options?.length,
        behavior,
      });

      // Auto-respond if behavior is configured and a matching allow option exists
      const autoOptionId = pickAutoResponseOption(data.options, behavior);
      if (autoOptionId) {
        acpLog("PERMISSION_AUTO_RESPOND", {
          session: sessionIdRef.current?.slice(0, 8),
          requestId: data.requestId,
          optionId: autoOptionId,
          behavior,
          tool: data.toolCall.title,
        });
        void window.claude.acp.respondPermission(data._sessionId, data.requestId, autoOptionId)
          .then((result) => {
            if (!result?.error) return;
            toast.error("Failed to auto-respond to permission prompt", {
              description: result.error,
            });
            acpPermissionRef.current = data;
            setPendingPermission({
              requestId: data.requestId,
              toolName: data.toolCall.title,
              toolInput: normalizeToolInput(data.toolCall.rawInput, data.toolCall.kind),
              toolUseId: data.toolCall.toolCallId,
            });
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            toast.error("Failed to auto-respond to permission prompt", {
              description: message,
            });
            acpPermissionRef.current = data;
            setPendingPermission({
              requestId: data.requestId,
              toolName: data.toolCall.title,
              toolInput: normalizeToolInput(data.toolCall.rawInput, data.toolCall.kind),
              toolUseId: data.toolCall.toolCallId,
            });
          });
        return;
      }

      // Fall through to manual prompt
      acpPermissionRef.current = data;
      setPendingPermission({
        requestId: data.requestId,
        toolName: data.toolCall.title,
        toolInput: normalizeToolInput(data.toolCall.rawInput, data.toolCall.kind),
        toolUseId: data.toolCall.toolCallId,
      });
    });

    const unsubTurnComplete = window.claude.acp.onTurnComplete((data: ACPTurnCompleteEvent) => {
      if (data._sessionId !== sessionIdRef.current) return;
      acpLog("TURN_COMPLETE", { stopReason: data.stopReason });
      finalizeStreamingMessage();
      closePendingTools();
      setIsProcessing(false);
    });

    const unsubExit = window.claude.acp.onExit((data: { _sessionId: string; code: number | null; error?: string }) => {
      if (data._sessionId !== sessionIdRef.current) return;
      acpLog("SESSION_EXIT", { code: data.code, error: data.error });
      setIsConnected(false);
      setIsProcessing(false);
      // Show error message in UI if session exited with error
      if (data.code !== 0 && data.code !== null) {
        const errorDetail = data.error || `Agent process exited with code ${data.code}`;
        setMessages((prev) => [
          ...prev,
          {
            id: nextAcpId("system-exit"),
            role: "system",
            content: errorDetail,
            isError: true,
            timestamp: Date.now(),
          },
        ]);
      }
    });

    return () => {
      unsubEvent(); unsubPermission(); unsubTurnComplete(); unsubExit();
      cancelPendingFlush();
    };
  }, [sessionId, handleSessionUpdate, finalizeStreamingMessage, closePendingTools]);

  const send = useCallback(async (text: string, images?: ImageAttachment[], displayText?: string) => {
    if (!sessionId) return;
    acpLog("SEND", { session: sessionId.slice(0, 8), textLen: text.length, images: images?.length ?? 0 });
    setMessages(prev => [...prev, {
      id: nextAcpId("user"),
      role: "user" as const,
      content: text,
      images,
      timestamp: Date.now(),
      ...(displayText ? { displayContent: displayText } : {}),
    }]);
    setIsProcessing(true);
    try {
      const result = await window.claude.acp.prompt(sessionId, text, images);
      if (result?.error) {
        acpLog("SEND_ERROR", { session: sessionId.slice(0, 8), error: result.error });
        pushSystemError(`ACP prompt error: ${result.error}`);
        setIsProcessing(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      acpLog("SEND_ERROR", { session: sessionId.slice(0, 8), error: msg });
      captureException(err instanceof Error ? err : new Error(msg), { label: "ACP_SEND_ERR" });
      pushSystemError(`ACP prompt error: ${msg}`);
      setIsProcessing(false);
    }
  }, [sessionId, pushSystemError]);

  /** Send a message without adding it to chat (used for queued messages already in the UI) */
  const sendRaw = useCallback(async (text: string, images?: ImageAttachment[]) => {
    if (!sessionId) return;
    acpLog("SEND_RAW", { session: sessionId.slice(0, 8), textLen: text.length });
    setIsProcessing(true);
    try {
      const result = await window.claude.acp.prompt(sessionId, text, images);
      if (result?.error) {
        acpLog("SEND_RAW_ERROR", { session: sessionId.slice(0, 8), error: result.error });
        pushSystemError(`ACP prompt error: ${result.error}`);
        setIsProcessing(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      acpLog("SEND_RAW_ERROR", { session: sessionId.slice(0, 8), error: msg });
      captureException(err instanceof Error ? err : new Error(msg), { label: "ACP_SEND_RAW_ERR" });
      pushSystemError(`ACP prompt error: ${msg}`);
      setIsProcessing(false);
    }
  }, [sessionId, pushSystemError]);

  const stop = useCallback(async () => {
    if (!sessionId) return;
    acpLog("STOP", { session: sessionId.slice(0, 8) });
    suppressNextSessionCompletion(sessionId);
    await window.claude.acp.stop(sessionId);
  }, [sessionId]);

  const interrupt = useCallback(async () => {
    if (!sessionId) return;
    acpLog("INTERRUPT", { session: sessionId.slice(0, 8) });
    suppressNextSessionCompletion(sessionId);
    finalizeStreamingMessage();
    closePendingTools();
    setPendingPermission(null);
    setIsProcessing(false);
    try {
      const result = await window.claude.acp.cancel(sessionId);
      if (result?.error) {
        acpLog("INTERRUPT_ERROR", { session: sessionId.slice(0, 8), error: result.error });
        pushSystemError(`ACP cancel error: ${result.error}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      acpLog("INTERRUPT_ERROR", { session: sessionId.slice(0, 8), error: msg });
      captureException(err instanceof Error ? err : new Error(msg), { label: "ACP_INTERRUPT_ERR" });
      pushSystemError(`ACP cancel error: ${msg}`);
    }
  }, [sessionId, finalizeStreamingMessage, closePendingTools, pushSystemError]);

  const respondPermission = useCallback(async (
    behavior: AppPermissionBehavior,
    _updatedInput?: Record<string, unknown>,
    _newPermissionMode?: string,
  ) => {
    if (!sessionId || !pendingPermission || !acpPermissionRef.current) return;
    const acpData = acpPermissionRef.current;

    const optionId = behavior === "allow"
      ? acpData.options.find(o => o.kind.startsWith("allow"))?.optionId
      : acpData.options.find(o => o.kind.startsWith("reject"))?.optionId;

    acpLog("PERMISSION_RESPONSE", {
      session: sessionId.slice(0, 8),
      behavior,
      requestId: acpData.requestId,
      optionId,
    });

    if (!optionId) {
      toast.error("Failed to respond to permission prompt", {
        description: "No matching ACP permission option was available.",
      });
      return;
    }

    const result = await window.claude.acp.respondPermission(sessionId, acpData.requestId, optionId);
    if (result?.error) {
      toast.error("Failed to respond to permission prompt", {
        description: result.error,
      });
      return;
    }

    setPendingPermission(null);
    acpPermissionRef.current = null;
  }, [sessionId, pendingPermission]);

  const setConfig = useCallback(async (configId: string, value: string) => {
    if (!sessionId) return;
    acpLog("CONFIG_SET", { session: sessionId.slice(0, 8), configId, value });
    const result = await window.claude.acp.setConfig(sessionId, configId, value);
    if (result.configOptions) {
      setConfigOptions(result.configOptions);
    }
  }, [sessionId]);

  const compact = useCallback(async () => { /* no-op for ACP */ }, []);
  const setPermissionMode = useCallback(async (_mode: string) => { /* no-op for ACP */ }, []);

  return {
    messages, setMessages,
    isProcessing, setIsProcessing,
    isConnected, setIsConnected,
    sessionInfo, setSessionInfo,
    totalCost, setTotalCost,
    contextUsage,
    send, sendRaw, stop, interrupt, compact,
    pendingPermission, respondPermission,
    setPermissionMode,
    configOptions, setConfigOptions, setConfig,
    slashCommands,
  };
}
