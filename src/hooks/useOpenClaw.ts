import { useCallback, useEffect, useRef } from "react";
import type { ImageAttachment, CodeSnippet, SessionMeta } from "@/types";
import type { OpenClawSessionEvent } from "@shared/types/openclaw";
import { SimpleStreamingBuffer } from "@/lib/streaming-buffer";
import { useEngineBase } from "./useEngineBase";

interface UseOpenClawOptions {
  sessionId: string | null;
  initialMessages?: import("@/types").UIMessage[];
  initialMeta?: SessionMeta | null;
  initialPermission?: import("@/types").PermissionRequest | null;
}

function openclawLog(label: string, data: unknown): void {
  console.log(`[OpenClaw] ${label}`, data);
}

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function useOpenClaw({ sessionId, initialMessages, initialMeta, initialPermission }: UseOpenClawOptions) {
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

  const buffer = useRef(new SimpleStreamingBuffer());

  useEffect(() => {
    buffer.current.reset();
    cancelPendingFlush();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const flushStreamingToState = useCallback(() => {
    const buf = buffer.current;
    if (!buf.messageId) return;
    const text = buf.getText();
    setMessages(prev => prev.map(m => {
      if (m.id !== buf.messageId) return m;
      return { ...m, content: text };
    }));
  }, [setMessages]);

  const scheduleFlush = useCallback(() => {
    scheduleRaf(flushStreamingToState);
  }, [scheduleRaf, flushStreamingToState]);

  const ensureStreamingMessage = useCallback(() => {
    if (buffer.current.messageId) return;
    const id = nextId("openclaw-stream");
    buffer.current.messageId = id;
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
    flushStreamingToState();
    setMessages(prev => prev.map(m =>
      m.id === buf.messageId ? { ...m, isStreaming: false } : m
    ));
    buf.reset();
  }, [flushStreamingToState, setMessages]);

  useEffect(() => {
    if (!sessionId) return;

    const unsub = window.claude.openclaw.onEvent((event: OpenClawSessionEvent) => {
      if (event._sessionId !== sessionIdRef.current) return;

      switch (event.type) {
        case "lifecycle:start":
          setIsProcessing(true);
          break;

        case "chat:delta":
          ensureStreamingMessage();
          buffer.current.appendText((event.payload.text as string) ?? "");
          scheduleFlush();
          break;

        case "thinking:delta": {
          ensureStreamingMessage();
          const thinkingText = (event.payload.text as string) ?? "";
          if (thinkingText) {
            setMessages(prev => prev.map(m => {
              if (m.id !== buffer.current.messageId) return m;
              return { ...m, thinking: (m.thinking ?? "") + thinkingText };
            }));
          }
          break;
        }

        case "thinking:done":
          setMessages(prev => prev.map(m => {
            if (m.id !== buffer.current.messageId) return m;
            return { ...m, thinkingComplete: true };
          }));
          break;

        case "chat:final": {
          const finalMsg = (event.payload.message as string) ?? "";
          const buf2 = buffer.current;
          if (buf2.messageId) {
            setMessages(prev => prev.map(m =>
              m.id === buf2.messageId ? { ...m, content: finalMsg, isStreaming: false } : m
            ));
            buf2.reset();
          }
          setIsProcessing(false);
          break;
        }

        case "chat:error":
          finalizeStreamingMessage();
          setIsProcessing(false);
          setMessages(prev => [...prev, {
            id: nextId("openclaw-error"),
            role: "system",
            content: (event.payload.message as string) ?? "OpenClaw error",
            isError: true,
            timestamp: Date.now(),
          }]);
          break;

        case "tool:start": {
          const toolUseId = (event.payload.toolUseId as string) ?? nextId("tool-use");
          setMessages(prev => [...prev, {
            id: toolUseId,
            role: "tool_call",
            content: "",
            toolName: (event.payload.toolName as string) ?? "unknown",
            toolInput: event.payload.input as Record<string, unknown>,
            timestamp: Date.now(),
          }]);
          break;
        }

        case "tool:result": {
          const resultToolUseId = (event.payload.toolUseId as string) ?? "";
          const resultToolName = (event.payload.toolName as string) ?? "";
          setMessages(prev => prev.map(m => {
            if (m.role !== "tool_call" || m.toolResult) return m;
            if (resultToolUseId && m.id === resultToolUseId) {
              return { ...m, toolResult: event.payload.result as Record<string, unknown> };
            }
            if (!resultToolUseId && m.toolName === resultToolName) {
              return { ...m, toolResult: event.payload.result as Record<string, unknown> };
            }
            return m;
          }));
          break;
        }

        case "agent:spawn": {
          const agentId = (event.payload.agentId as string) ?? nextId("agent");
          const agentName = (event.payload.agentName as string) ?? "Agent";
          const prompt = (event.payload.prompt as string) ?? "";
          setMessages(prev => [...prev, {
            id: agentId,
            role: "tool_call",
            content: "",
            toolName: "Task",
            toolInput: { prompt, description: `${agentName}: ${prompt}` },
            subagentId: agentId,
            subagentSteps: [],
            subagentStatus: "running",
            timestamp: Date.now(),
          }]);
          break;
        }

        case "agent:step": {
          const agentId = (event.payload.agentId as string) ?? "";
          const step = {
            toolName: (event.payload.toolName as string) ?? "unknown",
            toolInput: (event.payload.input as Record<string, unknown>) ?? {},
            toolResult: event.payload.result as Record<string, unknown> | undefined,
            toolUseId: (event.payload.stepId as string) ?? nextId("step"),
            toolError: (event.payload.error as boolean) ?? false,
          };
          setMessages(prev => prev.map(m => {
            if (m.id !== agentId) return m;
            return { ...m, subagentSteps: [...(m.subagentSteps ?? []), step] };
          }));
          break;
        }

        case "agent:message": {
          const agentId = (event.payload.agentId as string) ?? "";
          const text = (event.payload.text as string) ?? "";
          setMessages(prev => prev.map(m => {
            if (m.id !== agentId) return m;
            return { ...m, content: (m.content ?? "") + text };
          }));
          break;
        }

        case "agent:complete": {
          const agentId = (event.payload.agentId as string) ?? "";
          const result = event.payload.result as Record<string, unknown> | undefined;
          const durationMs = (event.payload.durationMs as number) ?? undefined;
          setMessages(prev => prev.map(m => {
            if (m.id !== agentId) return m;
            return {
              ...m,
              subagentStatus: "completed" as const,
              subagentDurationMs: durationMs,
              toolResult: result ?? { content: m.content || "Done" },
            };
          }));
          break;
        }

        case "lifecycle:end":
          finalizeStreamingMessage();
          setIsProcessing(false);
          break;

        case "status":
          openclawLog("STATUS", event.payload);
          break;
      }
    });

    const unsubExit = window.claude.openclaw.onExit((data) => {
      if (data._sessionId !== sessionIdRef.current) return;
      setIsConnected(false);
      setIsProcessing(false);
    });

    setIsConnected(true);

    return () => {
      unsub();
      unsubExit();
    };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (text: string, images?: ImageAttachment[], displayText?: string, _codeSnippets?: CodeSnippet[]) => {
    if (!sessionIdRef.current) {
      openclawLog("SEND_SKIP", "no sessionId");
      return;
    }

    const msgId = nextId("user");
    setMessages(prev => [...prev, {
      id: msgId,
      role: "user" as const,
      content: text,
      timestamp: Date.now(),
      ...(images?.length ? { images } : {}),
      ...(displayText ? { displayContent: displayText } : {}),
      ...(_codeSnippets?.length ? { codeSnippets: _codeSnippets } : {}),
    }]);

    setIsProcessing(true);

    const result = await window.claude.openclaw.send(sessionIdRef.current, text);
    if (result?.error) {
      setIsProcessing(false);
      setMessages(prev => [...prev, {
        id: nextId("openclaw-send-error"),
        role: "system",
        content: result.error!,
        isError: true,
        timestamp: Date.now(),
      }]);
    }
  }, [sessionIdRef, setIsProcessing, setMessages]);

  const stop = useCallback(async () => {
    if (!sessionIdRef.current) return;
    await window.claude.openclaw.stop(sessionIdRef.current);
    setIsProcessing(false);
    setIsConnected(false);
  }, [sessionIdRef, setIsProcessing, setIsConnected]);

  const interrupt = useCallback(async () => {
    if (!sessionIdRef.current) return;
    await window.claude.openclaw.interrupt(sessionIdRef.current);
  }, [sessionIdRef]);

  const respondPermission = useCallback(async () => {
    setPendingPermission(null);
  }, [setPendingPermission]);

  const setPermissionMode = useCallback(async (_mode: string) => {
  }, []);

  const compact = useCallback(async () => {
  }, []);

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
    contextUsage,
    setContextUsage,
    send,
    stop,
    interrupt,
    setPermissionMode,
    compact,
  };
}
