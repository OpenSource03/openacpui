import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ChatSession, UIMessage, PersistedSession, Project, ClaudeEvent, SystemInitEvent, SessionInfo, PermissionRequest, ImageAttachment, McpServerStatus, McpServerConfig, ModelInfo, AcpPermissionBehavior } from "../types";
import { toMcpStatusState } from "../types/ui";
import type { ACPSessionEvent, ACPPermissionEvent, ACPTurnCompleteEvent, ACPConfigOption } from "../types/acp";
import { normalizeToolInput as acpNormalizeToolInput, pickAutoResponseOption } from "../lib/acp-adapter";
import { useClaude } from "./useClaude";
import { useACP } from "./useACP";
import { BackgroundSessionStore } from "../lib/background-session-store";
import { buildSdkContent } from "../lib/protocol";

interface StartOptions {
  model?: string;
  permissionMode?: string;
  engine?: "claude" | "acp";
  agentId?: string;
}

const DRAFT_ID = "__draft__";

export function useSessionManager(projects: Project[], acpPermissionBehavior: AcpPermissionBehavior = "ask") {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [startOptions, setStartOptions] = useState<StartOptions>({});
  // Track which project the current draft/session belongs to
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const [initialMeta, setInitialMeta] = useState<{
    isProcessing: boolean;
    isConnected: boolean;
    sessionInfo: SessionInfo | null;
    totalCost: number;
  } | null>(null);
  const [initialConfigOptions, setInitialConfigOptions] = useState<ACPConfigOption[]>([]);
  // Permission state to pass into hooks when restoring a background session
  const [initialPermission, setInitialPermission] = useState<PermissionRequest | null>(null);
  const [initialRawAcpPermission, setInitialRawAcpPermission] = useState<ACPPermissionEvent | null>(null);
  const [acpMcpStatuses, setAcpMcpStatuses] = useState<McpServerStatus[]>([]);
  // Eager session start: pre-started SDK session for immediate MCP status display
  const [preStartedSessionId, setPreStartedSessionId] = useState<string | null>(null);
  const preStartedSessionIdRef = useRef<string | null>(null);
  const [draftMcpStatuses, setDraftMcpStatuses] = useState<McpServerStatus[]>([]);
  const draftMcpStatusesRef = useRef<McpServerStatus[]>([]);
  draftMcpStatusesRef.current = draftMcpStatuses;
  // Cached models from any SDK session — account-level, doesn't change between sessions
  const [cachedModels, setCachedModels] = useState<ModelInfo[]>([]);
  // ACP agent tracking — needed to restart the session with updated MCP servers
  const acpAgentIdRef = useRef<string | null>(null);
  // ACP-side session ID — persisted so we can call session/load on revival after restart
  const acpAgentSessionIdRef = useRef<string | null>(null);

  // Determine which engine the active session uses
  const activeEngine = activeSessionId === DRAFT_ID
    ? (startOptions.engine ?? "claude")
    : (sessions.find(s => s.id === activeSessionId)?.engine ?? "claude");
  const isACP = activeEngine === "acp";

  const claudeSessionId = (!isACP && activeSessionId !== DRAFT_ID) ? activeSessionId : null;
  const acpSessionId = (isACP && activeSessionId !== DRAFT_ID) ? activeSessionId : null;

  const claude = useClaude({ sessionId: claudeSessionId, initialMessages: isACP ? [] : initialMessages, initialMeta: isACP ? null : initialMeta, initialPermission: isACP ? null : initialPermission });
  const acp = useACP({ sessionId: acpSessionId, initialMessages: isACP ? initialMessages : [], initialConfigOptions: isACP ? initialConfigOptions : [], initialMeta: isACP ? initialMeta : null, initialPermission: isACP ? initialPermission : null, initialRawAcpPermission: isACP ? initialRawAcpPermission : null, acpPermissionBehavior });

  // Pick the active engine's state
  const engine = isACP ? acp : claude;
  const { messages, totalCost, sessionInfo } = engine;

  const liveSessionIdsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const totalCostRef = useRef(totalCost);
  totalCostRef.current = totalCost;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const draftProjectIdRef = useRef(draftProjectId);
  draftProjectIdRef.current = draftProjectId;
  const startOptionsRef = useRef(startOptions);
  startOptionsRef.current = startOptions;
  const isProcessingRef = useRef(engine.isProcessing);
  isProcessingRef.current = engine.isProcessing;
  const isConnectedRef = useRef(engine.isConnected);
  isConnectedRef.current = engine.isConnected;
  const sessionInfoRef = useRef(engine.sessionInfo);
  sessionInfoRef.current = engine.sessionInfo;
  const pendingPermissionRef = useRef(engine.pendingPermission);
  pendingPermissionRef.current = engine.pendingPermission;
  // Track ACP permission behavior for background session auto-response
  const acpPermissionBehaviorRef = useRef<AcpPermissionBehavior>(acpPermissionBehavior);
  acpPermissionBehaviorRef.current = acpPermissionBehavior;
  // Stable ref to switchSession so toast callbacks don't capture stale closures
  const switchSessionRef = useRef<(id: string) => Promise<void>>(undefined);

  const backgroundStoreRef = useRef(new BackgroundSessionStore());

  // ── Message queue: buffer user messages while the engine is processing ──
  interface QueuedMessage {
    text: string;
    images?: ImageAttachment[];
    displayText?: string;
    /** ID of the UIMessage already shown in chat with isQueued: true */
    messageId: string;
  }
  const messageQueueRef = useRef<QueuedMessage[]>([]);
  const [queuedCount, setQueuedCount] = useState(0);

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

  const findProject = useCallback((projectId: string) => {
    return projectsRef.current.find((p) => p.id === projectId) ?? null;
  }, []);

  // Eagerly start a Claude SDK session for immediate MCP status display
  const eagerStartSession = useCallback(async (projectId: string, options?: StartOptions) => {
    const project = projectsRef.current.find((p) => p.id === projectId);
    if (!project) return;
    const mcpServers = await window.claude.mcp.list(projectId);
    let result;
    try {
      result = await window.claude.start({
        cwd: project.path,
        model: options?.model,
        permissionMode: options?.permissionMode,
        mcpServers,
      });
    } catch (err) {
      console.warn("[eagerStartSession] start() failed:", err);
      return; // Eager start is optional — will fall back to normal start in materializeDraft
    }
    if (result.error) {
      console.warn("[eagerStartSession] start() returned error:", result.error);
      return;
    }
    // Only commit if still in draft for the same project
    if (activeSessionIdRef.current === DRAFT_ID && draftProjectIdRef.current === projectId) {
      liveSessionIdsRef.current.add(result.sessionId);
      preStartedSessionIdRef.current = result.sessionId;
      setPreStartedSessionId(result.sessionId);

      // The system init event fires BEFORE start() returns, so the event router
      // couldn't match it (preStartedSessionIdRef was still null). Query MCP
      // status directly now that the session is initialized.
      const statusResult = await window.claude.mcpStatus(result.sessionId);
      if (statusResult.servers?.length && preStartedSessionIdRef.current === result.sessionId) {
        setDraftMcpStatuses(statusResult.servers.map(s => ({
          name: s.name,
          status: toMcpStatusState(s.status),
        })));
      }

      // Same pattern for models — fetch directly since system/init already fired
      const modelsResult = await window.claude.supportedModels(result.sessionId);
      if (modelsResult.models?.length && preStartedSessionIdRef.current === result.sessionId) {
        setCachedModels(modelsResult.models);
      }
    } else {
      // Draft was abandoned before eager start completed
      window.claude.stop(result.sessionId);
    }
  }, []);

  // Probe MCP servers ourselves (for engines that don't report status, e.g. ACP)
  const probeMcpServers = useCallback(async (projectId: string, overrideServers?: McpServerConfig[]) => {
    const servers = overrideServers ?? await window.claude.mcp.list(projectId);
    if (servers.length === 0) {
      setDraftMcpStatuses([]);
      return;
    }
    // Show pending while probing
    if (activeSessionIdRef.current === DRAFT_ID && draftProjectIdRef.current === projectId) {
      setDraftMcpStatuses(servers.map(s => ({
        name: s.name,
        status: "pending" as const,
      })));
    }
    // Probe each server for real connectivity
    const results = await window.claude.mcp.probe(servers);
    if (activeSessionIdRef.current === DRAFT_ID && draftProjectIdRef.current === projectId) {
      setDraftMcpStatuses(results.map(r => ({
        name: r.name,
        status: toMcpStatusState(r.status),
        ...(r.error ? { error: r.error } : {}),
      })));
    }
  }, []);

  // Clean up a pre-started eager session
  const abandonEagerSession = useCallback(() => {
    const id = preStartedSessionIdRef.current;
    if (!id) return;
    window.claude.stop(id);
    liveSessionIdsRef.current.delete(id);
    backgroundStoreRef.current.delete(id);
    preStartedSessionIdRef.current = null;
    setPreStartedSessionId(null);
    setDraftMcpStatuses([]);
  }, []);

  // Update MCP servers for the active ACP session, preserving conversation context.
  // Tries session/load (no process restart, full context preserved) first.
  // Falls back to stop+restart (UI messages restored) if the agent doesn't support it.
  const restartAcpSession = useCallback(async (servers: McpServerConfig[]) => {
    const currentId = activeSessionIdRef.current;
    if (!currentId || currentId === DRAFT_ID) return;

    const session = sessionsRef.current.find(s => s.id === currentId);
    const project = session ? findProject(session.projectId) : null;
    const agentId = acpAgentIdRef.current;
    if (!session || !project || !agentId) return;

    // Probe servers so we get accurate statuses (including needs-auth) before any reload
    const probeResults = await window.claude.mcp.probe(servers);
    // Guard: session may have changed during async probe
    if (activeSessionIdRef.current !== currentId) return;
    setAcpMcpStatuses(probeResults.map(r => ({
      name: r.name,
      status: toMcpStatusState(r.status),
      ...(r.error ? { error: r.error } : {}),
    })));

    // Try session/load first — updates MCP on the existing connection, no context loss
    const reloadResult = await window.claude.acp.reloadSession(currentId, servers);
    if (reloadResult.supportsLoad && reloadResult.ok) {
      // session/load succeeded — session ID and process unchanged, context preserved
      return;
    }

    // Fall back to stop + restart (agent doesn't support session/load, or reload failed)
    const currentMessages = messagesRef.current;
    const currentCost = totalCostRef.current;

    await window.claude.acp.stop(currentId);
    liveSessionIdsRef.current.delete(currentId);
    backgroundStoreRef.current.delete(currentId);

    const result = await window.claude.acp.start({
      agentId,
      cwd: project.path,
      mcpServers: servers,
    });
    if (result.error || !result.sessionId) {
      // Show error in the UI after restart failure — use setMessages directly
      // because session ID hasn't changed (no reset effect to consume initialMessages)
      const errorMsg = result.error || "Failed to restart agent session";
      acp.setMessages(prev => [...prev, {
        id: `system-error-${Date.now()}`,
        role: "system",
        content: errorMsg,
        isError: true,
        timestamp: Date.now(),
      }]);
      return;
    }

    const newId = result.sessionId;
    liveSessionIdsRef.current.add(newId);

    setSessions(prev => prev.map(s =>
      s.id === currentId ? { ...s, id: newId } : s
    ));
    // Restore UI message history and config options through initialMessages → useACP reset effect
    setInitialMessages(currentMessages);
    setInitialMeta({ isProcessing: false, isConnected: true, sessionInfo: null, totalCost: currentCost });
    if (result.configOptions?.length) setInitialConfigOptions(result.configOptions);
    setActiveSessionId(newId);
  }, [findProject]);

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
          });
        }
      }
    };

    const unsubExit = window.claude.onExit((data) => handleSessionExit(data._sessionId));
    const unsubAcpExit = window.claude.acp.onExit((data: { _sessionId: string; code: number | null }) => handleSessionExit(data._sessionId));
    return () => {
      unsubExit();
      unsubAcpExit();
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
          toolInput: acpNormalizeToolInput(data.toolCall.rawInput),
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

    return () => { unsub(); unsubAcp(); unsubBgPerm(); unsubBgAcpPerm(); unsubBgAcpTurn(); };
  }, []);

  // Load sessions for ALL projects
  useEffect(() => {
    if (projects.length === 0) {
      setSessions([]);
      return;
    }
    Promise.all(
      projects.map((p) => window.claude.sessions.list(p.id)),
    ).then((results) => {
      const all = results.flat().map((s) => ({
        id: s.id,
        projectId: s.projectId,
        title: s.title,
        createdAt: s.createdAt,
        lastMessageAt: s.lastMessageAt || s.createdAt,
        model: s.model,
        totalCost: s.totalCost,
        isActive: false,
        engine: s.engine,
      }));
      setSessions(all);
    }).catch(() => { /* IPC failure — leave sessions empty */ });
  }, [projects]);

  // AI-generated title via background Haiku instance
  const generateSessionTitle = useCallback(
    async (sessionId: string, message: string, projectPath: string) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, titleGenerating: true } : s,
        ),
      );

      const fallbackTitle =
        message.length > 60 ? message.slice(0, 57) + "..." : message;

      try {
        const result = await window.claude.generateTitle(message, projectPath);

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

  // Debounced auto-save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      };
      window.claude.sessions.save(data);
    }, 2000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, activeSessionId, sessionInfo?.model]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID || !sessionInfo?.model) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId ? { ...s, model: sessionInfo.model } : s,
      ),
    );
  }, [activeSessionId, sessionInfo?.model]);

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
    // Only user messages should affect sort order — AI responses shouldn't bump a chat to the top
    let lastUserMsg: UIMessage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserMsg = messages[i]; break; }
    }
    if (!lastUserMsg) return;
    const lastMessageAt = lastUserMsg.timestamp || Date.now();
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId ? { ...s, lastMessageAt } : s,
      ),
    );
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

  // Drain one queued message when the current turn completes.
  // Uses engine-specific setMessages (not `engine.setMessages`) to avoid stale closure
  // if the active engine reference changes between renders.
  useEffect(() => {
    if (engine.isProcessing) return;
    if (messageQueueRef.current.length === 0) return;
    const activeId = activeSessionIdRef.current;
    if (!activeId || activeId === DRAFT_ID) return;
    if (!liveSessionIdsRef.current.has(activeId)) return;

    const next = messageQueueRef.current.shift()!;
    setQueuedCount(messageQueueRef.current.length);

    const sessionEngine = sessionsRef.current.find((s) => s.id === activeId)?.engine ?? "claude";
    // Pick the correct engine's setMessages to avoid stale closure
    const targetSetMessages = sessionEngine === "acp" ? acp.setMessages : claude.setMessages;

    // Clear isQueued flag on the message already in chat
    targetSetMessages((prev) =>
      prev.map((m) => (m.id === next.messageId ? { ...m, isQueued: false } : m)),
    );

    /** Show error + clear remaining queue on send failure */
    const handleSendError = () => {
      targetSetMessages((prev) => [
        ...prev,
        {
          id: `system-send-error-${Date.now()}`,
          role: "system" as const,
          content: "Failed to send queued message.",
          isError: true,
          timestamp: Date.now(),
        },
      ]);
      clearQueue();
    };

    if (sessionEngine === "acp") {
      acp.sendRaw(next.text, next.images).catch(handleSendError);
    } else {
      claude.sendRaw(next.text, next.images).then((ok) => {
        if (!ok) handleSendError();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.isProcessing]);

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
    };
    await window.claude.sessions.save(data);
  }, []);

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

  /** Add a message to the queue and show it in chat immediately with isQueued styling */
  const enqueueMessage = useCallback((text: string, images?: ImageAttachment[], displayText?: string) => {
    const msgId = `user-queued-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    messageQueueRef.current.push({ text, images, displayText, messageId: msgId });
    setQueuedCount(messageQueueRef.current.length);
    engine.setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        role: "user" as const,
        content: text,
        timestamp: Date.now(),
        isQueued: true,
        ...(images?.length ? { images } : {}),
        ...(displayText ? { displayContent: displayText } : {}),
      },
    ]);
  }, [engine.setMessages]);

  /** Clear the entire queue and remove queued messages from chat */
  const clearQueue = useCallback(() => {
    const queuedIds = new Set(messageQueueRef.current.map((q) => q.messageId));
    messageQueueRef.current = [];
    setQueuedCount(0);
    if (queuedIds.size > 0) {
      engine.setMessages((prev) => prev.filter((m) => !queuedIds.has(m.id)));
    }
  }, [engine.setMessages]);

  // createSession now requires a projectId
  const createSession = useCallback(
    async (projectId: string, options?: StartOptions) => {
      clearQueue();
      abandonEagerSession();
      acpAgentIdRef.current = null;
      acpAgentSessionIdRef.current = null;
      setAcpMcpStatuses([]);
      await saveCurrentSession();
      seedBackgroundStore();
      setStartOptions(options ?? {});
      setDraftProjectId(projectId);
      setInitialMessages([]);
      setInitialMeta(null);
      setInitialPermission(null);
      setInitialRawAcpPermission(null);
      // Explicitly clear ACP state — when activeSessionId is already DRAFT_ID,
      // useACP's reset effect won't fire, so stale messages (e.g. from a failed start) would persist
      acp.setMessages([]);
      acp.setIsProcessing(false);
      setActiveSessionId(DRAFT_ID);
      // Remove any leftover pending DRAFT_ID session from a previous failed ACP start
      setSessions((prev) => prev.filter(s => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })));

      // Eager start for Claude engine (fire-and-forget)
      const draftEngine = options?.engine ?? "claude";
      if (draftEngine !== "acp") {
        eagerStartSession(projectId, options);
        // Set immediate "pending" statuses while SDK connects
        window.claude.mcp.list(projectId).then(servers => {
          if (activeSessionIdRef.current === DRAFT_ID && draftProjectIdRef.current === projectId) {
            setDraftMcpStatuses(servers.map(s => ({
              name: s.name,
              status: "pending" as const,
            })));
          }
        }).catch(() => { /* IPC failure */ });
      } else {
        // ACP: no eager session — probe servers ourselves for preliminary status
        probeMcpServers(projectId);
      }
    },
    [saveCurrentSession, seedBackgroundStore, eagerStartSession, abandonEagerSession, clearQueue],
  );

  const materializingRef = useRef(false);
  const materializeDraft = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      // Re-entrancy guard — prevent double-materialization from rapid sends
      if (materializingRef.current) return "";
      materializingRef.current = true;

      const projectId = draftProjectIdRef.current;
      const project = projectId ? findProject(projectId) : null;
      if (!project) {
        console.warn("[materializeDraft] No project found for draftProjectId:", projectId);
        materializingRef.current = false;
        return "";
      }
      const options = startOptionsRef.current;
      const draftEngine = options.engine ?? "claude";
      console.log("[materializeDraft] engine=%s agentId=%s project=%s", draftEngine, options.agentId, project.path);

      let sessionId: string;
      let reusedPreStarted = false;

      // Load per-project MCP servers to pass to the session
      const mcpServers = await window.claude.mcp.list(project.id);

      if (draftEngine === "acp" && options.agentId) {
        // Show a "New Chat" entry in the sidebar immediately — before the blocking acp:start.
        // Uses DRAFT_ID as a placeholder; replaced with real session ID on success, removed on error.
        setSessions(prev => [{
          id: DRAFT_ID,
          projectId: project.id,
          title: "New Chat",
          createdAt: Date.now(),
          lastMessageAt: Date.now(),
          totalCost: 0,
          isActive: true,
          engine: "acp" as const,
          agentId: options.agentId,
        }, ...prev.map(s => ({ ...s, isActive: false }))]);

        console.log("[materializeDraft] Calling acp:start...");
        const result = await window.claude.acp.start({
          agentId: options.agentId,
          cwd: project.path,
          mcpServers,
        });
        console.log("[materializeDraft] acp:start result:", result);
        if (result.cancelled) {
          // User intentionally aborted (stop button during download) — remove pending sidebar entry
          setSessions(prev => prev.filter(s => s.id !== DRAFT_ID));
          materializingRef.current = false;
          return "";
        }
        if (result.error || !result.sessionId) {
          // Promote the DRAFT_ID placeholder to a real persisted session so it survives
          // navigation (switchSession/createSession filter out DRAFT_ID entries).
          const errorMsg = result.error || "Failed to start agent session";
          const failedId = `failed-acp-${Date.now()}`;
          const now = Date.now();
          // Build messages from params — can't rely on acp.messages (React state is stale mid-await)
          const errorMessages: UIMessage[] = [
            {
              id: `user-${now}`,
              role: "user" as const,
              content: text,
              timestamp: now,
              ...(images?.length ? { images } : {}),
              ...(displayText ? { displayContent: displayText } : {}),
            },
            {
              id: `system-error-${now}`,
              role: "system" as const,
              content: errorMsg,
              isError: true,
              timestamp: now,
            },
          ];

          // Swap DRAFT_ID → real ID in sidebar
          setSessions(prev => prev.map(s =>
            s.id === DRAFT_ID ? { ...s, id: failedId, titleGenerating: false } : s,
          ));

          // Transition to the real session ID — useACP's reset effect will fire and
          // consume initialMessages/initialMeta, preserving the conversation in the chat.
          setInitialMessages(errorMessages);
          setInitialMeta({ isProcessing: false, isConnected: false, sessionInfo: null, totalCost: 0 });
          setActiveSessionId(failedId);
          setDraftProjectId(null);

          // Persist to disk so it can be loaded when switching back
          window.claude.sessions.save({
            id: failedId,
            projectId: project.id,
            title: "New Chat",
            createdAt: Date.now(),
            messages: errorMessages,
            totalCost: 0,
            engine: "acp",
            agentId: options.agentId,
          });

          materializingRef.current = false;
          return "";
        }
        sessionId = result.sessionId;
        // Track agentId and agentSessionId for restarts and revival after app restart
        acpAgentIdRef.current = options.agentId;
        acpAgentSessionIdRef.current = result.agentSessionId ?? null;
        // Store initial config options from the agent (model, mode, etc.)
        if (result.configOptions?.length) {
          setInitialConfigOptions(result.configOptions);
        }
        // Transition draftMcpStatuses (from probe) → acpMcpStatuses for the live session
        setAcpMcpStatuses(draftMcpStatusesRef.current.length > 0
          ? draftMcpStatusesRef.current
          : mcpServers.map(s => ({ name: s.name, status: "connected" as const }))
        );
      } else {
        // Claude SDK path — reuse pre-started session if available
        const preStarted = preStartedSessionIdRef.current;
        if (preStarted && liveSessionIdsRef.current.has(preStarted)) {
          sessionId = preStarted;
          preStartedSessionIdRef.current = null;
          setPreStartedSessionId(null);
          reusedPreStarted = true;

          // Consume background store state accumulated during draft
          const bgState = backgroundStoreRef.current.consume(sessionId);
          if (bgState) {
            setInitialMessages(bgState.messages);
            setInitialMeta({
              isProcessing: bgState.isProcessing,
              isConnected: bgState.isConnected,
              sessionInfo: bgState.sessionInfo,
              totalCost: bgState.totalCost,
            });
          }
        } else {
          // Fallback: start normally (eager start failed or was cleaned up)
          let result;
          try {
            result = await window.claude.start({
              cwd: project.path,
              model: options.model,
              permissionMode: options.permissionMode,
              mcpServers,
            });
          } catch (err) {
            console.error("[materializeDraft] start() failed:", err);
            materializingRef.current = false;
            return "";
          }
          if (result.error) {
            // The exit event handler in useClaude will show the error message
            console.error("[materializeDraft] start() returned error:", result.error);
            materializingRef.current = false;
            return "";
          }
          sessionId = result.sessionId;
        }
      }
      liveSessionIdsRef.current.add(sessionId);

      const now = Date.now();
      const newSession: ChatSession = {
        id: sessionId,
        projectId: project.id,
        title: "New Chat",
        createdAt: now,
        lastMessageAt: now,
        model: options.model,
        totalCost: 0,
        isActive: true,
        titleGenerating: true,
        engine: draftEngine,
        ...(draftEngine === "acp" && options.agentId ? {
          agentId: options.agentId,
          agentSessionId: acpAgentSessionIdRef.current ?? undefined,
        } : {}),
      };

      // Replace the DRAFT_ID placeholder (if any) with the real session entry
      setSessions((prev) =>
        [newSession, ...prev.filter(s => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false }))],
      );
      if (!reusedPreStarted) {
        if (draftEngine === "acp") {
          // Preserve the user message + processing state through useACP's reset effect
          // (which fires when sessionId changes from null → new ID).
          // React 19 batches these setState calls with setActiveSessionId below.
          const userMsg: UIMessage = {
            id: `user-${Date.now()}`,
            role: "user" as const,
            content: text,
            timestamp: Date.now(),
            ...(images?.length ? { images } : {}),
            ...(displayText ? { displayContent: displayText } : {}),
          };
          setInitialMessages([userMsg]);
          setInitialMeta({ isProcessing: true, isConnected: true, sessionInfo: null, totalCost: 0 });
        } else {
          setInitialMessages([]);
          setInitialMeta(null);
        }
        setInitialPermission(null);
        setInitialRawAcpPermission(null);
      }
      setActiveSessionId(sessionId);
      setDraftProjectId(null);

      // Refresh MCP status since useClaude may have missed the system init event
      setTimeout(() => { claude.refreshMcpStatus(); }, 500);

      // Fire-and-forget AI title generation
      generateSessionTitle(sessionId, text, project.path);

      materializingRef.current = false;
      return sessionId;
    },
    [findProject, generateSessionTitle],
  );

  const switchSession = useCallback(
    async (id: string) => {
      if (id === activeSessionIdRef.current) return;

      clearQueue();
      abandonEagerSession();
      acpAgentIdRef.current = null;
      acpAgentSessionIdRef.current = null;
      await saveCurrentSession();
      seedBackgroundStore();

      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;

      // Restore from background store if available (live session with accumulated events)
      const bgState = backgroundStoreRef.current.consume(id);
      if (bgState) {
        setInitialMessages(bgState.messages);
        setInitialMeta({
          isProcessing: bgState.isProcessing,
          isConnected: bgState.isConnected,
          sessionInfo: bgState.sessionInfo,
          totalCost: bgState.totalCost,
        });
        // Restore pending permission so the hook picks it up on reset
        setInitialPermission(bgState.pendingPermission);
        setInitialRawAcpPermission(bgState.rawAcpPermission);
        setActiveSessionId(id);
        setDraftProjectId(null);
        // Clear sidebar badge + mark active, remove any leftover DRAFT_ID placeholder
        setSessions((prev) =>
          prev.filter(s => s.id !== DRAFT_ID).map((s) => ({
            ...s,
            isActive: s.id === id,
            ...(s.id === id ? { hasPendingPermission: false } : {}),
          })),
        );
        // Dismiss the toast for this session since the user is now viewing it
        toast.dismiss(`permission-${id}`);
        return;
      }

      // Fall back to loading from disk (non-live session)
      const data = await window.claude.sessions.load(session.projectId, id);
      if (data) {
        setInitialMessages(data.messages);
        setInitialMeta(null);
        // No live process = no pending permission
        setInitialPermission(null);
        setInitialRawAcpPermission(null);
        setActiveSessionId(id);
        setDraftProjectId(null);
        // Remove any leftover DRAFT_ID placeholder from a pending ACP start
        setSessions((prev) =>
          prev.filter(s => s.id !== DRAFT_ID).map((s) => ({
            ...s,
            isActive: s.id === id,
            // Restore fields from persisted data (may be missing from sessions:list metadata)
            ...(s.id === id ? {
              ...(data.engine ? { engine: data.engine } : {}),
              ...(data.agentId ? { agentId: data.agentId } : {}),
              ...(data.agentSessionId ? { agentSessionId: data.agentSessionId } : {}),
            } : {}),
          })),
        );
      }
    },
    [saveCurrentSession, seedBackgroundStore, abandonEagerSession, clearQueue],
  );

  // Keep switchSessionRef in sync for stable toast callbacks
  switchSessionRef.current = switchSession;

  const deleteSession = useCallback(
    async (id: string) => {
      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;
      if (liveSessionIdsRef.current.has(id)) {
        if (session.engine === "acp") {
          await window.claude.acp.stop(id);
        } else {
          await window.claude.stop(id);
        }
        liveSessionIdsRef.current.delete(id);
      }
      backgroundStoreRef.current.delete(id);
      // Dismiss any permission toast for this session
      toast.dismiss(`permission-${id}`);
      await window.claude.sessions.delete(session.projectId, id);
      if (activeSessionIdRef.current === id) {
        clearQueue();
        setActiveSessionId(null);
        setInitialMessages([]);
        setInitialMeta(null);
        setInitialPermission(null);
        setInitialRawAcpPermission(null);
      }
      setSessions((prev) => prev.filter((s) => s.id !== id));
    },
    [clearQueue],
  );

  const renameSession = useCallback((id: string, title: string) => {
    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title, titleGenerating: false } : s)),
    );
    window.claude.sessions.load(session.projectId, id).then((data) => {
      if (data) {
        window.claude.sessions.save({ ...data, title });
      }
    }).catch(() => { /* session may have been deleted */ });
  }, []);

  const setActiveModel = useCallback((model: string) => {
    const id = activeSessionIdRef.current;
    if (!id) return;

    if (id === DRAFT_ID) {
      setStartOptions((prev) => ({ ...prev, model }));
      // Model change requires session restart — stop eager session and re-start
      if (preStartedSessionIdRef.current) {
        const oldId = preStartedSessionIdRef.current;
        window.claude.stop(oldId);
        liveSessionIdsRef.current.delete(oldId);
        backgroundStoreRef.current.delete(oldId);
        preStartedSessionIdRef.current = null;
        setPreStartedSessionId(null);
        setDraftMcpStatuses([]);
        // Re-start eager session with new model
        if (draftProjectIdRef.current) {
          eagerStartSession(draftProjectIdRef.current, { ...startOptionsRef.current, model });
          // Set pending statuses while new session connects
          window.claude.mcp.list(draftProjectIdRef.current).then(servers => {
            if (activeSessionIdRef.current === DRAFT_ID) {
              setDraftMcpStatuses(servers.map(s => ({
                name: s.name,
                status: "pending" as const,
              })));
            }
          }).catch(() => { /* IPC failure */ });
        }
      }
      return;
    }

    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;

    const persistModel = () => {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, model } : s)),
      );

      window.claude.sessions.load(session.projectId, id).then((data) => {
        if (data) {
          window.claude.sessions.save({ ...data, model });
        }
      }).catch(() => { /* session may have been deleted */ });
    };

    const isLiveClaudeSession = (session.engine ?? "claude") === "claude"
      && liveSessionIdsRef.current.has(id);

    if (isLiveClaudeSession) {
      claude.setModel(model).then((result) => {
        if (result?.error) {
          toast.error("Failed to switch model", { description: result.error });
          return;
        }
        persistModel();
      }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to switch model", { description: message });
      });
      return;
    }

    persistModel();
  }, [claude.setModel, eagerStartSession]);

  const importCCSession = useCallback(
    async (projectId: string, ccSessionId: string) => {
      const project = findProject(projectId);
      if (!project) return;

      // If already imported, just switch to it
      const existing = sessionsRef.current.find((s) => s.id === ccSessionId);
      if (existing) {
        await switchSession(ccSessionId);
        return;
      }

      await saveCurrentSession();
      seedBackgroundStore();

      const result = await window.claude.ccSessions.import(project.path, ccSessionId);
      if (result.error || !result.messages) return;

      const firstUserMsg = result.messages.find((m) => m.role === "user");
      const titleText = firstUserMsg?.content || "Imported Session";

      const newSession: ChatSession = {
        id: ccSessionId,
        projectId: project.id,
        title: titleText.length > 60 ? titleText.slice(0, 57) + "..." : titleText,
        createdAt: result.messages[0]?.timestamp || Date.now(),
        totalCost: 0,
        isActive: true,
      };

      // Persist immediately so switchSession can load it later
      await window.claude.sessions.save({
        id: ccSessionId,
        projectId: project.id,
        title: newSession.title,
        createdAt: newSession.createdAt,
        messages: result.messages,
        totalCost: 0,
      });

      setSessions((prev) => [
        newSession,
        ...prev.map((s) => ({ ...s, isActive: false })),
      ]);
      setInitialMessages(result.messages);
      setInitialMeta(null);
      setActiveSessionId(ccSessionId);
      setDraftProjectId(null);
    },
    [findProject, saveCurrentSession, seedBackgroundStore, switchSession],
  );

  const setDraftAgent = useCallback((engine: "claude" | "acp", agentId: string) => {
    setStartOptions((prev) => ({ ...prev, engine, agentId }));
  }, []);

  const setActivePermissionMode = useCallback((permissionMode: string) => {
    const id = activeSessionIdRef.current;
    if (!id) return;

    if (id === DRAFT_ID) {
      setStartOptions((prev) => ({ ...prev, permissionMode }));
      // Apply to pre-started session if running (no restart needed)
      if (preStartedSessionIdRef.current) {
        window.claude.setPermissionMode(preStartedSessionIdRef.current, permissionMode);
      }
      return;
    }
    // Change permission mode on the running SDK session (no-op for ACP)
    engine.setPermissionMode(permissionMode);
  }, [engine.setPermissionMode]);

  const reviveAcpSession = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      const oldId = activeSessionIdRef.current;
      if (!oldId || oldId === DRAFT_ID) return;
      const session = sessionsRef.current.find((s) => s.id === oldId);
      if (!session || !session.agentId) {
        acp.setMessages((prev) => [...prev, {
          id: `system-error-${Date.now()}`,
          role: "system" as const,
          content: "ACP session disconnected. Please start a new session.",
          isError: true,
          timestamp: Date.now(),
        }]);
        return;
      }
      const project = findProject(session.projectId);
      if (!project) return;

      const mcpServers = await window.claude.mcp.list(session.projectId);
      const result = await window.claude.acp.reviveSession({
        agentId: session.agentId,
        cwd: project.path,
        agentSessionId: session.agentSessionId,
        mcpServers,
      });

      if (result.error || !result.sessionId) {
        acp.setMessages((prev) => [...prev, {
          id: `system-error-${Date.now()}`,
          role: "system" as const,
          content: result.error || "Failed to reconnect ACP session. Please start a new session.",
          isError: true,
          timestamp: Date.now(),
        }]);
        return;
      }

      const newId = result.sessionId;
      liveSessionIdsRef.current.add(newId);
      acpAgentIdRef.current = session.agentId;
      acpAgentSessionIdRef.current = result.agentSessionId ?? session.agentSessionId ?? null;

      setSessions((prev) => prev.map((s) =>
        s.id === oldId
          ? { ...s, id: newId, agentSessionId: result.agentSessionId ?? s.agentSessionId }
          : s,
      ));
      setAcpMcpStatuses((result.mcpStatuses ?? []).map(s => ({
        name: s.name,
        status: toMcpStatusState(s.status),
      })));
      setInitialMessages(messagesRef.current);
      setInitialMeta({ isProcessing: false, isConnected: true, sessionInfo: null, totalCost: totalCostRef.current });
      if (result.configOptions?.length) setInitialConfigOptions(result.configOptions);
      setActiveSessionId(newId);

      await new Promise((resolve) => setTimeout(resolve, 50));
      acp.setMessages((prev) => [...prev, {
        id: `user-${Date.now()}`,
        role: "user" as const,
        content: text,
        timestamp: Date.now(),
        ...(images?.length ? { images } : {}),
        ...(displayText ? { displayContent: displayText } : {}),
      }]);
      acp.setIsProcessing(true);
      const promptResult = await window.claude.acp.prompt(newId, text, images);
      if (promptResult?.error) {
        acp.setMessages((prev) => [...prev, {
          id: `system-acp-error-${Date.now()}`,
          role: "system" as const,
          content: `ACP error: ${promptResult.error}`,
          timestamp: Date.now(),
        }]);
        acp.setIsProcessing(false);
      }
    },
    [findProject, acp.setMessages, acp.setIsProcessing],
  );

  const reviveSession = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      const oldId = activeSessionIdRef.current;
      if (!oldId || oldId === DRAFT_ID) return;
      const session = sessionsRef.current.find((s) => s.id === oldId);
      if (!session) return;
      const project = findProject(session.projectId);
      if (!project) return;

      const startPayload: StartOptions & { cwd: string; resume?: string } = {
        cwd: project.path,
        ...(session.model ? { model: session.model } : {}),
        permissionMode: startOptionsRef.current.permissionMode,
        resume: oldId, // Resume the SDK session to restore conversation context
      };

      let result;
      try {
        result = await window.claude.start(startPayload);
      } catch (err) {
        engine.setMessages((prev) => [
          ...prev,
          {
            id: `system-revive-error-${Date.now()}`,
            role: "system" as const,
            content: `Failed to resume session: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
            timestamp: Date.now(),
          },
        ]);
        return;
      }
      if (result.error) {
        engine.setMessages((prev) => [
          ...prev,
          {
            id: `system-revive-error-${Date.now()}`,
            role: "system" as const,
            content: result.error!,
            isError: true,
            timestamp: Date.now(),
          },
        ]);
        return;
      }
      const newSessionId = result.sessionId;

      if (newSessionId !== oldId) {
        // SDK returned a different ID (shouldn't happen with resume, but handle it)
        liveSessionIdsRef.current.delete(oldId);
        liveSessionIdsRef.current.add(newSessionId);

        setSessions((prev) =>
          prev.map((s) =>
            s.id === oldId
              ? { ...s, id: newSessionId, isActive: true }
              : { ...s, isActive: false },
          ),
        );

        const oldData = await window.claude.sessions.load(project.id, oldId);
        if (oldData) {
          await window.claude.sessions.save({
            ...oldData,
            id: newSessionId,
            messages: messagesRef.current,
            model: session.model ?? oldData.model,
          });
          await window.claude.sessions.delete(project.id, oldId);
        }

        setActiveSessionId(newSessionId);
      } else {
        liveSessionIdsRef.current.add(oldId);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === oldId ? { ...s, isActive: true } : { ...s, isActive: false },
          ),
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      const content = buildSdkContent(text, images);
      const sendResult = await window.claude.send(newSessionId, {
        type: "user",
        message: { role: "user", content },
      });
      if (sendResult?.error) {
        liveSessionIdsRef.current.delete(newSessionId);
        engine.setMessages((prev) => [
          ...prev,
          {
            id: `system-send-error-${Date.now()}`,
            role: "system",
            content: `Unable to send message: ${sendResult.error}`,
            timestamp: Date.now(),
          },
        ]);
        return;
      }
      engine.setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: "user",
          content: text,
          timestamp: Date.now(),
          ...(images?.length ? { images } : {}),
          ...(displayText ? { displayContent: displayText } : {}),
        },
      ]);
    },
    [engine.setMessages, findProject],
  );

  const send = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      const activeId = activeSessionIdRef.current;
      if (activeId === DRAFT_ID) {
        const draftEngine = startOptionsRef.current.engine ?? "claude";

        if (draftEngine === "acp") {
          // Show user message + spinner immediately, before the potentially slow materializeDraft
          const userMsg: UIMessage = {
            id: `user-${Date.now()}`,
            role: "user" as const,
            content: text,
            timestamp: Date.now(),
            ...(images?.length ? { images } : {}),
            ...(displayText ? { displayContent: displayText } : {}),
          };
          acp.setMessages((prev) => [...prev, userMsg]);
          acp.setIsProcessing(true);

          const sessionId = await materializeDraft(text, images, displayText);
          if (!sessionId) {
            // materializeDraft failed or was cancelled — stop processing (error already shown)
            acp.setIsProcessing(false);
            return;
          }

          // Session is live — send the prompt (user message already in UI)
          await new Promise((resolve) => setTimeout(resolve, 50));
          const promptResult = await window.claude.acp.prompt(sessionId, text, images);
          if (promptResult?.error) {
            acp.setMessages((prev) => [
              ...prev,
              {
                id: `system-acp-error-${Date.now()}`,
                role: "system" as const,
                content: `ACP prompt error: ${promptResult.error}`,
                timestamp: Date.now(),
              },
            ]);
            acp.setIsProcessing(false);
          }
          return;
        }

        // Claude SDK path
        const sessionId = await materializeDraft(text);
        if (!sessionId) return;
        await new Promise((resolve) => setTimeout(resolve, 50));

        {
          const content = buildSdkContent(text, images);
          const sendResult = await window.claude.send(sessionId, {
            type: "user",
            message: { role: "user", content },
          });
          if (sendResult?.error) {
            liveSessionIdsRef.current.delete(sessionId);
            claude.setMessages((prev) => [
              ...prev,
              {
                id: `system-send-error-${Date.now()}`,
                role: "system",
                content: `Unable to send message: ${sendResult.error}`,
                timestamp: Date.now(),
              },
            ]);
            return;
          }
          claude.setMessages((prev) => [
            ...prev,
            {
              id: `user-${Date.now()}`,
              role: "user",
              content: text,
              timestamp: Date.now(),
              ...(images?.length ? { images } : {}),
              ...(displayText ? { displayContent: displayText } : {}),
            },
          ]);
        }
        return;
      }

      if (!activeId) return;

      // Queue check: if engine is processing, enqueue instead of sending directly
      if (isProcessingRef.current && liveSessionIdsRef.current.has(activeId)) {
        enqueueMessage(text, images, displayText);
        return;
      }

      // Check engine of the active session
      const activeSessionEngine = sessionsRef.current.find(s => s.id === activeId)?.engine ?? "claude";

      if (activeSessionEngine === "acp") {
        // ACP sessions: send through ACP hook if live
        if (liveSessionIdsRef.current.has(activeId)) {
          await acp.send(text, images, displayText);
          return;
        }
        // ACP session dead (app restarted) — attempt revival via session/load
        await reviveAcpSession(text, images, displayText);
        return;
      }

      // Claude SDK path
      if (liveSessionIdsRef.current.has(activeId)) {
        const sent = await claude.send(text, images, displayText);
        if (sent) return;
        liveSessionIdsRef.current.delete(activeId);
      }

      if (activeSessionIdRef.current !== DRAFT_ID) {
        await reviveSession(text, images, displayText);
        return;
      }
    },
    [claude.send, claude.setMessages, acp.send, acp.setMessages, acp.setIsProcessing, engine.setMessages, materializeDraft, reviveSession, enqueueMessage],
  );

  const deselectSession = useCallback(async () => {
    clearQueue();
    abandonEagerSession();
    await saveCurrentSession();
    seedBackgroundStore();
    setActiveSessionId(null);
    setDraftProjectId(null);
    setInitialMessages([]);
    setInitialMeta(null);
    setInitialPermission(null);
    setInitialRawAcpPermission(null);
    // Filter out any leftover DRAFT_ID placeholder from a pending ACP start
    setSessions((prev) => prev.filter(s => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })));
  }, [saveCurrentSession, seedBackgroundStore, abandonEagerSession, clearQueue]);

  const isDraft = activeSessionId === DRAFT_ID;
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  // Full revert: rewind files + fork a new SDK session truncated to the checkpoint.
  // Uses forkSession so the model genuinely forgets messages after the fork point.
  // Flow: revertFiles → stop old session → start forked session → migrate session ID.
  // Follows the same ID-migration pattern as restartAcpSession (lines 281-291).
  const fullRevertSession = useCallback(async (checkpointId: string) => {
    const currentId = activeSessionIdRef.current;
    if (!currentId || currentId === DRAFT_ID) return;

    const session = sessionsRef.current.find(s => s.id === currentId);
    if (!session) return;
    const project = findProject(session.projectId);
    if (!project) return;

    // 1. Flush any pending streaming content
    claude.flushNow();
    claude.resetStreaming();

    // 2. Compute truncated messages BEFORE the async IPC calls
    const currentMessages = messagesRef.current;
    const checkpointIdx = currentMessages.findIndex(
      (m) => m.role === "user" && m.checkpointId === checkpointId,
    );
    const truncatedMessages = checkpointIdx >= 0
      ? currentMessages.slice(0, checkpointIdx)
      : currentMessages;

    // 3. Revert files while old session is still alive (needs queryHandle.rewindFiles)
    const revertResult = await window.claude.revertFiles(currentId, checkpointId);
    if (revertResult.error) {
      claude.setMessages(prev => [...prev, {
        id: `system-revert-err-${Date.now()}`,
        role: "system" as const,
        content: `File revert failed: ${revertResult.error}`,
        isError: true,
        timestamp: Date.now(),
      }]);
      return;
    }

    // 4. Stop old session — cleanup runs async in the event loop's finally block
    await window.claude.stop(currentId);
    liveSessionIdsRef.current.delete(currentId);
    backgroundStoreRef.current.delete(currentId);

    // 5. Start a forked session — SDK creates a new session branched at the checkpoint.
    //    start() returns a FRESH session ID when forkSession is true (avoids race
    //    with old session's async cleanup which would delete a same-key Map entry).
    const mcpServers = await window.claude.mcp.list(session.projectId);
    const startResult = await window.claude.start({
      cwd: project.path,
      model: session.model,
      permissionMode: startOptionsRef.current.permissionMode,
      resume: currentId,
      forkSession: true,
      resumeSessionAt: checkpointId,
      mcpServers,
    });

    if (startResult.error) {
      claude.setMessages(prev => [...prev, {
        id: `system-revert-err-${Date.now()}`,
        role: "system" as const,
        content: `Full revert failed: ${startResult.error}`,
        isError: true,
        timestamp: Date.now(),
      }]);
      return;
    }

    const newId = startResult.sessionId;
    liveSessionIdsRef.current.add(newId);

    // 6. Map sidebar entry to new forked ID
    setSessions(prev => prev.map(s =>
      s.id === currentId ? { ...s, id: newId } : s,
    ));

    // 7. Provide truncated messages + system message via initialMessages → reset effect
    const systemMsg: UIMessage = {
      id: `system-revert-${Date.now()}`,
      role: "system" as const,
      content: "Session reverted: files restored and chat history truncated.",
      timestamp: Date.now(),
    };
    setInitialMessages([...truncatedMessages, systemMsg]);
    setInitialMeta({
      isProcessing: false,
      isConnected: true,
      sessionInfo: null, // repopulated by system/init event from forked session
      totalCost: totalCostRef.current,
    });

    // 8. Switch to new session ID → triggers useClaude's reset effect
    setActiveSessionId(newId);

    // 9. Persist: save under new forked ID, delete old session file
    const oldData = await window.claude.sessions.load(project.id, currentId);
    if (oldData) {
      await window.claude.sessions.save({
        ...oldData,
        id: newId,
        messages: [...truncatedMessages, systemMsg],
      });
      await window.claude.sessions.delete(project.id, currentId);
    }
  }, [findProject, claude.flushNow, claude.resetStreaming, claude.setMessages]);

  return {
    sessions,
    activeSessionId,
    activeSession,
    isDraft,
    draftProjectId,
    createSession,
    switchSession,
    deselectSession,
    deleteSession,
    renameSession,
    importCCSession,
    setActiveModel,
    setActivePermissionMode,
    setDraftAgent,
    messages: engine.messages,
    isProcessing: engine.isProcessing,
    isConnected: engine.isConnected || isDraft,
    sessionInfo: engine.sessionInfo,
    totalCost: engine.totalCost,
    send,
    queuedCount,
    stop: engine.stop,
    interrupt: async () => {
      // Clear queued messages before interrupting
      clearQueue();
      // During ACP startup (DRAFT + processing), abort the pending start process
      if (activeSessionIdRef.current === DRAFT_ID
          && startOptionsRef.current.engine === "acp"
          && isProcessingRef.current) {
        await window.claude.acp.abortPendingStart();
        acp.setIsProcessing(false);
        return;
      }
      await engine.interrupt();
    },
    pendingPermission: engine.pendingPermission,
    respondPermission: engine.respondPermission,
    contextUsage: engine.contextUsage,
    isCompacting: engine.isCompacting,
    compact: engine.compact,
    acpConfigOptions: acp.configOptions,
    setACPConfig: acp.setConfig,
    mcpServerStatuses: isACP
      ? (acpMcpStatuses.length > 0 ? acpMcpStatuses : draftMcpStatuses)
      : (claude.mcpServerStatuses.length > 0 ? claude.mcpServerStatuses : draftMcpStatuses),
    mcpStatusPreliminary: isDraft && draftMcpStatuses.length > 0 && (
      isACP ? acpMcpStatuses.length === 0 : claude.mcpServerStatuses.length === 0
    ),
    refreshMcpStatus: isACP
      ? (() => Promise.resolve())
      : (preStartedSessionId && isDraft)
        ? (async () => {
            const result = await window.claude.mcpStatus(preStartedSessionId);
            if (result.servers?.length) {
              setDraftMcpStatuses(result.servers.map(s => ({
                name: s.name,
                status: toMcpStatusState(s.status),
              })));
            }
          })
        : claude.refreshMcpStatus,
    reconnectMcpServer: isACP
      ? isDraft
        ? async (_name: string) => {
            // ACP draft: re-probe to pick up auth changes
            if (draftProjectIdRef.current) await probeMcpServers(draftProjectIdRef.current);
          }
        : async (_name: string) => {
            // ACP live: restart session so fresh auth tokens are applied
            const currentId = activeSessionIdRef.current;
            const session = sessionsRef.current.find(s => s.id === currentId);
            if (!session) return;
            const servers = await window.claude.mcp.list(session.projectId);
            await restartAcpSession(servers);
          }
      : (preStartedSessionId && isDraft)
        ? (async (name: string) => {
            const result = await window.claude.mcpReconnect(preStartedSessionId, name);
            if (result?.restarted) {
              await new Promise(r => setTimeout(r, 3000));
            }
            const statusResult = await window.claude.mcpStatus(preStartedSessionId);
            if (statusResult.servers?.length) {
              setDraftMcpStatuses(statusResult.servers.map(s => ({
                name: s.name,
                status: toMcpStatusState(s.status),
              })));
            }
          })
        : claude.reconnectMcpServer,
    supportedModels: claude.supportedModels.length > 0 ? claude.supportedModels : cachedModels,
    restartWithMcpServers: isACP
      ? isDraft
        ? async (servers: McpServerConfig[]) => {
            // ACP draft: reprobe with new server list
            if (draftProjectIdRef.current) {
              await probeMcpServers(draftProjectIdRef.current, servers);
            }
          }
        : async (servers: McpServerConfig[]) => {
            // ACP live: stop + restart session with updated MCP servers
            await restartAcpSession(servers);
          }
      : (preStartedSessionId && isDraft)
        ? async (_servers: McpServerConfig[]) => {
            // Claude eager draft: stop old eager session and start fresh
            abandonEagerSession();
            setDraftMcpStatuses(_servers.map(s => ({
              name: s.name,
              status: "pending" as const,
            })));
            if (draftProjectIdRef.current) {
              eagerStartSession(draftProjectIdRef.current, startOptionsRef.current);
            }
          }
        : claude.restartWithMcpServers,
    // File revert: only supported by Claude SDK engine (ACP has no native checkpoint support)
    revertFiles: isACP ? undefined : claude.revertFiles,
    fullRevert: isACP ? undefined : fullRevertSession,
  };
}
