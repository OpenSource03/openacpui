import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { UIMessage, PersistedSession, ClaudeEvent, SystemInitEvent, EngineId } from "../../types";
import { toMcpStatusState } from "../../lib/mcp-utils";
import type { ACPSessionEvent, ACPPermissionEvent, ACPTurnCompleteEvent } from "../../types/acp";
import { normalizeToolInput as acpNormalizeToolInput, pickAutoResponseOption } from "../../lib/acp-adapter";
import { DRAFT_ID } from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks } from "./types";

interface UseSessionPersistenceParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  activeSessionId: string | null;
}

export function useSessionPersistence({
  refs,
  setters,
  engines,
  activeSessionId,
}: UseSessionPersistenceParams) {
  const { engine } = engines;
  const { messages, totalCost, sessionInfo } = engine;
  const { setSessions, setDraftMcpStatuses, setPreStartedSessionId } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    messagesRef,
    totalCostRef,
    isProcessingRef,
    isConnectedRef,
    sessionInfoRef,
    pendingPermissionRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    preStartedSessionIdRef,
    lastMessageSyncSessionRef,
    switchSessionRef,
    acpPermissionBehaviorRef,
    saveTimerRef,
  } = refs;

  // Persist session with Codex thread ID fallback
  const persistSessionWithCodexFallback = useCallback(async (data: PersistedSession) => {
    let payload = data;
    if (data.engine === "codex" && !data.codexThreadId) {
      try {
        const existing = await window.claude.sessions.load(data.projectId, data.id);
        if (existing?.codexThreadId) payload = { ...data, codexThreadId: existing.codexThreadId };
      } catch {
        // Best-effort fallback only.
      }
    }
    await window.claude.sessions.save(payload);
  }, []);

  // Wire up background store callbacks for sidebar indicators
  useEffect(() => {
    backgroundStoreRef.current.onProcessingChange = (sessionId, isProcessing) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, isProcessing } : s,
        ),
      );
    };

    // When a background session receives a permission request, update sidebar + show toast
    backgroundStoreRef.current.onPermissionRequest = (sessionId, permission) => {
      // Update sidebar badge
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, hasPendingPermission: true } : s,
        ),
      );

      // Show a persistent toast so the user notices the blocked session
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const sessionTitle = session?.title ?? "Background session";
      const toolLabel = permission.toolName;

      toast(`${sessionTitle}`, {
        id: `permission-${sessionId}`,
        description: `Waiting for permission: ${toolLabel}`,
        duration: Infinity, // Permission is blocking — keep until resolved
        action: {
          label: "Switch",
          onClick: () => switchSessionRef.current?.(sessionId),
        },
      });
    };
  }, []);

  // Handle session exits across all engines
  useEffect(() => {
    const handleSessionExit = (sid: string) => {
      liveSessionIdsRef.current.delete(sid);

      // If the pre-started eager session crashed, clear it
      if (sid === preStartedSessionIdRef.current) {
        preStartedSessionIdRef.current = null;
        setPreStartedSessionId(null);
        backgroundStoreRef.current.delete(sid);
        return;
      }

      // Auto-save and mark disconnected for background sessions
      if (sid !== activeSessionIdRef.current && backgroundStoreRef.current.has(sid)) {
        backgroundStoreRef.current.markDisconnected(sid);
        const bgState = backgroundStoreRef.current.get(sid);
        const session = sessionsRef.current.find((s) => s.id === sid);
        if (bgState && session) {
          window.claude.sessions.save({
            id: sid,
            projectId: session.projectId,
            title: session.title,
            createdAt: session.createdAt,
            messages: bgState.messages,
            model: session.model || bgState.sessionInfo?.model,
            totalCost: bgState.totalCost,
            engine: session.engine,
            ...(session.engine === "codex" && session.codexThreadId ? { codexThreadId: session.codexThreadId } : {}),
          });
        }
      }
    };

    const unsubExit = window.claude.onExit((data) => handleSessionExit(data._sessionId));
    const unsubAcpExit = window.claude.acp.onExit((data: { _sessionId: string; code: number | null }) => handleSessionExit(data._sessionId));
    const unsubCodexExit = window.claude.codex.onExit((data) => handleSessionExit(data._sessionId));
    return () => {
      unsubExit();
      unsubAcpExit();
      unsubCodexExit();
    };
  }, []);

  // Route events for non-active sessions to the background store
  useEffect(() => {
    const unsub = window.claude.onEvent((event: ClaudeEvent & { _sessionId?: string }) => {
      const sid = event._sessionId;
      if (!sid) return;
      if (sid === activeSessionIdRef.current) return;

      // Pre-started session: route to background store AND extract MCP statuses
      if (sid === preStartedSessionIdRef.current) {
        backgroundStoreRef.current.handleEvent(event);
        if (event.type === "system" && "subtype" in event && event.subtype === "init") {
          const init = event as SystemInitEvent;
          if (init.mcp_servers?.length) {
            setDraftMcpStatuses(init.mcp_servers.map(s => ({
              name: s.name,
              status: toMcpStatusState(s.status),
            })));
          }
        }
        return;
      }

      backgroundStoreRef.current.handleEvent(event);
    });
    const unsubAcp = window.claude.acp.onEvent((event: ACPSessionEvent) => {
      const sid = event._sessionId;
      if (!sid) return;
      if (sid === activeSessionIdRef.current) return;
      backgroundStoreRef.current.handleACPEvent(event);
    });

    // Route permission requests for non-active Claude sessions to the background store
    const unsubBgPerm = window.claude.onPermissionRequest((data) => {
      const sid = data._sessionId;
      if (!sid || sid === activeSessionIdRef.current || sid === preStartedSessionIdRef.current) return;
      backgroundStoreRef.current.setPermission(sid, {
        requestId: data.requestId,
        toolName: data.toolName,
        toolInput: data.toolInput,
        toolUseId: data.toolUseId,
        suggestions: data.suggestions,
        decisionReason: data.decisionReason,
      });
    });

    // Route permission requests for non-active ACP sessions to the background store
    // (auto-respond if the client-side permission behavior allows it)
    const unsubBgAcpPerm = window.claude.acp.onPermissionRequest((data: ACPPermissionEvent) => {
      const sid = data._sessionId;
      if (!sid || sid === activeSessionIdRef.current) return;

      // Auto-respond for background ACP sessions when behavior is configured
      const autoOptionId = pickAutoResponseOption(data.options, acpPermissionBehaviorRef.current);
      if (autoOptionId) {
        window.claude.acp.respondPermission(sid, data.requestId, autoOptionId);
        return;
      }

      backgroundStoreRef.current.setPermission(
        sid,
        {
          requestId: data.requestId,
          toolName: data.toolCall.title,
          toolInput: acpNormalizeToolInput(data.toolCall.rawInput, data.toolCall.kind),
          toolUseId: data.toolCall.toolCallId,
        },
        data,
      );
    });

    // Route turn-complete for non-active ACP sessions to the background store
    // (clears isProcessing so the session doesn't appear stuck when switching back)
    const unsubBgAcpTurn = window.claude.acp.onTurnComplete((data: ACPTurnCompleteEvent) => {
      const sid = data._sessionId;
      if (!sid || sid === activeSessionIdRef.current) return;
      backgroundStoreRef.current.handleACPTurnComplete(sid);
    });

    // Route Codex events for non-active sessions to the background store
    const unsubCodex = window.claude.codex.onEvent((event) => {
      const sid = event._sessionId;
      if (!sid || sid === activeSessionIdRef.current) return;
      backgroundStoreRef.current.handleCodexEvent(event);
    });

    // Route Codex approval requests for non-active sessions — auto-decline for now
    const unsubCodexApproval = window.claude.codex.onApprovalRequest((data) => {
      const sid = data._sessionId;
      if (!sid || sid === activeSessionIdRef.current) return;
      if (data.method === "item/tool/requestUserInput") {
        backgroundStoreRef.current.setPermission(sid, {
          requestId: String(data.rpcId),
          toolName: "AskUserQuestion",
          toolInput: {
            source: "codex_request_user_input",
            questions: data.questions.map((question) => ({
              id: question.id,
              header: question.header,
              question: question.question,
              isOther: question.isOther,
              isSecret: question.isSecret,
              options: question.options ?? undefined,
              multiSelect: false,
            })),
          },
          toolUseId: data.itemId,
        });
        return;
      }

      // Auto-decline background Codex approvals (user must switch to the session)
      backgroundStoreRef.current.setPermission(sid, {
        requestId: String(data.rpcId),
        toolName: data.method.includes("commandExecution") ? "Bash" : "Edit",
        toolInput: {},
        toolUseId: data.itemId,
      });
    });

    return () => { unsub(); unsubAcp(); unsubBgPerm(); unsubBgAcpPerm(); unsubBgAcpTurn(); unsubCodex(); unsubCodexApproval(); };
  }, []);

  // Debounced auto-save
  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID || messages.length === 0) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const session = sessionsRef.current.find((s) => s.id === activeSessionId);
      if (!session) return;
      // Strip isQueued from messages before persisting — queue state is runtime-only
      const msgs = messagesRef.current.map((m) => (m.isQueued ? { ...m, isQueued: undefined } : m));
      const data: PersistedSession = {
        id: activeSessionId,
        projectId: session.projectId,
        title: session.title,
        createdAt: session.createdAt,
        messages: msgs,
        model: session.model || sessionInfo?.model,
        totalCost: totalCostRef.current,
        engine: session.engine,
        ...(session.agentId ? { agentId: session.agentId } : {}),
        ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
        ...(session.engine === "codex" && session.codexThreadId ? { codexThreadId: session.codexThreadId } : {}),
      };
      void persistSessionWithCodexFallback(data);
    }, 2000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, activeSessionId, sessionInfo?.model, persistSessionWithCodexFallback]);

  // Sync model to session list
  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID || !sessionInfo?.model) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId ? { ...s, model: sessionInfo.model } : s,
      ),
    );
  }, [activeSessionId, sessionInfo?.model]);

  // Sync totalCost to session list
  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID || totalCost === 0) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId ? { ...s, totalCost } : s,
      ),
    );
  }, [activeSessionId, totalCost]);

  // Keep lastMessageAt in sync so the sidebar sorts by most recent user activity
  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID || messages.length === 0) return;
    // On session switch, React state can briefly still hold the previous session's messages.
    // Skip one cycle so we don't stamp the new session with stale activity timestamps.
    if (lastMessageSyncSessionRef.current !== activeSessionId) {
      lastMessageSyncSessionRef.current = activeSessionId;
      return;
    }
    // Only user messages should affect sort order — AI responses shouldn't bump a chat to the top
    let lastUserMsg: UIMessage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserMsg = messages[i]; break; }
    }
    if (!lastUserMsg) return;
    if (typeof lastUserMsg.timestamp !== "number") return;
    const lastMessageAt = lastUserMsg.timestamp;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== activeSessionId || s.lastMessageAt === lastMessageAt) return s;
        changed = true;
        return { ...s, lastMessageAt };
      });
      return changed ? next : prev;
    });
  }, [activeSessionId, messages.length]);

  // Sync active session's isProcessing to the session list (for sidebar spinner)
  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId ? { ...s, isProcessing: engine.isProcessing } : s,
      ),
    );
  }, [activeSessionId, engine.isProcessing]);

  // Clear sidebar badge when the active session's permission is resolved
  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID) return;
    if (!engine.pendingPermission) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId ? { ...s, hasPendingPermission: false } : s,
        ),
      );
    }
  }, [activeSessionId, engine.pendingPermission]);

  // Save current session to disk (used before switching/creating)
  const saveCurrentSession = useCallback(async () => {
    const id = activeSessionIdRef.current;
    if (!id || id === DRAFT_ID || messagesRef.current.length === 0) return;
    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;
    // Strip isQueued from messages before persisting — queue state is runtime-only
    const msgs = messagesRef.current.map((m) => (m.isQueued ? { ...m, isQueued: undefined } : m));
    const data: PersistedSession = {
      id,
      projectId: session.projectId,
      title: session.title,
      createdAt: session.createdAt,
      messages: msgs,
      model: session.model,
      totalCost: totalCostRef.current,
      engine: session.engine,
      ...(session.agentId ? { agentId: session.agentId } : {}),
      ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
      ...(session.engine === "codex" && session.codexThreadId ? { codexThreadId: session.codexThreadId } : {}),
    };
    await persistSessionWithCodexFallback(data);
  }, [persistSessionWithCodexFallback]);

  // Seed background store with current active session's state
  const seedBackgroundStore = useCallback(() => {
    const currentId = activeSessionIdRef.current;
    if (currentId && currentId !== DRAFT_ID && liveSessionIdsRef.current.has(currentId)) {
      backgroundStoreRef.current.initFromState(currentId, {
        messages: messagesRef.current,
        isProcessing: isProcessingRef.current,
        isConnected: isConnectedRef.current,
        sessionInfo: sessionInfoRef.current,
        totalCost: totalCostRef.current,
        pendingPermission: pendingPermissionRef.current ?? null,
        rawAcpPermission: null, // ACP ref is internal to useACP — will be restored via initialRawAcpPermission
      });
    }
  }, []);

  // AI-generated title via background utility prompt (SDK Haiku or ACP utility session)
  const generateSessionTitle = useCallback(
    async (sessionId: string, message: string, projectPath: string, titleEngine?: EngineId) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, titleGenerating: true } : s,
        ),
      );

      const fallbackTitle =
        message.length > 60 ? message.slice(0, 57) + "..." : message;

      try {
        // Pass engine + sessionId so the IPC handler routes to ACP if needed
        const result = await window.claude.generateTitle(
          message,
          projectPath,
          titleEngine,
          titleEngine === "acp" ? sessionId : undefined,
        );

        // Guard: session may have been deleted or manually renamed while generating
        const current = sessionsRef.current.find((s) => s.id === sessionId);
        if (!current || !current.titleGenerating) return;

        const title = result.title || fallbackTitle;

        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? { ...s, title, titleGenerating: false }
              : s,
          ),
        );

        // Persist the new title
        const data = await window.claude.sessions.load(
          current.projectId,
          sessionId,
        );
        if (data) {
          await window.claude.sessions.save({ ...data, title });
        }
      } catch {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? { ...s, title: fallbackTitle, titleGenerating: false }
              : s,
          ),
        );
      }
    },
    [],
  );

  return {
    saveCurrentSession,
    seedBackgroundStore,
    generateSessionTitle,
    persistSessionWithCodexFallback,
  };
}
