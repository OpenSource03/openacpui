import { useCallback, useEffect, useRef } from "react";
import type { ImageAttachment, SessionMeta, UIMessage } from "@/types";
import { useEngineBase } from "./useEngineBase";

interface UseOllamaOptions {
  sessionId: string | null;
  initialMessages?: import("@/types").UIMessage[];
  initialMeta?: SessionMeta | null;
  cwd?: string;
  model?: string;
}

type OllamaEvent = {
  _sessionId: string;
  type: string;
  payload: Record<string, unknown>;
};

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function useOllama({ sessionId, initialMessages, initialMeta, cwd, model }: UseOllamaOptions) {
  const base = useEngineBase({ sessionId, initialMessages, initialMeta, initialPermission: null });
  const {
    messages, setMessages,
    isProcessing, setIsProcessing,
    isConnected, setIsConnected,
    sessionInfo, setSessionInfo,
    totalCost, setTotalCost,
    pendingPermission, setPendingPermission,
    contextUsage, setContextUsage,
    sessionIdRef,
  } = base;

  const streamingMsgId = useRef<string | null>(null);
  // toolUseId → UIMessage id (for pairing tool:start with tool:result)
  const toolMsgIds = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    streamingMsgId.current = null;
    toolMsgIds.current = new Map();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const unsub = window.claude.ollama.onEvent((event: OllamaEvent) => {
      if (event._sessionId !== sessionIdRef.current) return;

      switch (event.type) {
        case "lifecycle:start":
          setIsProcessing(true);
          break;

        case "chat:thinking": {
          const thinkText = (event.payload.text as string) ?? "";
          if (!streamingMsgId.current) {
            const id = nextId("ollama-stream");
            streamingMsgId.current = id;
            setMessages(prev => [...prev, {
              id,
              role: "assistant",
              content: "",
              thinking: thinkText,
              isStreaming: true,
              timestamp: Date.now(),
            }]);
          } else {
            const id = streamingMsgId.current;
            setMessages(prev => prev.map(m =>
              m.id === id ? { ...m, thinking: thinkText } : m
            ));
          }
          break;
        }

        case "chat:delta": {
          const text = (event.payload.text as string) ?? "";
          if (!streamingMsgId.current) {
            const id = nextId("ollama-stream");
            streamingMsgId.current = id;
            setMessages(prev => [...prev, {
              id,
              role: "assistant",
              content: text,
              isStreaming: true,
              timestamp: Date.now(),
            }]);
          } else {
            const id = streamingMsgId.current;
            setMessages(prev => prev.map(m =>
              m.id === id ? { ...m, content: text } : m
            ));
          }
          break;
        }

        case "chat:final": {
          const finalMsg = (event.payload.message as string) ?? "";
          const id = streamingMsgId.current;
          if (id) {
            setMessages(prev => prev.map(m =>
              m.id === id ? { ...m, content: finalMsg, isStreaming: false } : m
            ));
            streamingMsgId.current = null;
          } else if (finalMsg) {
            setMessages(prev => [...prev, {
              id: nextId("ollama-final"),
              role: "assistant" as const,
              content: finalMsg,
              isStreaming: false,
              timestamp: Date.now(),
            }]);
          }
          setIsProcessing(false);
          break;
        }

        case "chat:mid-final": {
          const midMsg = (event.payload.message as string) ?? "";
          const midId = streamingMsgId.current;
          if (midId) {
            setMessages(prev => prev.map(m =>
              m.id === midId ? { ...m, content: midMsg, isStreaming: false } : m
            ));
            streamingMsgId.current = null;
          } else if (midMsg) {
            setMessages(prev => [...prev, {
              id: nextId("ollama-mid"),
              role: "assistant" as const,
              content: midMsg,
              isStreaming: false,
              timestamp: Date.now(),
            }]);
          }
          break;
        }

        case "chat:clear-streaming": {
          // Model only emitted tool tags — remove the empty streaming message
          const clearId = streamingMsgId.current;
          if (clearId) {
            setMessages(prev => prev.filter(m => m.id !== clearId));
            streamingMsgId.current = null;
          }
          break;
        }

        case "tool:start": {
          // Model started executing a tool — show a loading card
          const { toolUseId, toolName, input } = event.payload as {
            toolUseId: string;
            toolName: string;
            input: Record<string, unknown>;
          };
          const msgId = nextId("ollama-tool");
          toolMsgIds.current.set(toolUseId, msgId);
          const toolMsg: UIMessage = {
            id: msgId,
            role: "tool_call",
            content: "",
            toolName,
            toolInput: input,
            isStreaming: true,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, toolMsg]);
          break;
        }

        case "tool:result": {
          // Tool finished — update the card with the result
          const { toolUseId, toolName, result } = event.payload as {
            toolUseId: string;
            toolName: string;
            result: Record<string, unknown>;
          };
          const msgId = toolMsgIds.current.get(toolUseId);
          if (msgId) {
            setMessages(prev => prev.map(m =>
              m.id === msgId
                ? { ...m, isStreaming: false, toolResult: result, toolError: !!(result.error) }
                : m
            ));
            toolMsgIds.current.delete(toolUseId);
          } else {
            // No matching start event — create a standalone result card
            setMessages(prev => [...prev, {
              id: nextId("ollama-tool-result"),
              role: "tool_call",
              content: "",
              toolName: toolName as string,
              toolResult: result,
              isStreaming: false,
              timestamp: Date.now(),
            }]);
          }
          break;
        }

        case "context:usage": {
          const { used, limit } = event.payload as { used: number; limit: number };
          setContextUsage({
            inputTokens: used,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            contextWindow: limit,
          });
          break;
        }

        case "chat:error": {
          // Finalize any in-progress message
          if (streamingMsgId.current) {
            const id = streamingMsgId.current;
            setMessages(prev => prev.map(m =>
              m.id === id ? { ...m, isStreaming: false } : m
            ));
            streamingMsgId.current = null;
          }
          setIsProcessing(false);
          setMessages(prev => [...prev, {
            id: nextId("ollama-error"),
            role: "system",
            content: (event.payload.message as string) ?? "Ollama error",
            isError: true,
            timestamp: Date.now(),
          }]);
          break;
        }
      }
    });

    const unsubExit = window.claude.ollama.onExit((data) => {
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

  const send = useCallback(async (text: string, _images?: ImageAttachment[], _displayText?: string) => {
    if (!sessionIdRef.current) return;

    const msgId = nextId("user");
    setMessages(prev => [...prev, {
      id: msgId,
      role: "user" as const,
      content: text,
      timestamp: Date.now(),
    }]);

    setIsProcessing(true);

    const result = await window.claude.ollama.send(sessionIdRef.current, text, cwd, model);
    if (result?.error) {
      setIsProcessing(false);
      setMessages(prev => [...prev, {
        id: nextId("ollama-send-error"),
        role: "system",
        content: result.error!,
        isError: true,
        timestamp: Date.now(),
      }]);
    }
  }, [sessionIdRef, setIsProcessing, setMessages, cwd, model]);

  const stop = useCallback(async () => {
    if (!sessionIdRef.current) return;
    await window.claude.ollama.stop(sessionIdRef.current);
    setIsProcessing(false);
    setIsConnected(false);
  }, [sessionIdRef, setIsProcessing, setIsConnected]);

  const interrupt = useCallback(async () => {
    if (!sessionIdRef.current) return;
    await window.claude.ollama.interrupt(sessionIdRef.current);
  }, [sessionIdRef]);

  const respondPermission = useCallback(async () => {
    setPendingPermission(null);
  }, [setPendingPermission]);

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
    contextUsage,
    pendingPermission,
    respondPermission,
    setPermissionMode,
    compact,
    send,
    stop,
    interrupt,
  };
}
