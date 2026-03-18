import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClaudeEvent,
  AssistantMessageEvent,
  ResultEvent,
  PermissionRequest,
  SessionMeta,
  UIMessage,
} from "../types";
import type { AgentSlot, GroupSessionEvent } from "../types/groups";
import { StreamingBuffer } from "../lib/streaming-buffer";
import {
  extractTextContent,
  extractThinkingContent,
  getParentId,
} from "../lib/protocol";
import { formatResultError } from "../lib/message-factory";
import { advancePermissionQueue, enqueuePermissionRequest } from "../lib/permission-queue";
import { useEngineBase } from "./useEngineBase";

interface UseGroupEngineOptions {
  sessionId: string | null;
  projectId?: string;
  initialMessages?: UIMessage[];
  initialMeta?: SessionMeta | null;
  initialPermission?: PermissionRequest | null;
}

interface SlotMeta {
  label: string;
  color: string;
  engine: string;
  model: string;
}

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function useGroupEngine({ sessionId, projectId, initialMessages, initialMeta, initialPermission }: UseGroupEngineOptions) {
  const base = useEngineBase({ sessionId, initialMessages, initialMeta, initialPermission });
  const {
    messages, setMessages,
    isProcessing, setIsProcessing,
    isConnected, setIsConnected,
    sessionInfo, setSessionInfo,
    totalCost, setTotalCost,
    pendingPermission, setPendingPermission,
    contextUsage, setContextUsage,
    isCompacting,
    sessionIdRef,
    scheduleFlush: scheduleRaf,
    cancelPendingFlush,
  } = base;

  const slotBuffers = useRef<Map<string, StreamingBuffer>>(new Map());
  const slotStreamingIndex = useRef<Map<string, number>>(new Map());
  const slotMetaMap = useRef<Map<string, SlotMeta>>(new Map());
  const [activeSlots, setActiveSlots] = useState<Map<string, { label: string; color: string; activity: "typing" | "thinking" | "tool" }>>(new Map());
  const permissionQueue = useRef<PermissionRequest[]>([]);
  const permissionResponseInFlight = useRef(false);
  const respondingPermissionIds = useRef<Set<string>>(new Set());
  const completedPermissionIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    slotBuffers.current.clear();
    slotStreamingIndex.current.clear();
    permissionQueue.current = [];
    permissionResponseInFlight.current = false;
    respondingPermissionIds.current.clear();
    completedPermissionIds.current.clear();
  }, [sessionId]);


  const getOrCreateBuffer = useCallback((slotId: string): StreamingBuffer => {
    let buf = slotBuffers.current.get(slotId);
    if (!buf) {
      buf = new StreamingBuffer();
      slotBuffers.current.set(slotId, buf);
    }
    return buf;
  }, []);

  const flushAllSlotsToState = useCallback(() => {
    const updates: Array<{ messageId: string; text: string; thinking: string; thinkingComplete: boolean }> = [];
    for (const [, buf] of slotBuffers.current) {
      if (!buf.messageId) continue;
      updates.push({
        messageId: buf.messageId,
        text: buf.getAllText(),
        thinking: buf.getAllThinking(),
        thinkingComplete: buf.thinkingComplete,
      });
    }
    if (updates.length === 0) return;
    setMessages((prev) => {
      let changed = false;
      const next = prev.slice();
      for (const upd of updates) {
        const idx = next.findIndex((m) => m.id === upd.messageId);
        if (idx < 0) continue;
        const target = next[idx];
        const contentChanged = upd.text !== target.content;
        const thinkingChanged = upd.thinking && upd.thinking !== (target.thinking ?? "");
        const thinkingCompleteChanged = upd.thinkingComplete && !target.thinkingComplete;
        if (!contentChanged && !thinkingChanged && !thinkingCompleteChanged) continue;
        changed = true;
        next[idx] = {
          ...target,
          ...(contentChanged ? { content: upd.text } : {}),
          ...(thinkingChanged ? { thinking: upd.thinking } : {}),
          ...(thinkingCompleteChanged ? { thinkingComplete: true } : {}),
        };
      }
      return changed ? next : prev;
    });
  }, [setMessages]);

  const scheduleFlush = useCallback(() => {
    scheduleRaf(flushAllSlotsToState);
  }, [scheduleRaf, flushAllSlotsToState]);

  const flushNow = useCallback(() => {
    cancelPendingFlush();
    flushAllSlotsToState();
  }, [cancelPendingFlush, flushAllSlotsToState]);

  const resetSlotStreaming = useCallback((slotId: string) => {
    const buf = slotBuffers.current.get(slotId);
    if (buf) buf.reset();
    slotStreamingIndex.current.delete(slotId);
  }, []);

  const resetAllStreaming = useCallback(() => {
    for (const [, buf] of slotBuffers.current) buf.reset();
    slotBuffers.current.clear();
    slotStreamingIndex.current.clear();
    cancelPendingFlush();
  }, [cancelPendingFlush]);

  const handleClaudeEvent = useCallback(
    (event: ClaudeEvent & { _sessionId?: string; _groupSessionId?: string; _slotId?: string }) => {
      if (!event._groupSessionId || event._groupSessionId !== sessionIdRef.current) return;
      const slotId = event._slotId;
      if (!slotId) return;

      const parentId = getParentId(event);
      if (parentId) return;

      switch (event.type) {
        case "system": {
          if ("subtype" in event && event.subtype === "init") {
            const init = event as { model?: string; cwd?: string; session_id?: string };
            if (!sessionInfo) {
              setSessionInfo({
                sessionId: init.session_id ?? sessionIdRef.current ?? "",
                model: init.model ?? "",
                cwd: init.cwd ?? "",
                tools: [],
                version: "",
              });
            }
            setIsConnected(true);
          }
          break;
        }

        case "stream_event": {
          const { event: streamEvt } = event;
          const buf = getOrCreateBuffer(slotId);
          const meta = slotMetaMap.current.get(slotId);
          const groupSlot = meta
            ? { label: meta.label, color: meta.color, engine: meta.engine, model: meta.model }
            : { label: slotId, color: "#6b7280", engine: "claude", model: "" };

          switch (streamEvt.type) {
            case "message_start": {
              resetSlotStreaming(slotId);
              const id = nextId(`group-${slotId}`);
              buf.messageId = id;
              slotStreamingIndex.current.set(slotId, -1);
              setMessages((prev) => [
                ...prev,
                {
                  id,
                  role: "assistant" as const,
                  content: "",
                  isStreaming: true,
                  timestamp: Date.now(),
                  groupSlot,
                },
              ]);
              setActiveSlots((prev) => {
                const next = new Map(prev);
                next.set(slotId, { label: groupSlot.label, color: groupSlot.color, activity: "thinking" });
                return next;
              });
              break;
            }
            case "content_block_start": {
              buf.startBlock(streamEvt.index, streamEvt.content_block);
              const blockType = (streamEvt.content_block as Record<string, unknown>)?.type;
              if (blockType === "thinking") {
                setActiveSlots((prev) => {
                  const existing = prev.get(slotId);
                  if (existing?.activity === "thinking") return prev;
                  const next = new Map(prev);
                  next.set(slotId, { label: groupSlot.label, color: groupSlot.color, activity: "thinking" });
                  return next;
                });
              } else if (blockType === "text") {
                setActiveSlots((prev) => {
                  const existing = prev.get(slotId);
                  if (existing?.activity === "typing") return prev;
                  const next = new Map(prev);
                  next.set(slotId, { label: groupSlot.label, color: groupSlot.color, activity: "typing" });
                  return next;
                });
              }
              break;
            }
            case "content_block_delta": {
              const needsFlush = buf.appendDelta(streamEvt.index, streamEvt.delta);
              if (needsFlush) scheduleFlush();
              break;
            }
            case "content_block_stop": {
              const thinkingDone = buf.stopBlock(streamEvt.index);
              if (thinkingDone) scheduleFlush();
              break;
            }
            case "message_delta": {
              flushNow();
              setActiveSlots((prev) => {
                if (!prev.has(slotId)) return prev;
                const next = new Map(prev);
                next.delete(slotId);
                return next;
              });
              const capturedId = buf.messageId;
              setMessages((prev) => {
                const idx = capturedId
                  ? prev.findIndex((m) => m.id === capturedId)
                  : -1;
                if (idx < 0) return prev;
                const target = prev[idx];
                if (!target.content.trim() && !target.thinking) {
                  return prev.filter((m) => m.id !== target.id);
                }
                if (target.content.trim() === "[PASS]") {
                  return prev.filter((m) => m.id !== target.id);
                }
                const next = prev.slice();
                next[idx] = { ...target, isStreaming: false };
                return next;
              });
              break;
            }
            case "message_stop": {
              resetSlotStreaming(slotId);
              setActiveSlots((prev) => {
                if (!prev.has(slotId)) return prev;
                const next = new Map(prev);
                next.delete(slotId);
                return next;
              });
              break;
            }
          }
          break;
        }

        case "assistant": {
          flushNow();
          const buf = getOrCreateBuffer(slotId);
          const textContent = extractTextContent((event as AssistantMessageEvent).message.content);
          const thinkingContent = extractThinkingContent((event as AssistantMessageEvent).message.content);

          const isPass = textContent.trim() === "[PASS]";

          if (isPass) {
            const streamId = buf.messageId;
            if (streamId) {
              setMessages((prev) => prev.filter((m) => m.id !== streamId));
            }
            resetSlotStreaming(slotId);
            break;
          }

          const meta = slotMetaMap.current.get(slotId);
          const groupSlot = meta
            ? { label: meta.label, color: meta.color, engine: meta.engine, model: meta.model }
            : { label: slotId, color: "#6b7280", engine: "claude", model: "" };

          setMessages((prev) => {
            const streamId = buf.messageId;
            const idx = streamId
              ? prev.findIndex((m) => m.id === streamId)
              : -1;

            if (idx >= 0) {
              const target = prev[idx];
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
                  id: nextId(`group-assistant-${slotId}`),
                  role: "assistant" as const,
                  content: textContent,
                  thinking: thinkingContent || undefined,
                  ...(thinkingContent ? { thinkingComplete: true } : {}),
                  isStreaming: false,
                  timestamp: Date.now(),
                  groupSlot,
                },
              ];
            }
            return prev;
          });
          break;
        }

        case "result": {
          const resultEvent = event as ResultEvent;
          setTotalCost((prev) => prev + (resultEvent.total_cost_usd ?? 0));

          const isUserRelevantError = resultEvent.is_error
            || resultEvent.subtype === "error_max_turns"
            || resultEvent.subtype === "error_max_budget_usd";
          if (isUserRelevantError) {
            const errorMsg = resultEvent.errors?.join("\n")
              || resultEvent.result
              || "An error occurred";
            setMessages((prev) => [
              ...prev,
              {
                id: nextId("group-error"),
                role: "system",
                content: formatResultError(resultEvent.subtype, errorMsg),
                isError: true,
                timestamp: Date.now(),
              },
            ]);
          }

          resetSlotStreaming(slotId);
          break;
        }
      }
    },
    [sessionInfo, getOrCreateBuffer, resetSlotStreaming, scheduleFlush, flushNow],
  );

  const handleGroupEvent = useCallback(
    (event: GroupSessionEvent) => {
      if (event.sessionId !== sessionIdRef.current) return;

      switch (event.type) {
        case "status":
          if (event.status === "running") {
            setIsProcessing(true);
            setIsConnected(true);
          }
          break;

        case "message": {
          const msg = event.message;
          if (!msg || msg.role === "user") break;
          if (msg.content?.trim() === "[PASS]") break;
          const meta = slotMetaMap.current.get(event.slotId ?? "");
          if (meta?.engine === "claude") break;
          const groupSlot = meta
            ? { label: meta.label, color: meta.color, engine: meta.engine, model: meta.model }
            : event.slotId
              ? { label: event.slotId, color: "#6b7280", engine: "unknown", model: "" }
              : undefined;
          setMessages((prev) => [
            ...prev,
            {
              id: msg.id || nextId("group-msg"),
              role: "assistant" as const,
              content: msg.content,
              isStreaming: false,
              timestamp: typeof msg.timestamp === "string" ? new Date(msg.timestamp).getTime() : Date.now(),
              groupSlot,
            },
          ]);
          break;
        }

        case "complete":
          flushNow();
          setIsProcessing(false);
          setActiveSlots(new Map());
          setMessages((prev) => {
            const hasStreaming = prev.some((m) => m.isStreaming);
            if (!hasStreaming) return prev;
            return prev.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m);
          });
          resetAllStreaming();
          break;

        case "error":
          setMessages((prev) => [
            ...prev,
            {
              id: nextId("group-event-error"),
              role: "system",
              content: `Error${event.slotId ? ` (slot ${event.slotId})` : ""}: ${event.error}`,
              isError: true,
              timestamp: Date.now(),
            },
          ]);
          break;
      }
    },
    [flushNow, resetAllStreaming],
  );

  const handlePermissionRequest = useCallback(
    (data: {
      _sessionId: string;
      _groupSessionId?: string;
      _slotId?: string;
      requestId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      toolUseId: string;
      suggestions?: unknown[];
      decisionReason?: string;
    }) => {
      if (data._groupSessionId !== sessionIdRef.current) return;
      const request: PermissionRequest = {
        requestId: data.requestId,
        toolName: data.toolName,
        toolInput: data.toolInput,
        toolUseId: data.toolUseId,
        suggestions: data.suggestions as PermissionRequest["suggestions"],
        decisionReason: data.decisionReason,
        slotSessionId: data._sessionId,
      };
      setPendingPermission((current) => {
        const nextState = enqueuePermissionRequest(
          { current, queue: permissionQueue.current },
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
    },
    [],
  );

  useEffect(() => {
    if (!sessionId) return;

    const unsubEvent = window.claude.onEvent(handleClaudeEvent as (event: unknown) => void);
    const unsubGroupEvent = window.claude.groups.onEvent(handleGroupEvent);
    const unsubPermission = window.claude.onPermissionRequest(
      handlePermissionRequest as (data: unknown) => void,
    );
    const unsubExit = window.claude.onExit((data) => {
      const exitData = data as { _sessionId: string; _groupSessionId?: string; _slotId?: string; code: number | null; error?: string };
      if (exitData._groupSessionId !== sessionIdRef.current) return;
      if (exitData._slotId) {
        resetSlotStreaming(exitData._slotId);
      }
    });

    return () => {
      unsubEvent();
      unsubGroupEvent();
      unsubPermission();
      unsubExit();
      cancelPendingFlush();
    };
  }, [sessionId, handleClaudeEvent, handleGroupEvent, handlePermissionRequest, resetSlotStreaming, cancelPendingFlush]);

  const registerSlotMeta = useCallback((slots: AgentSlot[]) => {
    slotMetaMap.current.clear();
    for (const slot of slots) {
      slotMetaMap.current.set(slot.id, {
        label: slot.label,
        color: slot.color,
        engine: slot.engine,
        model: slot.model,
      });
    }
  }, []);

  const send = useCallback(async (text: string) => {
    if (!sessionIdRef.current) return;
    setIsProcessing(true);
    setMessages((prev) => [
      ...prev,
      {
        id: nextId("user"),
        role: "user" as const,
        content: text,
        timestamp: Date.now(),
      },
    ]);
    const result = await window.claude.groups.sendMessage(sessionIdRef.current, text, projectId);
    if (result && !result.ok) {
      setIsProcessing(false);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId("group-error"),
          role: "system" as const,
          content: `Failed to send: ${result.error ?? "Unknown error"}`,
          isError: true,
          timestamp: Date.now(),
        },
      ]);
    }
  }, []);

  const stop = useCallback(async () => {
    if (!sessionIdRef.current) return;
    await window.claude.groups.stopSession(sessionIdRef.current);
    setIsProcessing(false);
    setIsConnected(false);
    resetAllStreaming();
  }, [resetAllStreaming]);

  const interrupt = useCallback(async () => {
    if (!sessionIdRef.current) return;
    flushNow();
    try {
      await window.claude.groups.interrupt(sessionIdRef.current);
    } catch {}
    setIsProcessing(false);
    permissionQueue.current = [];
    permissionResponseInFlight.current = false;
    respondingPermissionIds.current.clear();
    completedPermissionIds.current.clear();
    setPendingPermission(null);
    setMessages((prev) => {
      const hasStreaming = prev.some((m) => m.isStreaming);
      if (!hasStreaming) return prev;
      return prev.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m);
    });
    resetAllStreaming();
  }, [flushNow, resetAllStreaming]);

  const respondPermission = useCallback(
    async (behavior: string, updatedInput?: Record<string, unknown>) => {
      const currentPermission = pendingPermission;
      const sid = currentPermission?.slotSessionId || sessionIdRef.current;
      if (!currentPermission || !sid || permissionResponseInFlight.current) return;
      if (respondingPermissionIds.current.has(currentPermission.requestId)) return;
      if (completedPermissionIds.current.has(currentPermission.requestId)) return;

      permissionResponseInFlight.current = true;
      respondingPermissionIds.current.add(currentPermission.requestId);
      try {
        await window.claude.respondPermission(
          sid,
          currentPermission.requestId,
          behavior as import("../types/engine").AppPermissionBehavior,
          currentPermission.toolUseId,
          updatedInput ?? currentPermission.toolInput,
        );
      } finally {
        permissionResponseInFlight.current = false;
        respondingPermissionIds.current.delete(currentPermission.requestId);
      }
      completedPermissionIds.current.add(currentPermission.requestId);
      const nextState = advancePermissionQueue({
        current: currentPermission,
        queue: permissionQueue.current,
      });
      permissionQueue.current = nextState.queue;
      setPendingPermission(nextState.current);
    },
    [pendingPermission],
  );

  const setPermissionMode = useCallback(async (_mode: string) => {}, []);

  const compact = useCallback(async () => {}, []);

  return {
    messages,
    setMessages,
    isProcessing,
    setIsProcessing,
    isConnected,
    setIsConnected,
    sessionInfo,
    setSessionInfo,
    totalCost,
    setTotalCost,
    pendingPermission,
    respondPermission,
    activeSlots,
    contextUsage,
    setContextUsage,
    isCompacting,
    send,
    stop,
    interrupt,
    setPermissionMode,
    compact,
    registerSlotMeta,
  };
}
