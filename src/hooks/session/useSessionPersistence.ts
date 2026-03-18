import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { PersistedSession, ClaudeEvent, SystemInitEvent, EngineId } from "../../types";
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
  const { claude, acp, codex, engine } = engines;
  const { messages, totalCost, sessionInfo } = engine;
  const {
    setSessions,
    setDraftMcpStatuses,
    setPreStartedSessionId,
    setDraftAcpSessionId,
    setInitialConfigOptions,
    setInitialSlashCommands,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    messagesRef,
    totalCostRef,
    contextUsageRef,
    isProcessingRef,
    isCompactingRef,
    isConnectedRef,
    sessionInfoRef,
    pendingPermissionRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    preStartedSessionIdRef,
    draftAcpSessionIdRef,
    lastMessageSyncSessionRef,
    switchSessionRef,
    acpPermissionBehaviorRef,
    saveTimerRef,
  } = refs;

  const persistSessionWithCodexFallback = useCallback(async (data: PersistedSession) => {
    let payload = data;
    if (data.engine === "codex" && !data.codexThreadId) {
      try {
        const existing = await window.claude.sessions.load(data.projectId, data.id);
        if (existing?.codexThreadId) payload = { ...data, codexThreadId: existing.codexThreadId };
      } catch {
      }
    }
    await window.claude.sessions.save(payload);
  }, []);

  useEffect(() => {
    backgroundStoreRef.current.onProcessingChange = (sessionId, isProcessing) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const wasProcessing = !!session?.isProcessing;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, isProcessing } : s,
        ),
      );

      if (wasProcessing && !isProcessing && session) {
        window.dispatchEvent(new CustomEvent("harnss:background-session-complete", {
          detail: {
            sessionId,
            sessionTitle: session.title,
          },
        }));
      }
    };

    backgroundStoreRef.current.onPermissionRequest = (sessionId, permission) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, hasPendingPermission: true } : s,
        ),
      );

      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const sessionTitle = session?.title ?? "Background session";
      const toolLabel = permission.toolName;

      toast(`${sessionTitle}`, {
        id: `permission-${sessionId}`,
        description: `Waiting for permission: ${toolLabel}`,
        duration: Infinity,
        action: {
          label: "Switch",
          onClick: () => switchSessionRef.current?.(sessionId),
        },
      });

      window.dispatchEvent(new CustomEvent("harnss:background-permission-request", {
        detail: {
          sessionId,
          sessionTitle,
          permission,
        },
      }));
    };
  }, []);

  useEffect(() => {
    const handleSessionExit = (sid: string) => {
      liveSessionIdsRef.current.delete(sid);

      if (sid === preStartedSessionIdRef.current) {
        preStartedSessionIdRef.current = null;
        setPreStartedSessionId(null);
        backgroundStoreRef.current.delete(sid);
        return;
      }
      if (sid === draftAcpSessionIdRef.current) {
        draftAcpSessionIdRef.current = null;
        setDraftAcpSessionId(null);
        setInitialConfigOptions([]);
        setInitialSlashCommands([]);
        backgroundStoreRef.current.delete(sid);
        return;
      }

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
            planMode: session.planMode,
            totalCost: bgState.totalCost,
            engine: session.engine,
            ...(session.engine === "codex" && session.codexThreadId ? { codexThreadId: session.codexThreadId } : {}),
            ...(session.groupId ? { groupId: session.groupId } : {}),
          });
        }
      }
    };

    const unsubExit = window.claude.onExit((data) => handleSessionExit(data._sessionId));
    const unsubAcpExit = window.claude.acp.onExit((data: { _sessionId: string; code: number | null }) => handleSessionExit(data._sessionId));
    const unsubCodexExit = window.claude.codex.onExit((data) => handleSessionExit(data._sessionId));
    const unsubOpenclawExit = window.claude.openclaw.onExit((data) => handleSessionExit(data._sessionId));
    return () => {
      unsubExit();
      unsubAcpExit();
      unsubCodexExit();
      unsubOpenclawExit();
    };
  }, []);

  useEffect(() => {
    const unsub = window.claude.onEvent((event: ClaudeEvent & { _sessionId?: string }) => {
      const sid = event._sessionId;
      if (!sid) return;
      if (sid === activeSessionIdRef.current) return;

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
      if (sid === draftAcpSessionIdRef.current) return;
      backgroundStoreRef.current.handleACPEvent(event);
    });

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

    const unsubBgAcpPerm = window.claude.acp.onPermissionRequest((data: ACPPermissionEvent) => {
      const sid = data._sessionId;
      if (!sid || sid === activeSessionIdRef.current) return;
      if (sid === draftAcpSessionIdRef.current) return;

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

    const unsubBgAcpTurn = window.claude.acp.onTurnComplete((data: ACPTurnCompleteEvent) => {
      const sid = data._sessionId;
      if (!sid || sid === activeSessionIdRef.current) return;
      backgroundStoreRef.current.handleACPTurnComplete(sid);
    });

    const unsubCodex = window.claude.codex.onEvent((event) => {
      const sid = event._sessionId;
      if (!sid || sid === activeSessionIdRef.current) return;
      backgroundStoreRef.current.handleCodexEvent(event);
    });

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

      backgroundStoreRef.current.setPermission(sid, {
        requestId: String(data.rpcId),
        toolName: data.method.includes("commandExecution") ? "Bash" : "Edit",
        toolInput: {},
        toolUseId: data.itemId,
      });
    });

    const unsubOpenClaw = window.claude.openclaw.onEvent((event) => {
      const sid = event._sessionId;
      if (!sid || sid === activeSessionIdRef.current) return;
      backgroundStoreRef.current.handleOpenClawEvent(event);
    });

    return () => { unsub(); unsubAcp(); unsubBgPerm(); unsubBgAcpPerm(); unsubBgAcpTurn(); unsubCodex(); unsubCodexApproval(); unsubOpenClaw(); };
  }, []);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID || messages.length === 0) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const session = sessionsRef.current.find((s) => s.id === activeSessionId);
      if (!session) return;
      const msgs = messagesRef.current.filter((m) => !m.isQueued);
      const data: PersistedSession = {
        id: activeSessionId,
        projectId: session.projectId,
        title: session.title,
        createdAt: session.createdAt,
        messages: msgs,
        model: session.model || sessionInfo?.model,
        planMode: session.planMode,
        totalCost: totalCostRef.current,
        contextUsage: contextUsageRef.current,
        engine: session.engine,
        ...(session.agentId ? { agentId: session.agentId } : {}),
        ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
        ...(session.engine === "codex" && session.codexThreadId ? { codexThreadId: session.codexThreadId } : {}),
            ...(session.groupId ? { groupId: session.groupId } : {}),
      };
      void persistSessionWithCodexFallback(data);
    }, 2000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, activeSessionId, sessionInfo?.model, persistSessionWithCodexFallback]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID) return;

    let lastMessageAt: number | undefined;
    if (messages.length > 0) {
      if (lastMessageSyncSessionRef.current !== activeSessionId) {
        lastMessageSyncSessionRef.current = activeSessionId;
      } else {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "user" && typeof messages[i].timestamp === "number") {
            lastMessageAt = messages[i].timestamp;
            break;
          }
        }
      }
    }

    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== activeSessionId) return s;

        const updates: Record<string, unknown> = {};

        if (sessionInfo?.model && s.model !== sessionInfo.model) {
          updates.model = sessionInfo.model;
        }

        if (totalCost !== 0 && s.totalCost !== totalCost) {
          updates.totalCost = totalCost;
        }

        if (lastMessageAt !== undefined && s.lastMessageAt !== lastMessageAt) {
          updates.lastMessageAt = lastMessageAt;
        }

        if (s.isProcessing !== engine.isProcessing) {
          updates.isProcessing = engine.isProcessing;
        }

        if (!engine.pendingPermission && s.hasPendingPermission) {
          updates.hasPendingPermission = false;
        }

        if (Object.keys(updates).length === 0) return s;
        changed = true;
        return { ...s, ...updates };
      });
      return changed ? next : prev;
    });
  }, [activeSessionId, sessionInfo?.model, totalCost, messages.length, engine.isProcessing, engine.pendingPermission]);

  const saveCurrentSession = useCallback(async () => {
    const id = activeSessionIdRef.current;
    if (!id || id === DRAFT_ID || messagesRef.current.length === 0) return;
    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;
    const msgs = messagesRef.current.filter((m) => !m.isQueued);
    const data: PersistedSession = {
      id,
      projectId: session.projectId,
      title: session.title,
      createdAt: session.createdAt,
      messages: msgs,
      model: session.model,
      planMode: session.planMode,
      totalCost: totalCostRef.current,
      contextUsage: contextUsageRef.current,
      engine: session.engine,
      ...(session.agentId ? { agentId: session.agentId } : {}),
      ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
      ...(session.engine === "codex" && session.codexThreadId ? { codexThreadId: session.codexThreadId } : {}),
            ...(session.groupId ? { groupId: session.groupId } : {}),
    };
    await persistSessionWithCodexFallback(data);
  }, [persistSessionWithCodexFallback]);

  const seedBackgroundStore = useCallback(() => {
    const currentId = activeSessionIdRef.current;
    if (currentId && currentId !== DRAFT_ID) {
      const sessionEngine = sessionsRef.current.find(s => s.id === currentId)?.engine ?? "claude";
      const slashCommands = sessionEngine === "codex"
        ? codex.slashCommands
        : sessionEngine === "acp"
          ? acp.slashCommands
          : claude.slashCommands;

      backgroundStoreRef.current.initFromState(currentId, {
        messages: messagesRef.current,
        isProcessing: isProcessingRef.current,
        isConnected: isConnectedRef.current,
        isCompacting: isCompactingRef.current,
        sessionInfo: sessionInfoRef.current,
        totalCost: totalCostRef.current,
        contextUsage: contextUsageRef.current,
        pendingPermission: pendingPermissionRef.current ?? null,
        rawAcpPermission: null,
        slashCommands,
      });
    }
  }, [claude.slashCommands, acp.slashCommands, codex.slashCommands]);

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
        const result = await window.claude.generateTitle(
          message,
          projectPath,
          titleEngine,
          titleEngine === "acp" ? sessionId : undefined,
        );

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
