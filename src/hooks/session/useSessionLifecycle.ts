import { useCallback } from "react";
import type { ImageAttachment, McpServerConfig, Project } from "@/types";
import type { CollaborationMode } from "../../types/codex-protocol/CollaborationMode";
import { imageAttachmentsToCodexInputs } from "../../lib/engine/codex-adapter";
import { createSystemMessage, createUserMessage } from "../../lib/message-factory";
import { buildSdkContent } from "../../lib/engine/protocol";
import { capture } from "../../lib/analytics/analytics";
import { DRAFT_ID, buildCodexCollabMode } from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks, StartOptions } from "./types";
import { useSessionCache } from "./useSessionCache";
import { useSessionCrud } from "./useSessionCrud";
import { useSessionSettings } from "./useSessionSettings";
import { useSessionRestart } from "./useSessionRestart";

interface UseSessionLifecycleParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  projects: Project[];
  activeSessionId: string | null;
  activeEngine: string;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
  // From persistence
  saveCurrentSession: () => Promise<void>;
  seedBackgroundStore: () => void;
  // From draft materialization
  eagerStartSession: (projectId: string, options?: StartOptions) => Promise<void>;
  eagerStartAcpSession: (projectId: string, options?: StartOptions, overrideServers?: McpServerConfig[]) => Promise<void>;
  prefetchCodexModels: (preferredModel?: string) => Promise<void>;
  probeMcpServers: (projectId: string, overrideServers?: McpServerConfig[]) => Promise<void>;
  abandonEagerSession: (reason?: string) => void;
  abandonDraftAcpSession: (reason?: string) => void;
  materializeDraft: (text: string, images?: ImageAttachment[], displayText?: string) => Promise<string>;
  // From revival
  reviveSession: (text: string, images?: ImageAttachment[], displayText?: string) => Promise<void>;
  reviveAcpSession: (text: string, images?: ImageAttachment[], displayText?: string) => Promise<void>;
  reviveCodexSession: (text: string, images?: ImageAttachment[]) => Promise<void>;
  // From message queue
  enqueueMessage: (text: string, images?: ImageAttachment[], displayText?: string) => void;
  clearQueue: () => void;
  // Codex effort helpers
  resetCodexEffortToModelDefault: (effort: string | undefined) => void;
}

export function useSessionLifecycle({
  refs,
  setters,
  engines,
  projects,
  activeSessionId,
  activeEngine,
  findProject,
  getProjectCwd,
  saveCurrentSession,
  seedBackgroundStore,
  eagerStartSession,
  eagerStartAcpSession,
  prefetchCodexModels,
  probeMcpServers,
  abandonEagerSession,
  abandonDraftAcpSession,
  materializeDraft,
  reviveSession,
  reviveAcpSession,
  reviveCodexSession,
  enqueueMessage,
  clearQueue,
  resetCodexEffortToModelDefault,
}: UseSessionLifecycleParams) {
  const { claude, acp, codex } = engines;

  // ── Session cache: LRU payload cache, session list loading, model hydration ──
  const {
    cacheSessionPayload,
    consumeCachedSessionPayload,
    applyLoadedSession,
    evictFromCache,
  } = useSessionCache({
    refs,
    setters,
    engines,
    projects,
    activeSessionId,
    activeEngine,
    getProjectCwd,
    prefetchCodexModels,
  });

  // ── Session CRUD: create, switch, delete, rename, deselect, import, draft agent ──
  const {
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    deselectSession,
    importCCSession,
    setDraftAgent,
  } = useSessionCrud({
    refs,
    setters,
    engines,
    findProject,
    getProjectCwd,
    saveCurrentSession,
    seedBackgroundStore,
    eagerStartSession,
    eagerStartAcpSession,
    prefetchCodexModels,
    probeMcpServers,
    abandonEagerSession,
    abandonDraftAcpSession,
    cacheSessionPayload,
    consumeCachedSessionPayload,
    applyLoadedSession,
    evictFromCache,
    clearQueue,
  });

  // ── Session settings: model, permission mode, plan mode, thinking, effort ──
  const {
    setActiveModel,
    setActivePermissionMode,
    setActivePlanMode,
    setActiveThinking,
    setActiveClaudeEffort,
    setActiveClaudeModelAndEffort,
    setSessionModel,
    setSessionPermissionMode,
    setSessionPlanMode,
    setSessionClaudeModelAndEffort,
  } = useSessionSettings({
    refs,
    setters,
    engines,
    eagerStartSession,
    abandonEagerSession,
    resetCodexEffortToModelDefault,
  });

  // ── Session restart: ACP restart, worktree restart, full revert ──
  const {
    restartAcpSession,
    restartActiveSessionInCurrentWorktree,
    fullRevertSession,
  } = useSessionRestart({
    refs,
    setters,
    engines,
    findProject,
    getProjectCwd,
  });

  // ── Send: the main message-sending function (kept here — most intertwined) ──

  const send = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      const activeId = refs.activeSessionIdRef.current;
      const sendEngine = refs.activeSessionIdRef.current === DRAFT_ID
        ? (refs.startOptionsRef.current.engine ?? "claude")
        : (refs.sessionsRef.current.find(s => s.id === refs.activeSessionIdRef.current)?.engine ?? "claude");
      const trackMessageSent = (sessionId?: string) => {
        capture("message_sent", {
          engine: sendEngine,
          has_images: !!images?.length,
          message_length: text.length,
          ...(sendEngine === "acp" && sessionId ? { session_id: sessionId } : {}),
        });
      };

      if (activeId === DRAFT_ID) {
        const draftEngine = refs.startOptionsRef.current.engine ?? "claude";

        if (draftEngine === "acp") {
          refs.pendingAcpDraftPromptRef.current = { text, images, displayText };
          // Show user message + spinner immediately, before the potentially slow materializeDraft
          const userMsg = createUserMessage(text, images, displayText);
          acp.setMessages((prev) => [...prev, userMsg]);
          acp.setIsProcessing(true);

          const sessionId = await materializeDraft(text, images, displayText);
          if (!sessionId) {
            // materializeDraft failed, was cancelled, or is waiting for auth.
            if (!acp.authRequired) {
              refs.pendingAcpDraftPromptRef.current = null;
            }
            acp.setIsProcessing(false);
            return;
          }

          trackMessageSent(sessionId);

          // Session is live — send the prompt (user message already in UI)
          await new Promise((resolve) => setTimeout(resolve, 50));
          const promptResult = await window.claude.acp.prompt(sessionId, text, images);
          if (promptResult?.error) {
            acp.setMessages((prev) => [
              ...prev,
              createSystemMessage(`ACP prompt error: ${promptResult.error}`, true),
            ]);
            acp.setIsProcessing(false);
            refs.pendingAcpDraftPromptRef.current = null;
            return;
          }
          refs.pendingAcpDraftPromptRef.current = null;
          return;
        }

        if (draftEngine === "codex") {
          trackMessageSent();
          const sessionId = await materializeDraft(text, images, displayText);
          if (!sessionId) return;
          await new Promise((resolve) => setTimeout(resolve, 50));

          codex.setMessages((prev) => [
            ...prev,
            createUserMessage(text, images, displayText),
          ]);
          codex.setIsProcessing(true);

          const codexSession = refs.sessionsRef.current.find((s) => s.id === sessionId);
          let codexCollabMode: CollaborationMode | undefined;
          try {
            codexCollabMode = buildCodexCollabMode(refs.startOptionsRef.current.planMode, codexSession?.model);
          } catch (err) {
            codex.setMessages((prev) => [
              ...prev,
              createSystemMessage(err instanceof Error ? err.message : String(err), true),
            ]);
            codex.setIsProcessing(false);
            return;
          }
          const sendResult = await window.claude.codex.send(
            sessionId,
            text,
            imageAttachmentsToCodexInputs(images),
            refs.codexEffortRef.current,
            codexCollabMode,
          );
          if (sendResult?.error) {
            refs.liveSessionIdsRef.current.delete(sessionId);
            codex.setMessages((prev) => [
              ...prev,
              createSystemMessage(`Unable to send message: ${sendResult.error}`, true),
            ]);
            codex.setIsProcessing(false);
          }
          return;
        }

        // Claude SDK path
        trackMessageSent();
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
            refs.liveSessionIdsRef.current.delete(sessionId);
            claude.setMessages((prev) => [
              ...prev,
              createSystemMessage(`Unable to send message: ${sendResult.error}`, true),
            ]);
            return;
          }
          claude.setMessages((prev) => [
            ...prev,
            createUserMessage(text, images, displayText),
          ]);
        }
        return;
      }

      if (!activeId) return;

      // Queue check: if engine is processing, enqueue instead of sending directly
      const activeSessionEngine = refs.sessionsRef.current.find(s => s.id === activeId)?.engine ?? "claude";
      if (refs.isProcessingRef.current && refs.liveSessionIdsRef.current.has(activeId)) {
        trackMessageSent(activeSessionEngine === "acp" ? activeId : undefined);
        enqueueMessage(text, images, displayText);
        return;
      }

      if (activeSessionEngine === "acp") {
        // ACP sessions: send through ACP hook if live
        if (refs.liveSessionIdsRef.current.has(activeId)) {
          trackMessageSent(activeId);
          await acp.send(text, images, displayText);
          return;
        }
        // ACP session dead (app restarted) — attempt revival via session/load
        await reviveAcpSession(text, images, displayText);
        return;
      }

      trackMessageSent();

      if (activeSessionEngine === "codex") {
        // Codex sessions: send through Codex hook if live
        if (refs.liveSessionIdsRef.current.has(activeId)) {
          const activeSession = refs.sessionsRef.current.find((s) => s.id === activeId);
          let codexCollabMode: CollaborationMode | undefined;
          try {
            codexCollabMode = buildCodexCollabMode(refs.startOptionsRef.current.planMode, activeSession?.model);
          } catch (err) {
            codex.setMessages((prev) => [
              ...prev,
              createSystemMessage(err instanceof Error ? err.message : String(err), true),
            ]);
            return;
          }
          await codex.send(text, images, displayText, codexCollabMode);
          return;
        }
        // Codex session dead — attempt revival via thread/resume
        await reviveCodexSession(text, images);
        return;
      }

      // Claude SDK path
      if (refs.liveSessionIdsRef.current.has(activeId)) {
        const sent = await claude.send(text, images, displayText);
        if (sent) return;
        refs.liveSessionIdsRef.current.delete(activeId);
      }

      if (refs.activeSessionIdRef.current !== DRAFT_ID) {
        await reviveSession(text, images, displayText);
        return;
      }
    },
    [
      claude.send,
      claude.setMessages,
      acp.send,
      acp.setMessages,
      acp.setIsProcessing,
      codex.send,
      codex.setMessages,
      codex.setIsProcessing,
      materializeDraft,
      reviveSession,
      reviveAcpSession,
      reviveCodexSession,
      enqueueMessage,
    ],
  );

  return {
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    deselectSession,
    importCCSession,
    setDraftAgent,
    setActiveModel,
    setSessionModel,
    setActivePermissionMode,
    setSessionPermissionMode,
    setActivePlanMode,
    setSessionPlanMode,
    setActiveThinking,
    setActiveClaudeEffort,
    setActiveClaudeModelAndEffort,
    setSessionClaudeModelAndEffort,
    restartAcpSession,
    restartActiveSessionInCurrentWorktree,
    fullRevertSession,
    send,
  };
}
