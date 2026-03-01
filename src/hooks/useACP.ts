import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageAttachment, AcpPermissionBehavior, AppPermissionBehavior, SessionMeta } from "@/types";
import type { ACPSessionEvent, ACPPermissionEvent, ACPTurnCompleteEvent, ACPConfigOption } from "@/types/acp";
import { ACPStreamingBuffer, normalizeToolInput, normalizeToolResult, deriveToolName, pickAutoResponseOption } from "@/lib/acp-adapter";
import { useEngineBase } from "./useEngineBase";

interface UseACPOptions {
  sessionId: string | null;
  initialMessages?: import("@/types").UIMessage[];
  initialConfigOptions?: ACPConfigOption[];
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

export function useACP({ sessionId, initialMessages, initialConfigOptions, initialMeta, initialPermission, initialRawAcpPermission, acpPermissionBehavior }: UseACPOptions) {
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

  // Sync initialConfigOptions prop → state (useState ignores prop changes after mount)
  useEffect(() => {
    if (initialConfigOptions && initialConfigOptions.length > 0) {
      setConfigOptions(initialConfigOptions);
    }
  }, [initialConfigOptions]);

  const buffer = useRef(new ACPStreamingBuffer());
  const acpPermissionRef = useRef<ACPPermissionEvent | null>(null);
  // Track latest permission behavior to avoid stale closures in event listeners
  const acpPermissionBehaviorRef = useRef<AcpPermissionBehavior>(acpPermissionBehavior ?? "ask");
  acpPermissionBehaviorRef.current = acpPermissionBehavior ?? "ask";

  // Engine-specific reset — runs after base reset via the same sessionId dependency
  useEffect(() => {
    acpPermissionRef.current = initialRawAcpPermission ?? null;
    setConfigOptions(initialConfigOptions ?? []);
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
  const closePendingTools = useCallback(() => {
    setMessages(prev => {
      const pending = prev.filter(m => m.role === "tool_call" && !m.toolResult && !m.toolError);
      if (pending.length === 0) return prev;
      acpLog("CLOSE_PENDING_TOOLS", { count: pending.length, ids: pending.map(m => m.id) });
      return prev.map(m => {
        if (m.role === "tool_call" && !m.toolResult && !m.toolError) {
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
      const msgId = `tool-${tc.toolCallId}`;
      const toolName = deriveToolName(tc.title, tc.kind);
      acpLog("TOOL_CALL", {
        toolCallId: tc.toolCallId?.slice(0, 12),
        title: tc.title,
        kind: tc.kind,
        toolName,
        msgId,
      });
      // The initial tool_call event may already carry status/rawOutput (protocol allows it).
      // If the tool arrived completed, set toolResult immediately so it doesn't show as running.
      const isAlreadyDone = tc.status === "completed" || tc.status === "failed";
      const initialResult = isAlreadyDone ? normalizeToolResult(tc.rawOutput, tc.content) : undefined;
      setMessages(prev => {
        if (prev.some(m => m.id === msgId)) return prev;
        return [...prev, {
          id: msgId,
          role: "tool_call" as const,
          content: "",
          toolName,
          toolInput: normalizeToolInput(tc.rawInput, tc.kind, tc.locations),
          ...(initialResult ? { toolResult: initialResult } : {}),
          ...(tc.status === "failed" ? { toolError: true } : {}),
          timestamp: Date.now(),
        }];
      });
    } else if (kind === "tool_call_update") {
      const tcu = update as Extract<typeof update, { sessionUpdate: "tool_call_update" }>;
      const msgId = `tool-${tcu.toolCallId}`;
      const result = normalizeToolResult(tcu.rawOutput, tcu.content);
      acpLog("TOOL_RESULT", {
        toolCallId: tcu.toolCallId?.slice(0, 12),
        status: tcu.status,
        isError: tcu.status === "failed",
        hasResult: result != null,
      });
      setMessages(prev => prev.map(m => {
        if (m.id !== msgId) return m;
        return {
          ...m,
          toolResult: result ?? m.toolResult,
          toolError: tcu.status === "failed",
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
        window.claude.acp.respondPermission(data._sessionId, data.requestId, autoOptionId);
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
    await window.claude.acp.prompt(sessionId, text, images);
  }, [sessionId]);

  /** Send a message without adding it to chat (used for queued messages already in the UI) */
  const sendRaw = useCallback(async (text: string, images?: ImageAttachment[]) => {
    if (!sessionId) return;
    acpLog("SEND_RAW", { session: sessionId.slice(0, 8), textLen: text.length });
    setIsProcessing(true);
    await window.claude.acp.prompt(sessionId, text, images);
  }, [sessionId]);

  const stop = useCallback(async () => {
    if (!sessionId) return;
    acpLog("STOP", { session: sessionId.slice(0, 8) });
    await window.claude.acp.stop(sessionId);
  }, [sessionId]);

  const interrupt = useCallback(async () => {
    if (!sessionId) return;
    acpLog("INTERRUPT", { session: sessionId.slice(0, 8) });
    await window.claude.acp.cancel(sessionId);
  }, [sessionId]);

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

    if (optionId) {
      await window.claude.acp.respondPermission(sessionId, acpData.requestId, optionId);
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
  };
}
