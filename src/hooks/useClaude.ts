import { useState, useCallback, useEffect, useRef } from "react";
import type {
  ClaudeEvent,
  SystemInitEvent,
  SystemStatusEvent,
  SystemCompactBoundaryEvent,
  TaskProgressEvent,
  TaskNotificationEvent,
  AuthStatusEvent,
  AssistantMessageEvent,
  ToolResultEvent,
  ResultEvent,
  SubagentToolStep,
  ImageAttachment,
  CodeSnippet,
  ModelInfo,
  McpServerStatus,
  McpServerConfig,
  PermissionBehavior,
  PermissionRequest,
  SessionMeta,
  SlashCommand,
} from "../types";
import { toMcpStatusState } from "../lib/mcp-utils";
import { StreamingBuffer } from "../lib/streaming-buffer";
import {
  getParentId,
  extractTextContent,
  extractThinkingContent,
  extractAssistantContextUsage,
  normalizeToolResult,
  buildSdkContent,
} from "../lib/protocol";
import { formatResultError } from "../lib/message-factory";
import { bgAgentStore } from "../lib/background-agent-store";
import { suppressNextSessionCompletion } from "../lib/notification-utils";
import { advancePermissionQueue, enqueuePermissionRequest } from "../lib/permission-queue";
import { normalizeTodoToolInput } from "../lib/todo-utils";
import { capture } from "../lib/analytics";
import { useEngineBase } from "./useEngineBase";

function uiLog(label: string, data: unknown) {
  window.claude.log(label, typeof data === "string" ? data : JSON.stringify(data));
}

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

type ParentToolMap = Map<string, string>;

interface UseClaudeOptions {
  sessionId: string | null;
  initialMessages?: import("../types").UIMessage[];
  initialMeta?: SessionMeta | null;
  initialPermission?: import("../types").PermissionRequest | null;
}

export function useClaude({ sessionId, initialMessages, initialMeta, initialPermission }: UseClaudeOptions) {
  const base = useEngineBase({ sessionId, initialMessages, initialMeta, initialPermission });
  const {
    messages, setMessages,
    isProcessing, setIsProcessing,
    isConnected, setIsConnected,
    sessionInfo, setSessionInfo,
    totalCost, setTotalCost,
    pendingPermission, setPendingPermission,
    contextUsage, setContextUsage,
    isCompacting, setIsCompacting,
    sessionIdRef, messagesRef,
    scheduleFlush: scheduleRaf,
    cancelPendingFlush,
  } = base;

  const [mcpServerStatuses, setMcpServerStatuses] = useState<McpServerStatus[]>([]);
  const [supportedModels, setSupportedModels] = useState<ModelInfo[]>([]);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);

  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;

  const buffer = useRef(new StreamingBuffer());
  const parentToolMap = useRef<ParentToolMap>(new Map());
  const permissionQueue = useRef<PermissionRequest[]>([]);
  const permissionResponseInFlight = useRef(false);
  const respondingPermissionIds = useRef<Set<string>>(new Set());
  const completedPermissionIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    buffer.current.reset();
    parentToolMap.current.clear();
    permissionQueue.current = [];
    permissionResponseInFlight.current = false;
    respondingPermissionIds.current.clear();
    completedPermissionIds.current.clear();

    const msgs = initialMessages ?? [];
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

  const streamingIndexRef = useRef(-1);

  const flushStreamingToState = useCallback(() => {
    const allText = buffer.current.getAllText();
    const allThinking = buffer.current.getAllThinking();
    const { thinkingComplete } = buffer.current;
    const capturedMessageId = buffer.current.messageId;
    setMessages((prev) => {
      let idx = streamingIndexRef.current;
      if (idx < 0 || idx >= prev.length || prev[idx].id !== capturedMessageId) {
        idx = capturedMessageId
          ? prev.findIndex((m) => m.id === capturedMessageId)
          : prev.findLastIndex((m) => m.role === "assistant" && m.isStreaming);
        if (idx < 0) return prev;
        streamingIndexRef.current = idx;
        if (!capturedMessageId) buffer.current.messageId = prev[idx].id;
      }
      const target = prev[idx];
      const contentChanged = allText !== target.content;
      const thinkingChanged = allThinking && allThinking !== (target.thinking ?? "");
      const thinkingCompleteChanged = thinkingComplete && !target.thinkingComplete;
      if (!contentChanged && !thinkingChanged && !thinkingCompleteChanged) return prev;
      const updated = {
        ...target,
        ...(contentChanged ? { content: allText } : {}),
        ...(thinkingChanged ? { thinking: allThinking } : {}),
        ...(thinkingCompleteChanged ? { thinkingComplete: true } : {}),
      };
      const next = prev.slice();
      next[idx] = updated;
      return next;
    });
  }, [setMessages]);

  const scheduleFlush = useCallback(() => {
    scheduleRaf(flushStreamingToState);
  }, [scheduleRaf, flushStreamingToState]);

  const flushNow = useCallback(() => {
    cancelPendingFlush();
    flushStreamingToState();
  }, [cancelPendingFlush, flushStreamingToState]);

  const resetStreaming = useCallback(() => {
    buffer.current.reset();
    streamingIndexRef.current = -1;
    cancelPendingFlush();
  }, [cancelPendingFlush]);

  const handleSubagentEvent = useCallback((event: ClaudeEvent, parentId: string) => {
    const taskMsgId = parentToolMap.current.get(parentId);
    if (!taskMsgId) return;

    if (event.type === "assistant") {
      const assistantEvent = event as AssistantMessageEvent;
      for (const block of assistantEvent.message.content) {
        if (block.type === "tool_use") {
          const step: SubagentToolStep = {
            toolName: block.name,
            toolInput: normalizeTodoToolInput(block.name, block.input),
            toolUseId: block.id,
          };
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === taskMsgId);
            if (idx < 0) return prev;
            const next = prev.slice();
            next[idx] = { ...prev[idx], subagentSteps: [...(prev[idx].subagentSteps ?? []), step] };
            return next;
          });
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
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === taskMsgId);
          if (idx < 0) return prev;
          const steps = (prev[idx].subagentSteps ?? []).map((s) =>
            s.toolUseId === toolUseId ? { ...s, toolResult: resultMeta, toolError: isError || undefined } : s,
          );
          const next = prev.slice();
          next[idx] = { ...prev[idx], subagentSteps: steps };
          return next;
        });
      }
    }
  }, []);

  const handleEvent = useCallback(
    (event: ClaudeEvent & { _sessionId?: string }) => {
      if (event._sessionId && event._sessionId !== sessionIdRef.current) return;

      if (event.type === "system" && "subtype" in event) {
        const sub = (event as { subtype: string }).subtype;
        if (sub === "task_progress") {
          const sid = sessionIdRef.current;
          if (!sid) return;
          bgAgentStore.handleTaskProgress(sid, event as TaskProgressEvent);
          return;
        }
        if (sub === "task_notification") {
          const sid = sessionIdRef.current;
          if (!sid) return;
          bgAgentStore.handleTaskNotification(sid, event as TaskNotificationEvent);
          return;
        }
      }

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
            const statusEvent = event as SystemStatusEvent;
            if (statusEvent.status === "compacting") {
              setIsCompacting(true);
              setIsProcessing(true);
            }
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
            const sid = sessionIdRef.current;
            if (sid) {
              setTimeout(() => {
                window.claude.mcpStatus(sid).then((result) => {
                  if (result.servers?.length) {
                    setMcpServerStatuses(result.servers as McpServerStatus[]);
                  }
                }).catch(() => { });
              }, 3000);
            }
          }
          {
            const modelsSid = sessionIdRef.current;
            if (modelsSid) {
              window.claude.supportedModels(modelsSid).then((result) => {
                if (result.models?.length) {
                  setSupportedModels(result.models);
                }
              }).catch(() => { });
            }
          }

          if (init.slash_commands?.length) {
            setSlashCommands(init.slash_commands.map(name => ({
              name,
              description: "",
              source: "claude" as const,
            })));
          }

          {
            const cmdSid = sessionIdRef.current;
            if (cmdSid) {
              window.claude.slashCommands(cmdSid).then((result) => {
                if (result.commands?.length) {
                  setSlashCommands(result.commands.map(cmd => ({
                    name: cmd.name,
                    description: cmd.description ?? "",
                    argumentHint: cmd.argumentHint,
                    source: "claude" as const,
                  })));
                }
              }).catch(() => { });
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
              setMessages((prev) => {
                streamingIndexRef.current = prev.length;
                return [
                  ...prev,
                  { id, role: "assistant" as const, content: "", isStreaming: true, timestamp: Date.now() },
                ];
              });
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

                const isTask = toolMeta.name === "Task" || toolMeta.name === "Agent";
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
              const capturedId = buffer.current.messageId;
              setMessages((prev) => {
                const idx = capturedId
                  ? prev.findIndex((m) => m.id === capturedId)
                  : prev.findLastIndex((m) => m.role === "assistant" && m.isStreaming);
                if (idx < 0) return prev;
                const target = prev[idx];
                if (!target.content.trim() && !target.thinking) {
                  return prev.filter((m) => m.id !== target.id);
                }
                const next = prev.slice();
                next[idx] = { ...target, isStreaming: false };
                return next;
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

          const nextUsage = extractAssistantContextUsage(
            event.message,
            contextUsageRef.current?.contextWindow ?? 200_000,
          );
          if (nextUsage) {
            setContextUsage(nextUsage);
          }

          const textContent = extractTextContent(event.message.content);
          const thinkingContent = extractThinkingContent(event.message.content);

          setMessages((prev) => {
            const streamId = buffer.current.messageId;
            const idx = streamId
              ? prev.findIndex((m) => m.id === streamId)
              : prev.findLastIndex((m) => m.role === "assistant" && m.isStreaming);

            if (idx >= 0) {
              const target = prev[idx];
              if (!streamId) buffer.current.messageId = target.id;
              const merged = {
                ...target,
                content: textContent || target.content,
                thinking: thinkingContent || target.thinking || undefined,
                ...(textContent ? { isStreaming: false } : {}),
                ...(thinkingContent ? { thinkingComplete: true } : {}),
              };
              if (!merged.content.trim() && !merged.thinking) {
                return prev.filter((m) => m.id !== target.id);
              }
              const next = prev.slice();
              next[idx] = merged;
              return next;
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
              const isTask = block.name === "Task" || block.name === "Agent";
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
                    toolInput: normalizeTodoToolInput(block.name, block.input),
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

          if (typeof rawContent === "string" && rawContent.includes("<task-notification>")) {
            const sid = sessionIdRef.current;
            if (sid) bgAgentStore.handleUserMessage(sid, rawContent);
          }

          if (Array.isArray(rawContent) && rawContent[0]?.type === "tool_result") {
            const toolResult = rawContent[0];
            const toolUseId = toolResult.tool_use_id;
            const isError = !!toolResult.is_error;
            const toolCallId = `tool-${toolUseId}`;
            const toolName = messagesRef.current.find((m) => m.id === toolCallId)?.toolName;
            const resultMeta = normalizeToolResult(event.tool_use_result, toolResult.content);
            uiLog("TOOL_RESULT", {
              tool_use_id: toolUseId?.slice(0, 12),
              isAsync: resultMeta?.isAsync,
              status: resultMeta?.status,
              isError,
            });

            if (resultMeta?.isAsync && resultMeta.outputFile && toolUseId) {
              bgAgentStore.registerAsyncAgent(sessionIdRef.current!, {
                toolUseId,
                agentId: resultMeta.agentId ?? toolUseId,
                description: String(resultMeta.description ?? "Background agent"),
                outputFile: resultMeta.outputFile,
              });
            }

            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === toolCallId);
              if (idx < 0) return prev;
              const m = prev[idx];
              const updated = (m.toolName === "Task" || m.toolName === "Agent") && resultMeta
                ? {
                    ...m,
                    toolResult: resultMeta,
                    toolError: isError || undefined,
                    subagentStatus: "completed" as const,
                    subagentId: resultMeta.agentId,
                    subagentDurationMs: resultMeta.totalDurationMs,
                    subagentTokens: resultMeta.totalTokens,
                  }
                : { ...m, toolResult: resultMeta, toolError: isError || undefined };
              const next = prev.slice();
              next[idx] = updated;
              return next;
            });

            if (!isError && toolName === "EnterPlanMode") {
              setSessionInfo((prev) =>
                prev ? { ...prev, permissionMode: "plan" } : prev,
              );
            }
            break;
          }

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
            const checkpointUuid = event.uuid;

            setMessages((prev) => {
              const compactIdx = prev.findLastIndex(
                (m) => m.role === "summary" && m.id.startsWith("compact-") && !m.content,
              );
              if (compactIdx >= 0) {
                uiLog("CONTEXT_SUMMARY", { length: textPayload.length });
                const next = prev.slice();
                next[compactIdx] = { ...prev[compactIdx], content: textPayload };
                return next;
              }

              if (checkpointUuid) {
                const userIdx = prev.findIndex(
                  (m) => m.role === "user" && !m.checkpointId,
                );
                if (userIdx >= 0) {
                  uiLog("CHECKPOINT", { uuid: checkpointUuid.slice(0, 12), msgIdx: userIdx });
                  const next = prev.slice();
                  next[userIdx] = { ...prev[userIdx], checkpointId: checkpointUuid };
                  return next;
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

          if (resultEvent.modelUsage) {
            const entries = Object.values(resultEvent.modelUsage);
            const primaryEntry = entries.find((e) => e.contextWindow > 0);
            if (primaryEntry) {
              setContextUsage((prev) =>
                prev ? { ...prev, contextWindow: primaryEntry.contextWindow } : prev,
              );
            }
          }

          setMessages((prev) => {
            const hasStreaming = prev.some((m) => m.isStreaming);
            if (!hasStreaming) return prev;
            return prev.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m);
          });

          resetStreaming();
          break;
        }

        case "auth_status": {
          const authEvt = event as AuthStatusEvent;
          uiLog("AUTH_STATUS", { isAuthenticating: authEvt.isAuthenticating, error: authEvt.error, output: authEvt.output?.length ?? 0 });
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
          if (!authEvt.isAuthenticating && sessionIdRef.current) {
            window.claude.mcpStatus(sessionIdRef.current).then((result) => {
              if (result.servers?.length) {
                setMcpServerStatuses(result.servers as McpServerStatus[]);
              }
            }).catch(() => { });
          }
          break;
        }
      }
    },
    [resetStreaming, scheduleFlush, flushNow, handleSubagentEvent],
  );

  const send = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string, codeSnippets?: CodeSnippet[]): Promise<boolean> => {
      if (!sessionIdRef.current) return false;
      const content = buildSdkContent(text, images);
      const result = await window.claude.send(sessionIdRef.current, {
        type: "user",
        message: { role: "user", content },
      });
      if (result?.error) {
        return false;
      }
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
          ...(codeSnippets?.length ? { codeSnippets } : {}),
        },
      ]);
      return true;
    },
    [],
  );

  const sendRaw = useCallback(
    async (text: string, images?: ImageAttachment[]): Promise<boolean> => {
      if (!sessionIdRef.current) return false;
      const content = buildSdkContent(text, images);
      const result = await window.claude.send(sessionIdRef.current, {
        type: "user",
        message: { role: "user", content },
      });
      if (result?.error) return false;
      setIsProcessing(true);
      return true;
    },
    [],
  );

  const stop = useCallback(async () => {
    if (!sessionIdRef.current) return;
    suppressNextSessionCompletion(sessionIdRef.current);
    await window.claude.stop(sessionIdRef.current, "user");
    setIsConnected(false);
    setIsProcessing(false);
    setIsCompacting(false);
    resetStreaming();
  }, [resetStreaming]);

  const interrupt = useCallback(async () => {
    if (!sessionIdRef.current) return;
    suppressNextSessionCompletion(sessionIdRef.current);

    flushNow();

    await window.claude.interrupt(sessionIdRef.current);

    setIsProcessing(false);
    setIsCompacting(false);
    permissionQueue.current = [];
    permissionResponseInFlight.current = false;
    respondingPermissionIds.current.clear();
    completedPermissionIds.current.clear();
    setPendingPermission(null);

    setMessages((prev) => {
      const streamId = buffer.current.messageId;
      const idx = streamId
        ? prev.findIndex((m) => m.id === streamId)
        : prev.findLastIndex((m) => m.role === "assistant" && m.isStreaming);
      if (idx < 0) return prev;
      const target = prev[idx];
      if (!target.content.trim() && !target.thinking) {
        return prev.filter((m) => m.id !== target.id);
      }
      const next = prev.slice();
      next[idx] = { ...target, isStreaming: false };
      return next;
    });

    resetStreaming();
  }, [flushNow, resetStreaming]);

  const respondPermission = useCallback(
    async (behavior: PermissionBehavior, updatedInput?: Record<string, unknown>, newPermissionMode?: string, updatedPermissions?: unknown[]) => {
      const currentPermission = pendingPermission;
      const sid = sessionIdRef.current;
      if (!currentPermission || !sid || permissionResponseInFlight.current) return;
      if (respondingPermissionIds.current.has(currentPermission.requestId)) return;
      if (completedPermissionIds.current.has(currentPermission.requestId)) return;

      permissionResponseInFlight.current = true;
      respondingPermissionIds.current.add(currentPermission.requestId);
      let result: { ok?: boolean; error?: string } | undefined;
      try {
        result = await window.claude.respondPermission(
          sid,
          currentPermission.requestId,
          behavior,
          currentPermission.toolUseId,
          updatedInput ?? currentPermission.toolInput,
          newPermissionMode,
          updatedPermissions,
        );
      } finally {
        permissionResponseInFlight.current = false;
        respondingPermissionIds.current.delete(currentPermission.requestId);
      }
      if (result?.error) {
        if (result.error === "No pending permission request") {
          completedPermissionIds.current.add(currentPermission.requestId);
          const nextState = advancePermissionQueue({
            current: currentPermission,
            queue: permissionQueue.current,
          });
          permissionQueue.current = nextState.queue;
          setPendingPermission(nextState.current);
        }
        return;
      }
      completedPermissionIds.current.add(currentPermission.requestId);
      capture("permission_responded", {
        tool_name: currentPermission.toolName,
        decision: behavior,
      });
      if (newPermissionMode) {
        setSessionInfo((prev) => prev ? { ...prev, permissionMode: newPermissionMode } : prev);
      }
      const nextState = advancePermissionQueue({
        current: currentPermission,
        queue: permissionQueue.current,
      });
      permissionQueue.current = nextState.queue;
      setPendingPermission(nextState.current);
    },
    [pendingPermission],
  );

  useEffect(() => {
    const unsubEvent = window.claude.onEvent(handleEvent);
    const unsubPermission = window.claude.onPermissionRequest((data) => {
      if (data._sessionId !== sessionIdRef.current) return;
      uiLog("PERMISSION_REQUEST", { tool: data.toolName, requestId: data.requestId });
      const request: PermissionRequest = {
        requestId: data.requestId,
        toolName: data.toolName,
        toolInput: data.toolInput,
        toolUseId: data.toolUseId,
        suggestions: data.suggestions,
        decisionReason: data.decisionReason,
      };
      setPendingPermission((current) => {
        const nextState = enqueuePermissionRequest(
          {
            current,
            queue: permissionQueue.current,
          },
          request,
          {
            inFlight: permissionResponseInFlight.current,
            respondingIds: respondingPermissionIds.current,
            completedIds: completedPermissionIds.current,
          },
        );
        permissionQueue.current = nextState.queue;
        return nextState.current;
      });
    });
    const unsubExit = window.claude.onExit((data) => {
      if (data._sessionId !== sessionIdRef.current) return;
      setIsConnected(false);
      setIsProcessing(false);
      setIsCompacting(false);
      permissionQueue.current = [];
      permissionResponseInFlight.current = false;
      respondingPermissionIds.current.clear();
      completedPermissionIds.current.clear();
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
      cancelPendingFlush();
    };
  }, [handleEvent]);

  const setPermissionMode = useCallback(async (mode: string) => {
    if (!sessionIdRef.current) return;
    const result = await window.claude.setPermissionMode(sessionIdRef.current, mode);
    if (result?.ok) {
      setSessionInfo((prev) => prev ? { ...prev, permissionMode: mode } : prev);
    }
  }, []);

  const setModel = useCallback(async (model: string) => {
    if (!sessionIdRef.current) return { error: "No session" };
    const result = await window.claude.setModel(sessionIdRef.current, model);
    if (result?.ok) {
      setSessionInfo((prev) => prev ? { ...prev, model } : prev);
    }
    return result;
  }, []);

  const setThinkingEnabled = useCallback(async (thinkingEnabled: boolean) => {
    if (!sessionIdRef.current) return { error: "No session" };
    return window.claude.setThinking(sessionIdRef.current, thinkingEnabled);
  }, []);

  const compact = useCallback(async () => {
    if (!sessionIdRef.current) return;
    capture("context_compaction_triggered", { trigger: "manual" });
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
    if (result?.restarted) {
      await new Promise((r) => setTimeout(r, 3000));
    }
    await refreshMcpStatus();
  }, [refreshMcpStatus]);

  const restartWithMcpServers = useCallback(async (mcpServers: McpServerConfig[]) => {
    if (!sessionIdRef.current) return;
    const result = await window.claude.restartSession(sessionIdRef.current, mcpServers);
    if (result?.restarted) {
      await new Promise((r) => setTimeout(r, 3000));
    }
    await refreshMcpStatus();
  }, [refreshMcpStatus]);

  const revertFiles = useCallback(async (checkpointId: string) => {
    if (!sessionIdRef.current) return { error: "No session" };
    const result = await window.claude.revertFiles(sessionIdRef.current, checkpointId);
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
    setIsProcessing,
    isConnected,
    setIsConnected,
    sessionInfo,
    totalCost,
    setTotalCost,
    contextUsage,
    isCompacting,
    send,
    sendRaw,
    stop,
    interrupt,
    compact,
    pendingPermission,
    respondPermission,
    setPermissionMode,
    setModel,
    setThinkingEnabled,
    mcpServerStatuses,
    refreshMcpStatus,
    reconnectMcpServer,
    restartWithMcpServers,
    supportedModels,
    slashCommands,
    revertFiles,
    flushNow,
    resetStreaming,
  };
}
