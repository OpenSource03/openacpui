import { useCallback } from "react";
import type { ImageAttachment, Project } from "../../types";
import type { CollaborationMode } from "../../types/codex-protocol/CollaborationMode";
import { toMcpStatusState } from "../../lib/mcp-utils";
import { imageAttachmentsToCodexInputs } from "../../lib/codex-adapter";
import { buildSdkContent } from "../../lib/protocol";
import {
  DRAFT_ID,
  getEffectiveClaudePermissionMode,
  getCodexApprovalPolicy,
  buildCodexCollabMode,
} from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks } from "./types";

interface UseSessionRevivalParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
}

export function useSessionRevival({
  refs,
  setters,
  engines,
  findProject,
  getProjectCwd,
}: UseSessionRevivalParams) {
  const { acp, codex, engine } = engines;
  const {
    setSessions,
    setActiveSessionId,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setAcpMcpStatuses,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    messagesRef,
    totalCostRef,
    liveSessionIdsRef,
    startOptionsRef,
    codexEffortRef,
    acpAgentIdRef,
    acpAgentSessionIdRef,
  } = refs;

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
        cwd: getProjectCwd(project),
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

  /** Revive a dead Codex session — spawn new app-server + thread/resume */
  const reviveCodexSession = useCallback(
    async (text: string, images?: ImageAttachment[]) => {
      const oldId = activeSessionIdRef.current;
      if (!oldId || oldId === DRAFT_ID) return;
      const session = sessionsRef.current.find((s) => s.id === oldId);
      if (!session) return;
      const project = findProject(session.projectId);
      if (!project) return;

      // Resolve thread ID from in-memory session first, then persisted session.
      let codexThreadId: string | undefined = session.codexThreadId;
      if (!codexThreadId) {
        try {
          const persisted = await window.claude.sessions.load(session.projectId, oldId);
          codexThreadId = persisted?.codexThreadId;
        } catch { /* ignore */ }
      }

      if (!codexThreadId) {
        codex.setMessages((prev) => [...prev, {
          id: `system-error-${Date.now()}`,
          role: "system" as const,
          content: "Codex session cannot be resumed (no thread ID). Please start a new session.",
          isError: true,
          timestamp: Date.now(),
        }]);
        return;
      }

      const result = await window.claude.codex.resume({
        cwd: getProjectCwd(project),
        threadId: codexThreadId,
        model: session.model,
        approvalPolicy: getCodexApprovalPolicy(startOptionsRef.current),
      });

      if (result.error || !result.sessionId) {
        codex.setMessages((prev) => [...prev, {
          id: `system-error-${Date.now()}`,
          role: "system" as const,
          content: result.error || "Failed to resume Codex session.",
          isError: true,
          timestamp: Date.now(),
        }]);
        return;
      }

      const newId = result.sessionId;
      liveSessionIdsRef.current.add(newId);

      setSessions((prev) => prev.map((s) =>
        s.id === oldId ? { ...s, id: newId, codexThreadId: result.threadId ?? codexThreadId } : s,
      ));
      setInitialMessages(messagesRef.current);
      setInitialMeta({ isProcessing: false, isConnected: true, sessionInfo: null, totalCost: totalCostRef.current });
      setActiveSessionId(newId);

      // Small delay to let hook pick up new sessionId
      await new Promise((resolve) => setTimeout(resolve, 50));
      codex.setMessages((prev) => [...prev, {
        id: `user-${Date.now()}`,
        role: "user" as const,
        content: text,
        timestamp: Date.now(),
        ...(images?.length ? { images } : {}),
      }]);
      codex.setIsProcessing(true);
      let codexCollabMode: CollaborationMode | undefined;
      try {
        codexCollabMode = buildCodexCollabMode(startOptionsRef.current.planMode, session.model);
      } catch (err) {
        codex.setMessages((prev) => [...prev, {
          id: `system-error-${Date.now()}`,
          role: "system" as const,
          content: err instanceof Error ? err.message : String(err),
          isError: true,
          timestamp: Date.now(),
        }]);
        codex.setIsProcessing(false);
        return;
      }
      const sendResult = await window.claude.codex.send(
        newId,
        text,
        imageAttachmentsToCodexInputs(images),
        codexEffortRef.current,
        codexCollabMode,
      );
      if (sendResult?.error) {
        codex.setMessages((prev) => [...prev, {
          id: `system-error-${Date.now()}`,
          role: "system" as const,
          content: `Unable to send message: ${sendResult.error}`,
          isError: true,
          timestamp: Date.now(),
        }]);
        codex.setIsProcessing(false);
      }
    },
    [findProject, codex.setMessages, codex.setIsProcessing],
  );

  // Claude SDK revival — resume session to restore conversation context
  const reviveSession = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      const oldId = activeSessionIdRef.current;
      if (!oldId || oldId === DRAFT_ID) return;
      const session = sessionsRef.current.find((s) => s.id === oldId);
      if (!session) return;
      const project = findProject(session.projectId);
      if (!project) return;

      const startPayload = {
        cwd: getProjectCwd(project),
        ...(session.model ? { model: session.model } : {}),
        permissionMode: getEffectiveClaudePermissionMode(startOptionsRef.current),
        thinkingEnabled: startOptionsRef.current.thinkingEnabled,
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

  return {
    reviveSession,
    reviveAcpSession,
    reviveCodexSession,
  };
}
