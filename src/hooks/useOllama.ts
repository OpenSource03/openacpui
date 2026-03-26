import { useCallback, useEffect, useRef } from "react";
import type { ImageAttachment, SessionMeta } from "@/types";
import { useEngineBase } from "./useEngineBase";

interface UseOllamaOptions {
  sessionId: string | null;
  initialMessages?: import("@/types").UIMessage[];
  initialMeta?: SessionMeta | null;
}

type OllamaEvent = {
  _sessionId: string;
  type: string;
  payload: Record<string, unknown>;
};

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function useOllama({ sessionId, initialMessages, initialMeta }: UseOllamaOptions) {
  const base = useEngineBase({ sessionId, initialMessages, initialMeta, initialPermission: null });
  const {
    messages, setMessages,
    isProcessing, setIsProcessing,
    isConnected, setIsConnected,
    sessionInfo, setSessionInfo,
    totalCost, setTotalCost,
    pendingPermission, setPendingPermission,
    contextUsage,
    sessionIdRef,
  } = base;

  const streamingMsgId = useRef<string | null>(null);

  useEffect(() => {
    streamingMsgId.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const unsub = window.claude.ollama.onEvent((event: OllamaEvent) => {
      if (event._sessionId !== sessionIdRef.current) return;

      switch (event.type) {
        case "lifecycle:start":
          setIsProcessing(true);
          break;

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
          }
          setIsProcessing(false);
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

    const result = await window.claude.ollama.send(sessionIdRef.current, text);
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
  }, [sessionIdRef, setIsProcessing, setMessages]);

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
