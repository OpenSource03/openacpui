import { useState, useCallback, useEffect, useRef } from "react";
import type {
  ClaudeEvent,
  SystemInitEvent,
  SystemCompactBoundaryEvent,
  AuthStatusEvent,
  AssistantMessageEvent,
  ToolResultEvent,
  ResultEvent,
  UIMessage,
  SessionInfo,
  SubagentToolStep,
  PermissionRequest,
  ImageAttachment,
  ContextUsage,
  ModelInfo,
  McpServerStatus,
  McpServerConfig,
} from "../types";
import { toMcpStatusState } from "../types/ui";
import { StreamingBuffer } from "../lib/streaming-buffer";
import {
  getParentId,
  extractTextContent,
  extractThinkingContent,
  normalizeToolResult,
  buildSdkContent,
} from "../lib/protocol";

function uiLog(label: string, data: unknown) {
  window.claude.log(label, typeof data === "string" ? data : JSON.stringify(data));
}

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idCounter++}`;
}

/** Convert SDK result error subtypes to user-friendly messages */
function formatResultError(subtype: string, detail: string): string {
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

// Maps a parent_tool_use_id (Task tool_use_id) → the tool_call message id
type ParentToolMap = Map<string, string>;

interface InitialMeta {
  isProcessing: boolean;
  isConnected: boolean;
  sessionInfo: SessionInfo | null;
  totalCost: number;
}

interface UseClaudeOptions {
  sessionId: string | null;
  initialMessages?: UIMessage[];
  initialMeta?: InitialMeta | null;
  /** Restore a pending permission when switching back to this session */
  initialPermission?: PermissionRequest | null;
}

export function useClaude({ sessionId, initialMessages, initialMeta, initialPermission }: UseClaudeOptions) {
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages ?? []);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [mcpServerStatuses, setMcpServerStatuses] = useState<McpServerStatus[]>([]);
  const [supportedModels, setSupportedModels] = useState<ModelInfo[]>([]);

  const buffer = useRef(new StreamingBuffer());
  const parentToolMap = useRef<ParentToolMap>(new Map());
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const messagesRef = useRef<UIMessage[]>([]);
  messagesRef.current = messages;

  // Reset state when sessionId changes, restoring background state if available
  useEffect(() => {
    const msgs = initialMessages ?? [];
    setMessages(msgs);
    if (initialMeta) {
      setIsProcessing(initialMeta.isProcessing);
      setIsConnected(initialMeta.isConnected);
      setSessionInfo(initialMeta.sessionInfo);
      setTotalCost(initialMeta.totalCost);
    } else {
      setIsProcessing(false);
      setIsConnected(false);
      setSessionInfo(null);
      setTotalCost(0);
    }
    // Restore pending permission from background store (or clear if none)
    setPendingPermission(initialPermission ?? null);
    setContextUsage(null);
    setIsCompacting(false);
    buffer.current.reset();
    parentToolMap.current.clear();

    // If restoring a mid-stream session, seed the buffer with existing content
    // so that new deltas are appended rather than replacing old content.
    const streamingMsg = msgs.findLast(
      (m) => m.role === "assistant" && m.isStreaming,
    );
    if (streamingMsg) {
      buffer.current.messageId = streamingMsg.id;
      buffer.current.seedFromRestore(
        streamingMsg.content,
        streamingMsg.thinking,
      );
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // rAF-based flush
  const pendingFlush = useRef(false);
  const rafId = useRef(0);

  const flushStreamingToState = useCallback(() => {
    const allText = buffer.current.getAllText();
    const allThinking = buffer.current.getAllThinking();
    const { thinkingComplete } = buffer.current;
    setMessages((prev) => {
      const streamId = buffer.current.messageId;
      const target = streamId
        ? prev.find((m) => m.id === streamId)
        : prev.findLast((m) => m.role === "assistant" && m.isStreaming);
      if (!target) return prev;
      if (!streamId) buffer.current.messageId = target.id;
      const contentChanged = allText !== target.content;
      const thinkingChanged = allThinking && allThinking !== (target.thinking ?? "");
      const thinkingCompleteChanged = thinkingComplete && !target.thinkingComplete;
      if (!contentChanged && !thinkingChanged && !thinkingCompleteChanged) return prev;
      return prev.map((m) =>
        m.id === target.id
          ? {
              ...m,
              ...(contentChanged ? { content: allText } : {}),
              ...(thinkingChanged ? { thinking: allThinking } : {}),
              ...(thinkingCompleteChanged ? { thinkingComplete: true } : {}),
            }
          : m,
      );
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (pendingFlush.current) return;
    pendingFlush.current = true;
    rafId.current = requestAnimationFrame(() => {
      pendingFlush.current = false;
      flushStreamingToState();
    });
  }, [flushStreamingToState]);

  const flushNow = useCallback(() => {
    if (pendingFlush.current) {
      cancelAnimationFrame(rafId.current);
      pendingFlush.current = false;
    }
    flushStreamingToState();
  }, [flushStreamingToState]);

  const resetStreaming = useCallback(() => {
    buffer.current.reset();
    if (pendingFlush.current) {
      cancelAnimationFrame(rafId.current);
      pendingFlush.current = false;
    }
  }, []);

  const handleSubagentEvent = useCallback((event: ClaudeEvent, parentId: string) => {
    const taskMsgId = parentToolMap.current.get(parentId);
    if (!taskMsgId) return;

    if (event.type === "assistant") {
      const assistantEvent = event as AssistantMessageEvent;
      for (const block of assistantEvent.message.content) {
        if (block.type === "tool_use") {
          const step: SubagentToolStep = {
            toolName: block.name,
            toolInput: block.input,
            toolUseId: block.id,
          };
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== taskMsgId) return m;
              return { ...m, subagentSteps: [...(m.subagentSteps ?? []), step] };
            }),
          );
        }
      }
    } else if (event.type === "user") {
      const userEvent = event as ToolResultEvent;
      const uc = userEvent.message.content;
      if (Array.isArray(uc) && uc[0]?.type === "tool_result") {
        const toolUseId = uc[0].tool_use_id;
        const isError = !!uc[0].is_error;
        const resultMeta = normalizeToolResult(
          userEvent.tool_use_result,
          uc[0].content,
        );
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== taskMsgId) return m;
            const steps = (m.subagentSteps ?? []).map((s) =>
              s.toolUseId === toolUseId ? { ...s, toolResult: resultMeta, toolError: isError || undefined } : s,
            );
            return { ...m, subagentSteps: steps };
          }),
        );
      }
    }
  }, []);

  const handleEvent = useCallback(
    (event: ClaudeEvent & { _sessionId?: string }) => {
      // Filter events by sessionId
      if (event._sessionId && event._sessionId !== sessionIdRef.current) return;

      const parentId = getParentId(event);

      if (parentId) {
        handleSubagentEvent(event, parentId);
        return;
      }

      switch (event.type) {
        case "system": {
          if ("subtype" in event && event.subtype === "compact_boundary") {
            const compactMeta = (event as SystemCompactBoundaryEvent).compact_metadata;
            uiLog("COMPACT_BOUNDARY", { session: event.session_id, trigger: compactMeta?.trigger, preTokens: compactMeta?.pre_tokens });
            setIsCompacting(false);
            // Insert a compact marker message so the UI shows it
            setMessages((prev) => [
              ...prev,
              {
                id: nextId("compact"),
                role: "summary",
                content: "",
                timestamp: Date.now(),
                compactTrigger: compactMeta?.trigger === "manual" ? "manual" : "auto",
                compactPreTokens: compactMeta?.pre_tokens,
              },
            ]);
            break;
          }
          if ("subtype" in event && event.subtype === "status") {
            break;
          }
          const init = event as SystemInitEvent;
          uiLog("SYSTEM_INIT", { session: init.session_id?.slice(0, 8), model: init.model, mcpServers: init.mcp_servers?.length ?? 0 });
          setSessionInfo({
            sessionId: init.session_id,
            model: init.model,
            cwd: init.cwd,
            tools: init.tools,
            version: init.claude_code_version,
            permissionMode: init.permissionMode,
          });
          if (init.mcp_servers?.length) {
            setMcpServerStatuses(init.mcp_servers.map((s) => ({
              name: s.name,
              status: toMcpStatusState(s.status),
            })));
            // Auto-refresh detailed MCP status after a short delay (auth flows may still be in progress)
            const sid = sessionIdRef.current;
            if (sid) {
              setTimeout(() => {
                window.claude.mcpStatus(sid).then((result) => {
                  if (result.servers?.length) {
                    setMcpServerStatuses(result.servers as McpServerStatus[]);
                  }
                }).catch(() => { /* session may have been stopped */ });
              }, 3000);
            }
          }
          // Fetch available models from the SDK
          {
            const modelsSid = sessionIdRef.current;
            if (modelsSid) {
              window.claude.supportedModels(modelsSid).then((result) => {
                if (result.models?.length) {
                  setSupportedModels(result.models);
                }
              }).catch(() => { /* session may have been stopped */ });
            }
          }

          setIsConnected(true);
          setIsProcessing(true);
          break;
        }

        case "stream_event": {
          const { event: streamEvt } = event;

          switch (streamEvt.type) {
            case "message_start": {
              resetStreaming();
              const id = nextId("stream");
              buffer.current.messageId = id;
              uiLog("MSG_START", { id });
              setMessages((prev) => [
                ...prev,
                { id, role: "assistant" as const, content: "", isStreaming: true, timestamp: Date.now() },
              ]);
              break;
            }

            case "content_block_start": {
              buffer.current.startBlock(streamEvt.index, streamEvt.content_block);
              break;
            }

            case "content_block_delta": {
              const needsFlush = buffer.current.appendDelta(streamEvt.index, streamEvt.delta);
              if (needsFlush) scheduleFlush();
              break;
            }

            case "content_block_stop": {
              const { index } = streamEvt;
              const thinkingDone = buffer.current.stopBlock(index);
              if (thinkingDone) scheduleFlush();
              const toolMeta = buffer.current.getToolMeta(index);
              if (toolMeta) {
                const rawInput = buffer.current.getRawToolInput(index);
                let parsedInput: Record<string, unknown> = {};
                try {
                  parsedInput = JSON.parse(rawInput);
                } catch {
                  parsedInput = { raw: rawInput };
                }

                const isTask = toolMeta.name === "Task";
                const msgId = `tool-${toolMeta.id}`;

                setMessages((prev) => {
                  if (prev.some((m) => m.id === msgId)) return prev;
                  return [
                    ...prev,
                    {
                      id: msgId,
                      role: "tool_call",
                      content: "",
                      toolName: toolMeta.name,
                      toolInput: parsedInput,
                      timestamp: Date.now(),
                      ...(isTask ? { subagentSteps: [], subagentStatus: "running" as const } : {}),
                    },
                  ];
                });

                if (isTask) {
                  parentToolMap.current.set(toolMeta.id, msgId);
                  uiLog("TASK_REGISTERED", { toolId: toolMeta.id, msgId });
                }
              }
              break;
            }

            case "message_delta": {
              flushNow();
              setMessages((prev) => {
                const streamId = buffer.current.messageId;
                const target = streamId
                  ? prev.find((m) => m.id === streamId)
                  : prev.findLast((m) => m.role === "assistant" && m.isStreaming);
                if (!target) return prev;
                if (!target.content.trim() && !target.thinking) {
                  return prev.filter((m) => m.id !== target.id);
                }
                return prev.map((m) =>
                  m.id === target.id ? { ...m, isStreaming: false } : m,
                );
              });
              break;
            }

            case "message_stop": {
              resetStreaming();
              break;
            }
          }
          break;
        }

        case "assistant": {
          flushNow();
          uiLog("ASSISTANT_MSG", { uuid: event.uuid?.slice(0, 12) });

          // Extract per-message usage for context tracking
          const msgUsage = (event.message as AssistantMessageEvent["message"] & {
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          }).usage;
          if (msgUsage) {
            setContextUsage((prev) => ({
              inputTokens: msgUsage.input_tokens ?? 0,
              outputTokens: msgUsage.output_tokens ?? 0,
              cacheReadTokens: msgUsage.cache_read_input_tokens ?? 0,
              cacheCreationTokens: msgUsage.cache_creation_input_tokens ?? 0,
              contextWindow: prev?.contextWindow ?? 200_000,
            }));
          }

          const textContent = extractTextContent(event.message.content);
          const thinkingContent = extractThinkingContent(event.message.content);

          setMessages((prev) => {
            const streamId = buffer.current.messageId;
            const target = streamId
              ? prev.find((m) => m.id === streamId)
              : prev.findLast((m) => m.role === "assistant" && m.isStreaming);

            if (target) {
              if (!streamId) buffer.current.messageId = target.id;
              const merged = {
                ...target,
                content: textContent || target.content,
                thinking: thinkingContent || target.thinking || undefined,
                ...(thinkingContent ? { thinkingComplete: true } : {}),
              };
              if (!merged.content.trim() && !merged.thinking) {
                return prev.filter((m) => m.id !== target.id);
              }
              return prev.map((m) => (m.id === target.id ? merged : m));
            }

            if (textContent || thinkingContent) {
              return [
                ...prev,
                {
                  id: `assistant-${event.uuid}`,
                  role: "assistant",
                  content: textContent,
                  thinking: thinkingContent || undefined,
                  ...(thinkingContent ? { thinkingComplete: true } : {}),
                  isStreaming: false,
                  timestamp: Date.now(),
                },
              ];
            }
            return prev;
          });

          for (const block of event.message.content) {
            if (block.type === "tool_use") {
              const isTask = block.name === "Task";
              const msgId = `tool-${block.id}`;
              setMessages((prev) => {
                if (prev.some((m) => m.id === msgId)) return prev;
                return [
                  ...prev,
                  {
                    id: msgId,
                    role: "tool_call",
                    content: "",
                    toolName: block.name,
                    toolInput: block.input,
                    timestamp: Date.now(),
                    ...(isTask ? { subagentSteps: [], subagentStatus: "running" as const } : {}),
                  },
                ];
              });
              if (isTask) {
                parentToolMap.current.set(block.id, msgId);
                uiLog("TASK_REGISTERED", { toolId: block.id, msgId });
              }
            }
          }
          break;
        }

        case "user": {
          const rawContent = event.message.content;

          // Tool result — update the matching tool_call message
          if (Array.isArray(rawContent) && rawContent[0]?.type === "tool_result") {
            const toolResult = rawContent[0];
            const toolUseId = toolResult.tool_use_id;
            const isError = !!toolResult.is_error;
            const resultMeta = normalizeToolResult(event.tool_use_result, toolResult.content);
            uiLog("TOOL_RESULT", {
              tool_use_id: toolUseId?.slice(0, 12),
              isAsync: resultMeta?.isAsync,
              status: resultMeta?.status,
              isError,
            });

            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== `tool-${toolUseId}`) return m;
                if (m.toolName === "Task" && resultMeta) {
                  return {
                    ...m,
                    toolResult: resultMeta,
                    toolError: isError || undefined,
                    subagentStatus: "completed" as const,
                    subagentId: resultMeta.agentId,
                    subagentDurationMs: resultMeta.totalDurationMs,
                    subagentTokens: resultMeta.totalTokens,
                  };
                }
                return { ...m, toolResult: resultMeta, toolError: isError || undefined };
              }),
            );
            break;
          }

          // Text content (string or array of text blocks).
          // Only treat as a context summary if a compact_boundary placeholder
          // is waiting to be filled — otherwise this is an SDK bookkeeping event
          // (e.g. "[Request interrupted by user]") that doesn't need UI display.
          let textPayload: string | null = null;
          if (typeof rawContent === "string") {
            textPayload = rawContent.trim() || null;
          } else if (Array.isArray(rawContent)) {
            const textBlocks = rawContent.filter(
              (b): b is { type: "text"; text: string } => b.type === "text",
            );
            if (textBlocks.length) {
              textPayload = textBlocks.map((b) => b.text).join("\n");
            }
          }

          if (textPayload) {
            // Checkpoint UUID from replayed user messages (replay-user-messages flag).
            // TypeScript narrows event to ToolResultEvent in case "user".
            const checkpointUuid = event.uuid;

            setMessages((prev) => {
              // Look for an unfilled compact_boundary placeholder
              const compactIdx = prev.findLastIndex(
                (m) => m.role === "summary" && m.id.startsWith("compact-") && !m.content,
              );
              if (compactIdx >= 0) {
                // Fill the placeholder with the summary content
                uiLog("CONTEXT_SUMMARY", { length: textPayload.length });
                return prev.map((m, i) =>
                  i === compactIdx ? { ...m, content: textPayload } : m,
                );
              }

              // Stamp checkpoint UUID on the first user message without one.
              // With replay-user-messages, the SDK replays user text in order,
              // so sequential matching assigns UUIDs to the correct messages.
              if (checkpointUuid) {
                const userIdx = prev.findIndex(
                  (m) => m.role === "user" && !m.checkpointId,
                );
                if (userIdx >= 0) {
                  uiLog("CHECKPOINT", { uuid: checkpointUuid.slice(0, 12), msgIdx: userIdx });
                  return prev.map((m, i) =>
                    i === userIdx ? { ...m, checkpointId: checkpointUuid } : m,
                  );
                }
              }

              return prev;
            });
          }
          break;
        }

        case "result": {
          uiLog("RESULT", { subtype: event.subtype, cost: event.total_cost_usd, turns: event.num_turns });
          setIsProcessing(false);
          setTotalCost((prev) => prev + (event.total_cost_usd ?? 0));

          // Surface SDK error results to the user.
          // Respect is_error flag — when false, the SDK considers it a non-fatal result
          // (e.g. interrupt teardown with LSP cleanup errors). Only show genuine errors,
          // or user-relevant limit subtypes (max_turns, max_budget) regardless of is_error.
          const resultEvent = event as ResultEvent;
          const isUserRelevantError = resultEvent.is_error
            || resultEvent.subtype === "error_max_turns"
            || resultEvent.subtype === "error_max_budget_usd"
            || resultEvent.subtype === "error_max_structured_output_retries";
          if (isUserRelevantError) {
            const errorMsg = resultEvent.errors?.join("\n")
              || resultEvent.result
              || "An error occurred";
            setMessages((prev) => [
              ...prev,
              {
                id: nextId("system-result-error"),
                role: "system",
                content: formatResultError(resultEvent.subtype, errorMsg),
                isError: true,
                timestamp: Date.now(),
              },
            ]);
          }

          // Extract contextWindow from modelUsage if available
          if (resultEvent.modelUsage) {
            const entries = Object.values(resultEvent.modelUsage);
            const primaryEntry = entries.find((e) => e.contextWindow > 0);
            if (primaryEntry) {
              setContextUsage((prev) =>
                prev ? { ...prev, contextWindow: primaryEntry.contextWindow } : prev,
              );
            }
          }

          resetStreaming();
          break;
        }

        case "auth_status": {
          const authEvt = event as AuthStatusEvent;
          uiLog("AUTH_STATUS", { isAuthenticating: authEvt.isAuthenticating, error: authEvt.error, output: authEvt.output?.length ?? 0 });
          // Surface auth errors to user
          if (authEvt.error) {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId("system-auth-error"),
                role: "system",
                content: `Authentication error: ${authEvt.error}`,
                isError: true,
                timestamp: Date.now(),
              },
            ]);
          }
          // After auth completes, refresh MCP server statuses
          if (!authEvt.isAuthenticating && sessionIdRef.current) {
            window.claude.mcpStatus(sessionIdRef.current).then((result) => {
              if (result.servers?.length) {
                setMcpServerStatuses(result.servers as McpServerStatus[]);
              }
            }).catch(() => { /* session may have been stopped */ });
          }
          break;
        }
      }
    },
    [resetStreaming, scheduleFlush, flushNow, handleSubagentEvent],
  );

  const send = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string): Promise<boolean> => {
      if (!sessionIdRef.current) return false;
      const content = buildSdkContent(text, images);
      const result = await window.claude.send(sessionIdRef.current, {
        type: "user",
        message: { role: "user", content },
      });
      if (result?.error) {
        return false;
      }
      // Both updates in the same synchronous scope so React batches them into
      // one render.  Previously setIsProcessing(true) fired before the await,
      // creating an intermediate render where isProcessing=true but the user
      // message wasn't in the array yet — which made extractTurnSummaries drop
      // the last completed turn's inline change summary.
      setIsProcessing(true);
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
      return true;
    },
    [],
  );

  const stop = useCallback(async () => {
    if (!sessionIdRef.current) return;
    await window.claude.stop(sessionIdRef.current);
    setIsConnected(false);
    setIsProcessing(false);
    setIsCompacting(false);
    resetStreaming();
  }, [resetStreaming]);

  const interrupt = useCallback(async () => {
    if (!sessionIdRef.current) return;

    // Flush any rAF-buffered streaming content to React state
    flushNow();

    // Interrupt the current turn via IPC (session stays alive)
    await window.claude.interrupt(sessionIdRef.current);

    // Responsive UI — don't wait for the result event
    setIsProcessing(false);
    setIsCompacting(false);
    setPendingPermission(null);

    // Finalize streaming message: keep partial content, remove if empty
    setMessages((prev) => {
      const streamId = buffer.current.messageId;
      const target = streamId
        ? prev.find((m) => m.id === streamId)
        : prev.findLast((m) => m.role === "assistant" && m.isStreaming);
      if (!target) return prev;
      if (!target.content.trim() && !target.thinking) {
        return prev.filter((m) => m.id !== target.id);
      }
      return prev.map((m) =>
        m.id === target.id ? { ...m, isStreaming: false } : m,
      );
    });

    // Reset streaming buffer for next turn
    resetStreaming();
  }, [flushNow, resetStreaming]);

  const respondPermission = useCallback(
    async (behavior: "allow" | "deny", updatedInput?: Record<string, unknown>, newPermissionMode?: string) => {
      if (!pendingPermission || !sessionIdRef.current) return;
      await window.claude.respondPermission(
        sessionIdRef.current,
        pendingPermission.requestId,
        behavior,
        pendingPermission.toolUseId,
        updatedInput ?? pendingPermission.toolInput,
        newPermissionMode,
      );
      if (newPermissionMode) {
        setSessionInfo((prev) => prev ? { ...prev, permissionMode: newPermissionMode } : prev);
      }
      setPendingPermission(null);
    },
    [pendingPermission],
  );

  useEffect(() => {
    const unsubEvent = window.claude.onEvent(handleEvent);
    const unsubPermission = window.claude.onPermissionRequest((data) => {
      if (data._sessionId !== sessionIdRef.current) return;
      uiLog("PERMISSION_REQUEST", { tool: data.toolName, requestId: data.requestId });
      setPendingPermission({
        requestId: data.requestId,
        toolName: data.toolName,
        toolInput: data.toolInput,
        toolUseId: data.toolUseId,
        suggestions: data.suggestions,
        decisionReason: data.decisionReason,
      });
    });
    const unsubExit = window.claude.onExit((data) => {
      if (data._sessionId !== sessionIdRef.current) return;
      setIsConnected(false);
      setIsProcessing(false);
      setIsCompacting(false);
      setPendingPermission(null);
      if (data.code !== 0 && data.code !== null) {
        const errorDetail = data.error || `Process exited with code ${data.code}`;
        setMessages((prev) => [
          ...prev,
          {
            id: nextId("system-exit"),
            role: "system",
            content: errorDetail,
            isError: true,
            timestamp: Date.now(),
          },
        ]);
      }
    });
    return () => {
      unsubEvent();
      unsubPermission();
      unsubExit();
      if (pendingFlush.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [handleEvent]);

  const setPermissionMode = useCallback(async (mode: string) => {
    if (!sessionIdRef.current) return;
    const result = await window.claude.setPermissionMode(sessionIdRef.current, mode);
    if (result?.ok) {
      setSessionInfo((prev) => prev ? { ...prev, permissionMode: mode } : prev);
    }
  }, []);

  const compact = useCallback(async () => {
    if (!sessionIdRef.current) return;
    setIsCompacting(true);
    setIsProcessing(true);
    await window.claude.send(sessionIdRef.current, {
      type: "user",
      message: { role: "user", content: "/compact" },
    });
  }, []);

  const refreshMcpStatus = useCallback(async () => {
    if (!sessionIdRef.current) return;
    const result = await window.claude.mcpStatus(sessionIdRef.current);
    if (result.servers?.length) {
      setMcpServerStatuses(result.servers as McpServerStatus[]);
    }
  }, []);

  const reconnectMcpServer = useCallback(async (serverName: string) => {
    if (!sessionIdRef.current) return;
    const result = await window.claude.mcpReconnect(sessionIdRef.current, serverName);
    // If the session was restarted (to inject fresh OAuth tokens),
    // wait for the new session to fully initialize before refreshing status
    if (result?.restarted) {
      await new Promise((r) => setTimeout(r, 3000));
    }
    await refreshMcpStatus();
  }, [refreshMcpStatus]);

  /** Restart the session with a fresh MCP server list (after add/remove) */
  const restartWithMcpServers = useCallback(async (mcpServers: McpServerConfig[]) => {
    if (!sessionIdRef.current) return;
    const result = await window.claude.restartSession(sessionIdRef.current, mcpServers);
    if (result?.restarted) {
      await new Promise((r) => setTimeout(r, 3000));
    }
    await refreshMcpStatus();
  }, [refreshMcpStatus]);

  /** Revert files on disk to the state before the given checkpoint (user message UUID) */
  const revertFiles = useCallback(async (checkpointId: string) => {
    if (!sessionIdRef.current) return { error: "No session" };
    const result = await window.claude.revertFiles(sessionIdRef.current, checkpointId);
    // Show feedback as a system message so the user knows the revert happened (or failed)
    setMessages((prev) => [
      ...prev,
      {
        id: nextId("system-revert"),
        role: "system" as const,
        content: result.error
          ? `File revert failed: ${result.error}`
          : "Files reverted to checkpoint successfully.",
        isError: !!result.error,
        timestamp: Date.now(),
      },
    ]);
    return result;
  }, []);

  return {
    messages,
    setMessages,
    isProcessing,
    isConnected,
    setIsConnected,
    sessionInfo,
    totalCost,
    setTotalCost,
    contextUsage,
    isCompacting,
    send,
    stop,
    interrupt,
    compact,
    pendingPermission,
    respondPermission,
    setPermissionMode,
    mcpServerStatuses,
    refreshMcpStatus,
    reconnectMcpServer,
    restartWithMcpServers,
    supportedModels,
    revertFiles,
    flushNow,
    resetStreaming,
  };
}
