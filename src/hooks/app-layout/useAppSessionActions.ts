import { useCallback, useEffect, useState } from "react";
import { useProjectManager } from "@/hooks/useProjectManager";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useSettingsCompat } from "@/hooks/useSettingsCompat";
import type { ImageAttachment, InstalledAgent, ClaudeEffort, EngineId } from "@/types";
import { buildSessionOptions } from "./session-utils";

type SessionManagerState = ReturnType<typeof useSessionManager>;
type SettingsState = ReturnType<typeof useSettingsCompat>;
type ProjectManagerState = ReturnType<typeof useProjectManager>;

interface UseAppSessionActionsInput {
  manager: SessionManagerState;
  settings: SettingsState;
  selectedAgent: InstalledAgent | null;
  setSelectedAgent: (agent: InstalledAgent | null) => void;
  refreshAgents: () => Promise<void> | void;
  activeSpaceId: string;
  projectManager: Pick<ProjectManagerState, "projects" | "createProject" | "createDevProject">;
}

export function useAppSessionActions(input: UseAppSessionActionsInput) {
  const [showSettings, setShowSettings] = useState(false);

  const getClaudeEffortForModel = useCallback((model: string | undefined): ClaudeEffort | undefined => {
    if (!model) return undefined;
    const meta = input.manager.supportedModels.find((entry) => entry.value === model);
    if (!meta?.supportsEffort) return undefined;
    const levels = meta.supportedEffortLevels ?? [];
    if (levels.includes(input.settings.claudeEffort)) return input.settings.claudeEffort;
    if (levels.includes("high")) return "high";
    return levels[0];
  }, [input.manager.supportedModels, input.settings.claudeEffort]);

  const handleAgentWorktreeChange = useCallback((nextPath: string | null) => {
    input.settings.setGitCwd(nextPath);

    if (input.manager.activeSessionId && !input.manager.isDraft && input.manager.activeSession) {
      const engine = input.manager.activeSession.engine ?? "claude";
      const options = buildSessionOptions(
        engine,
        input.settings.getModelForEngine,
        input.settings.permissionMode,
        input.settings.planMode,
        input.settings.thinking,
        getClaudeEffortForModel,
        input.selectedAgent,
      );
      void input.manager.createSession(input.manager.activeSession.projectId, {
        ...options,
        agentId: input.manager.activeSession.agentId,
      });
    }
  }, [getClaudeEffortForModel, input.manager, input.selectedAgent, input.settings]);

  const handleAgentChange = useCallback((agent: InstalledAgent | null) => {
    input.setSelectedAgent(agent);

    const currentEngine = input.manager.activeSession?.engine ?? "claude";
    const currentAgentId = input.manager.activeSession?.agentId;
    const wantedEngine = agent?.engine ?? "claude";
    const needsNewSession = !input.manager.isDraft && input.manager.activeSession && (
      currentEngine !== wantedEngine ||
      (currentEngine === "acp" && wantedEngine === "acp" && currentAgentId !== agent?.id)
    );

    if (needsNewSession) {
      const options = buildSessionOptions(
        wantedEngine,
        input.settings.getModelForEngine,
        input.settings.permissionMode,
        input.settings.planMode,
        input.settings.thinking,
        getClaudeEffortForModel,
        agent,
      );
      void input.manager.createSession(input.manager.activeSession!.projectId, options);
      return;
    }

    const wantedModel = input.settings.getModelForEngine(wantedEngine);
    input.manager.setDraftAgent(
      wantedEngine,
      agent?.id ?? "claude-code",
      agent?.cachedConfigOptions,
      wantedModel || undefined,
    );
  }, [getClaudeEffortForModel, input.manager, input.settings, input.setSelectedAgent]);

  const handleNewChat = useCallback(async (projectId: string) => {
    setShowSettings(false);
    const wantedEngine = input.selectedAgent?.engine ?? "claude";
    const options = buildSessionOptions(
      wantedEngine,
      input.settings.getModelForEngine,
      input.settings.permissionMode,
      input.settings.planMode,
      input.settings.thinking,
      getClaudeEffortForModel,
      input.selectedAgent,
    );
    await input.manager.createSession(projectId, options);
  }, [getClaudeEffortForModel, input.manager, input.selectedAgent, input.settings]);

  const handleSend = useCallback(async (text: string, images?: ImageAttachment[], displayText?: string) => {
    const currentEngine = input.manager.activeSession?.engine ?? "claude";
    const wantedEngine = input.selectedAgent?.engine ?? "claude";
    const needsNewSession = !input.manager.isDraft && input.manager.activeSession && (
      currentEngine !== wantedEngine ||
      (currentEngine === "acp" && wantedEngine === "acp" && input.manager.activeSession.agentId !== input.selectedAgent?.id)
    );
    if (needsNewSession) {
      const options = buildSessionOptions(
        wantedEngine,
        input.settings.getModelForEngine,
        input.settings.permissionMode,
        input.settings.planMode,
        input.settings.thinking,
        getClaudeEffortForModel,
        input.selectedAgent,
      );
      await input.manager.createSession(input.manager.activeSession!.projectId, options);
    }
    await input.manager.send(text, images, displayText);
  }, [getClaudeEffortForModel, input.manager, input.selectedAgent, input.settings]);

  const handleModelChange = useCallback((nextModel: string) => {
    const settingsEngine: EngineId = (!input.manager.isDraft && input.manager.activeSession?.engine)
      ? input.manager.activeSession.engine
      : (input.selectedAgent?.engine ?? "claude");
    input.settings.setModel(nextModel);
    input.manager.setActiveModel(nextModel);
    if (settingsEngine !== "claude") return;
    const nextEffort = getClaudeEffortForModel(nextModel);
    if (!nextEffort || nextEffort === input.settings.claudeEffort) return;
    input.settings.setClaudeEffort(nextEffort);
  }, [getClaudeEffortForModel, input.manager, input.selectedAgent, input.settings]);

  const handlePermissionModeChange = useCallback((nextMode: string) => {
    input.settings.setPermissionMode(nextMode);
    input.manager.setActivePermissionMode(nextMode);
  }, [input.manager, input.settings]);

  const handlePlanModeChange = useCallback((enabled: boolean) => {
    input.settings.setPlanMode(enabled);
    input.manager.setActivePlanMode(enabled);
  }, [input.manager, input.settings]);

  const handleClaudeModelEffortChange = useCallback((model: string, effort: ClaudeEffort) => {
    input.settings.setModel(model);
    input.settings.setClaudeEffort(effort);
    input.manager.setActiveClaudeModelAndEffort(model, effort);
  }, [input.manager, input.settings]);

  const handleStop = useCallback(async () => {
    await input.manager.interrupt();
  }, [input.manager]);

  const handleSendQueuedNow = useCallback(async (messageId: string) => {
    await input.manager.sendQueuedMessageNext(messageId);
  }, [input.manager]);

  const handleUnqueueMessage = useCallback((messageId: string) => {
    input.manager.unqueueMessage(messageId);
  }, [input.manager]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setShowSettings(false);
    input.manager.switchSession(sessionId);
  }, [input.manager]);

  const handleCreateProject = useCallback(async () => {
    setShowSettings(false);
    await input.projectManager.createProject(input.activeSpaceId);
  }, [input.activeSpaceId, input.projectManager]);

  const handleImportCCSession = useCallback(async (projectId: string, ccSessionId: string) => {
    await input.manager.importCCSession(projectId, ccSessionId);
  }, [input.manager]);

  const handleSeedDevExampleSpaceData = useCallback(async () => {
    if (!import.meta.env.DEV) return;
    const { seedDevExampleSpaceData } = await import("@/lib/dev-seeding/space-seeding");
    await seedDevExampleSpaceData({
      activeSpaceId: input.activeSpaceId,
      existingProjects: input.projectManager.projects,
      createDevProject: input.projectManager.createDevProject,
      saveSession: window.claude.sessions.save,
      refreshSessions: input.manager.refreshSessions,
    });
  }, [input.activeSpaceId, input.manager.refreshSessions, input.projectManager.createDevProject, input.projectManager.projects]);

  const handleNavigateToMessage = useCallback((sessionId: string, setScrollToMessageId: (messageId: string) => void, messageId: string) => {
    input.manager.switchSession(sessionId);
    setTimeout(() => setScrollToMessageId(messageId), 200);
  }, [input.manager]);

  useEffect(() => {
    const agentId = input.manager.activeSession?.agentId;
    if (!agentId || input.manager.activeSession?.engine !== "acp") return;
    if (!input.manager.acpConfigOptions?.length) return;

    window.claude.agents.updateCachedConfig(agentId, input.manager.acpConfigOptions)
      .then(() => input.refreshAgents());
  }, [input.manager.acpConfigOptions, input.manager.activeSession, input.refreshAgents]);

  return {
    showSettings,
    setShowSettings,
    getClaudeEffortForModel,
    handleAgentWorktreeChange,
    handleAgentChange,
    handleNewChat,
    handleSend,
    handleModelChange,
    handlePermissionModeChange,
    handlePlanModeChange,
    handleClaudeModelEffortChange,
    handleStop,
    handleSendQueuedNow,
    handleUnqueueMessage,
    handleSelectSession,
    handleCreateProject,
    handleImportCCSession,
    handleSeedDevExampleSpaceData,
    handleNavigateToMessage,
  };
}
