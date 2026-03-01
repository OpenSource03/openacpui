/**
 * useEngineBase — shared foundation for all engine hooks (useClaude, useACP, useCodex).
 *
 * Provides the 8 common state variables, reset effect on sessionId change,
 * and rAF-based streaming flush scheduling. Each engine hook calls this
 * and adds only its engine-specific event handling and IPC calls.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { UIMessage, SessionInfo, PermissionRequest, ContextUsage, SessionMeta } from "@/types";

export interface UseEngineBaseOptions {
  sessionId: string | null;
  initialMessages?: UIMessage[];
  initialMeta?: SessionMeta | null;
  initialPermission?: PermissionRequest | null;
}

export interface EngineBaseState {
  // State
  messages: UIMessage[];
  setMessages: Dispatch<SetStateAction<UIMessage[]>>;
  isProcessing: boolean;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
  isConnected: boolean;
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  sessionInfo: SessionInfo | null;
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>;
  totalCost: number;
  setTotalCost: Dispatch<SetStateAction<number>>;
  pendingPermission: PermissionRequest | null;
  setPendingPermission: Dispatch<SetStateAction<PermissionRequest | null>>;
  contextUsage: ContextUsage | null;
  setContextUsage: Dispatch<SetStateAction<ContextUsage | null>>;
  isCompacting: boolean;
  setIsCompacting: Dispatch<SetStateAction<boolean>>;

  // Refs
  sessionIdRef: React.RefObject<string | null>;
  messagesRef: React.RefObject<UIMessage[]>;

  // rAF scheduling — engine hooks call scheduleFlush after pushing data to their buffer
  pendingFlush: React.RefObject<boolean>;
  rafId: React.RefObject<number>;
  scheduleFlush: (flushFn: () => void) => void;
  cancelPendingFlush: () => void;
}

export function useEngineBase({
  sessionId,
  initialMessages,
  initialMeta,
  initialPermission,
}: UseEngineBaseOptions): EngineBaseState {
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages ?? []);
  const [isProcessing, setIsProcessing] = useState(initialMeta?.isProcessing ?? false);
  const [isConnected, setIsConnected] = useState(initialMeta?.isConnected ?? false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(initialMeta?.sessionInfo ?? null);
  const [totalCost, setTotalCost] = useState(initialMeta?.totalCost ?? 0);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(initialPermission ?? null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const messagesRef = useRef<UIMessage[]>(messages);
  messagesRef.current = messages;

  // rAF scheduling refs
  const pendingFlush = useRef(false);
  const rafId = useRef(0);

  // Reset state when sessionId changes, restoring background state if available
  useEffect(() => {
    setMessages(initialMessages ?? []);
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
    setPendingPermission(initialPermission ?? null);
    setContextUsage(null);
    setIsCompacting(false);
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shared rAF scheduling — engines provide their own flush function
  const scheduleFlush = useCallback((flushFn: () => void) => {
    if (pendingFlush.current) return;
    pendingFlush.current = true;
    rafId.current = requestAnimationFrame(() => {
      pendingFlush.current = false;
      flushFn();
    });
  }, []);

  const cancelPendingFlush = useCallback(() => {
    if (pendingFlush.current) {
      cancelAnimationFrame(rafId.current);
      pendingFlush.current = false;
    }
  }, []);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (pendingFlush.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  return {
    messages, setMessages,
    isProcessing, setIsProcessing,
    isConnected, setIsConnected,
    sessionInfo, setSessionInfo,
    totalCost, setTotalCost,
    pendingPermission, setPendingPermission,
    contextUsage, setContextUsage,
    isCompacting, setIsCompacting,
    sessionIdRef,
    messagesRef,
    pendingFlush,
    rafId,
    scheduleFlush,
    cancelPendingFlush,
  };
}
