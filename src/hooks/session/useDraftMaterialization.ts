import { useCallback } from "react";
import type { UIMessage, ChatSession, McpServerConfig, Project, ImageAttachment, EngineId } from "../../types";
import { toMcpStatusState } from "../../lib/mcp-utils";
import {
  DRAFT_ID,
  getEffectiveClaudePermissionMode,
  getCodexApprovalPolicy,
  normalizeCodexModels,
  pickCodexModel,
} from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks, StartOptions } from "./types";

interface UseDraftMaterializationParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
  generateSessionTitle: (sessionId: string, message: string, projectPath: string, engine?: EngineId) => Promise<void>;
  applyCodexModelDefaultEffort: (effort: string | undefined) => void;
}

export function useDraftMaterialization({
  refs,
  setters,
  engines,
  findProject,
  getProjectCwd,
  generateSessionTitle,
  applyCodexModelDefaultEffort,
}: UseDraftMaterializationParams) {
  const { claude, codex } = engines;
  const {
    setSessions,
    setActiveSessionId,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setInitialPermission,
    setInitialRawAcpPermission,
    setDraftProjectId,
    setPreStartedSessionId,
    setDraftMcpStatuses,
    setAcpMcpStatuses,
    setCachedModels,
    setCodexRawModels,
  } = setters;
  const {
    activeSessionIdRef,
    draftProjectIdRef,
    startOptionsRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    preStartedSessionIdRef,
    draftMcpStatusesRef,
    materializingRef,
    acpAgentIdRef,
    acpAgentSessionIdRef,
    codexRawModelsRef,
  } = refs;

  // Eagerly start a Claude SDK session for immediate MCP status display
  const eagerStartSession = useCallback(async (projectId: string, options?: StartOptions) => {
    const project = refs.projectsRef.current.find((p) => p.id === projectId);
    if (!project) return;
    const mcpServers = await window.claude.mcp.list(projectId);
    let result;
    try {
      result = await window.claude.start({
        cwd: getProjectCwd(project),
        model: options?.model,
        permissionMode: getEffectiveClaudePermissionMode(options ?? {}),
        thinkingEnabled: options?.thinkingEnabled,
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
      window.claude.stop(result.sessionId, "draft_abandoned");
    }
  }, []);

  // Load Codex models ahead of first message so the model picker is usable in draft mode.
  const prefetchCodexModels = useCallback(async (preferredModel?: string) => {
    try {
      const result = await window.claude.codex.listModels();
      const models = normalizeCodexModels(result.models ?? []);
      if (models.length === 0) return;

      setCodexRawModels(models);
      codex.setCodexModels(models.map((m) => ({
        value: m.id,
        displayName: m.displayName,
        description: m.description,
      })));

      const selected = pickCodexModel(preferredModel, models);
      const selectedModel = selected
        ? models.find((m) => m.id === selected)
        : undefined;
      applyCodexModelDefaultEffort(selectedModel?.defaultReasoningEffort);

      setters.setStartOptions((prev) => {
        if ((prev.engine ?? "claude") !== "codex") return prev;
        if (!selected || prev.model === selected) return prev;
        return { ...prev, model: selected };
      });
    } catch {
      // Model prefetch is optional — draft session can still start on first send.
    }
  }, [applyCodexModelDefaultEffort, codex.setCodexModels]);

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
  const abandonEagerSession = useCallback((reason = "cleanup") => {
    const id = preStartedSessionIdRef.current;
    if (!id) return;
    window.claude.stop(id, reason);
    liveSessionIdsRef.current.delete(id);
    backgroundStoreRef.current.delete(id);
    preStartedSessionIdRef.current = null;
    setPreStartedSessionId(null);
    setDraftMcpStatuses([]);
  }, []);

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
      let sessionId: string;
      let sessionModel = options.model;
      let codexThreadId: string | undefined;
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

        const result = await window.claude.acp.start({
          agentId: options.agentId,
          cwd: getProjectCwd(project),
          mcpServers,
        });
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
      } else if (draftEngine === "codex") {
        // Codex app-server path
        setSessions(prev => [{
          id: DRAFT_ID,
          projectId: project.id,
          title: "New Chat",
          createdAt: Date.now(),
          lastMessageAt: Date.now(),
          totalCost: 0,
          isActive: true,
          engine: "codex" as const,
          agentId: options.agentId ?? "codex",
        }, ...prev.map(s => ({ ...s, isActive: false }))]);

        const draftModel = pickCodexModel(options.model, codexRawModelsRef.current);
        const approvalPolicy = getCodexApprovalPolicy(options);
        const result = await window.claude.codex.start({
          cwd: getProjectCwd(project),
          ...(draftModel ? { model: draftModel } : {}),
          ...(approvalPolicy ? { approvalPolicy } : {}),
        });

        if (result.error || !result.sessionId) {
          const errorMsg = result.error || "Failed to start Codex session";
          const failedId = `failed-codex-${Date.now()}`;
          const now = Date.now();
          const errorMessages: UIMessage[] = [
            { id: `user-${now}`, role: "user" as const, content: text, timestamp: now, ...(images?.length ? { images } : {}), ...(displayText ? { displayContent: displayText } : {}) },
            { id: `system-error-${now}`, role: "system" as const, content: errorMsg, isError: true, timestamp: now },
          ];
          setSessions(prev => prev.map(s => s.id === DRAFT_ID ? { ...s, id: failedId, titleGenerating: false } : s));
          setInitialMessages(errorMessages);
          setInitialMeta({ isProcessing: false, isConnected: false, sessionInfo: null, totalCost: 0 });
          setActiveSessionId(failedId);
          setDraftProjectId(null);
          window.claude.sessions.save({ id: failedId, projectId: project.id, title: "New Chat", createdAt: Date.now(), messages: errorMessages, totalCost: 0, engine: "codex" });
          materializingRef.current = false;
          return "";
        }

        sessionId = result.sessionId;
        codexThreadId = result.threadId;
        let resolvedCodexModel = result.selectedModel;

        // Store Codex models for the model picker (map from Codex Model → our ModelInfo)
        if (result.models && Array.isArray(result.models)) {
          const models = normalizeCodexModels(result.models);
          if (models.length > 0) {
            codex.setCodexModels(models.map((m) => ({
              value: m.id,
              displayName: m.displayName,
              description: m.description,
            })));
            setCodexRawModels(models);
            const selectedId = pickCodexModel(result.selectedModel ?? options.model, models);
            const selectedModel = selectedId
              ? models.find((m) => m.id === selectedId)
              : undefined;
            resolvedCodexModel = selectedId ?? resolvedCodexModel;
            applyCodexModelDefaultEffort(selectedModel?.defaultReasoningEffort);
          }
        }
        if (!resolvedCodexModel) {
          resolvedCodexModel = draftModel;
        }
        sessionModel = resolvedCodexModel ?? sessionModel;

        // If auth is required, show auth dialog (handled by UI layer via codex:auth_required event)
        if (result.needsAuth) {
          // Session is alive but waiting for auth — UI will render CodexAuthDialog
        }
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
              cwd: getProjectCwd(project),
              model: options.model,
              permissionMode: getEffectiveClaudePermissionMode(options),
              thinkingEnabled: options.thinkingEnabled,
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
        model: sessionModel,
        totalCost: 0,
        isActive: true,
        titleGenerating: true,
        engine: draftEngine,
        ...(draftEngine === "acp" && options.agentId ? {
          agentId: options.agentId,
          agentSessionId: acpAgentSessionIdRef.current ?? undefined,
        } : {}),
        ...(draftEngine === "codex" ? {
          agentId: options.agentId ?? "codex",
          codexThreadId,
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

      // Fire-and-forget AI title generation — routes through ACP if that's the active engine
      generateSessionTitle(sessionId, text, getProjectCwd(project), draftEngine);

      materializingRef.current = false;
      return sessionId;
    },
    [applyCodexModelDefaultEffort, findProject, generateSessionTitle, codex.setCodexModels],
  );

  return {
    eagerStartSession,
    prefetchCodexModels,
    probeMcpServers,
    abandonEagerSession,
    materializeDraft,
  };
}
