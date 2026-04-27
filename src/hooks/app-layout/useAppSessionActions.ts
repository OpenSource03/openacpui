import { useCallback, useEffect } from "react";
import { useProjectManager } from "@/hooks/useProjectManager";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useSettingsCompat } from "@/hooks/useSettingsCompat";
import type { ImageAttachment, InstalledAgent, ClaudeEffort, EngineId } from "@/types";
import type { SettingsSection } from "@/components/SettingsView";
import { buildSessionOptions } from "./session-utils";

type SessionManagerState = ReturnType<typeof useSessionManager>;
type SettingsState = ReturnType<typeof useSettingsCompat>;
type ProjectManagerState = ReturnType<typeof useProjectManager>;

interface UseAppSessionActionsInput {
  manager: SessionManagerState;
  settings: SettingsState;
  selectedAgent: InstalledAgent | null;
  setSelectedAgent: (agent: InstalledAgent | null) => void;
  setShowSettings: (show: SettingsSection | false) => void;
  refreshAgents: () => Promise<void> | void;
  activeSpaceId: string;
  projectManager: Pick<ProjectManagerState, "projects" | "createProject" | "createProjectAtPath" | "createDevProject">;
}

export function useAppSessionActions(input: UseAppSessionActionsInput) {
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
    input.setShowSettings(false);
    input.settings.setPlanMode(false);
    const wantedEngine = input.selectedAgent?.engine ?? "claude";
    const options = buildSessionOptions(
      wantedEngine,
      input.settings.getModelForEngine,
      input.settings.permissionMode,
      false,
      input.settings.thinking,
      getClaudeEffortForModel,
      input.selectedAgent,
    );
    await input.manager.createSession(projectId, options);
  }, [getClaudeEffortForModel, input.manager, input.selectedAgent, input.setShowSettings, input.settings]);

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
    input.setShowSettings(false);
    input.settings.setPlanMode(false);
    input.manager.switchSession(sessionId);
  }, [input.manager, input.setShowSettings, input.settings]);

  const handleCreateProject = useCallback(async () => {
    input.setShowSettings(false);
    await input.projectManager.createProject(input.activeSpaceId);
  }, [input.activeSpaceId, input.projectManager, input.setShowSettings]);

  const handleImportCCSession = useCallback(async (projectId: string, ccSessionId: string) => {
    await input.manager.importCCSession(projectId, ccSessionId);
  }, [input.manager]);

  /**
   * End-to-end import by session id — given only a Claude Code session id,
   * locate the JSONL across ~/.claude/projects/*, read its cwd, map it to a
   * Harnss project (creating one at that path if missing), then run the
   * existing CC import so the session is persisted + switched to.
   *
   * Returns an error object so the calling dialog can display failures.
   */
  const handleImportSessionById = useCallback(
    async (rawInput: string): Promise<{ ok: true; projectId: string } | { error: string }> => {
      // Tolerant input parsing: users may paste surrounding quotes, URLs, or
      // a prefixed label like "claude-session-xxx". Extract a UUID-shaped
      // substring — falls through to the backend's strict check which
      // returns a clear error if nothing UUID-like is present.
      const uuidMatch = rawInput.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      const sessionId = (uuidMatch ? uuidMatch[0] : rawInput).trim();
      if (!sessionId) return { error: "Session id is empty" };

      const found = await window.claude.ccSessions.findById(sessionId);
      if ("error" in found) return { error: found.error };
      if (!("found" in found) || !found.found) {
        return { error: `Session ${sessionId} not found in ~/.claude/projects` };
      }

      const rawCwd = found.cwd ?? found.cwdFallbackFromDirName;
      if (!rawCwd) return { error: "Session file has no cwd and directory-name fallback is missing" };
      // Normalize trailing slash / double separators so that the equality
      // check below matches regardless of how the user originally registered
      // the project (with or without a trailing "/"). We don't realpath —
      // symlink divergence is rare and resolving it in the renderer would
      // require another IPC round-trip.
      const cwd = rawCwd.replace(/\/+$/, "");

      const existing = input.projectManager.projects.find(
        (p) => p.path.replace(/\/+$/, "") === cwd,
      );
      let projectId: string;
      if (existing) {
        projectId = existing.id;
      } else {
        const created = await input.projectManager.createProjectAtPath(cwd, input.activeSpaceId);
        if ("error" in created) return { error: `Failed to create project at ${cwd}: ${created.error}` };
        projectId = created.project.id;
      }

      const importResult = await input.manager.importCCSession(projectId, found.ccSessionId);
      if ("error" in importResult) return { error: importResult.error };
      return { ok: true, projectId };
    },
    [input.activeSpaceId, input.manager, input.projectManager],
  );

  /**
   * Twin of `handleImportSessionById` but resumes the session in CLI mode
   * (spawns `claude --resume <uuid>` in a pty) instead of importing the
   * JSONL transcript into the SDK session model.
   *
   * This is the default entry point from the global session browser — for
   * users on the cli-mode pivot, "Open" should mean "continue the actual
   * conversation in CLI", not "show me the messages as a static history".
   */
  const handleResumeCliSessionById = useCallback(
    async (
      rawInput: string,
    ): Promise<{ ok: true; projectId: string; sessionId: string } | { error: string }> => {
      const uuidMatch = rawInput.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      const sessionId = (uuidMatch ? uuidMatch[0] : rawInput).trim();
      if (!sessionId) return { error: "Session id is empty" };

      const found = await window.claude.ccSessions.findById(sessionId);
      if ("error" in found) return { error: found.error };
      if (!("found" in found) || !found.found) {
        return { error: `Session ${sessionId} not found in ~/.claude/projects` };
      }

      const rawCwd = found.cwd ?? found.cwdFallbackFromDirName;
      if (!rawCwd) return { error: "Session file has no cwd recorded" };
      const cwd = rawCwd.replace(/\/+$/, "");

      const existing = input.projectManager.projects.find(
        (p) => p.path.replace(/\/+$/, "") === cwd,
      );
      let projectId: string;
      if (existing) {
        projectId = existing.id;
      } else {
        const created = await input.projectManager.createProjectAtPath(cwd, input.activeSpaceId);
        if ("error" in created) return { error: `Failed to create project at ${cwd}: ${created.error}` };
        projectId = created.project.id;
      }

      const createResult = await input.manager.createCliSession(
        projectId,
        found.ccSessionId,
        cwd,
      );
      if ("error" in createResult) return { error: createResult.error };

      // Spawn `claude --resume <id>` and await the result. We have to do
      // this here (rather than fire-and-forget) so a sync spawn failure
      // (missing binary / EACCES / bad cwd) can be surfaced through the
      // returned error instead of leaving an orphaned sidebar row pointing
      // at a session that never came up. cli:event lifecycle wiring still
      // takes care of subsequent failures (post-spawn exit, etc.) via the
      // CliChatPanel's status states.
      const cliResult = await window.claude.cli.resume({
        sessionId: found.ccSessionId,
        cwd,
      });
      if (!cliResult.ok) {
        // Only roll back when *we* freshly created this row. If the user
        // had already opened this CLI session before (createCliSession
        // returned created=false), the existing row is legitimate saved
        // state and shouldn't be deleted just because today's resume
        // attempt failed.
        if (createResult.created) {
          await input.manager.deleteSession(found.ccSessionId).catch(() => {
            /* swallow — the row would just be inconsistent for one tick */
          });
        }
        return { error: cliResult.error };
      }

      return { ok: true, projectId, sessionId: found.ccSessionId };
    },
    [input.activeSpaceId, input.manager, input.projectManager],
  );

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
    input.settings.setPlanMode(false);
    input.manager.switchSession(sessionId);
    setTimeout(() => setScrollToMessageId(messageId), 200);
  }, [input.manager, input.settings]);

  useEffect(() => {
    const agentId = input.manager.activeSession?.agentId;
    if (!agentId || input.manager.activeSession?.engine !== "acp") return;
    if (!input.manager.acpConfigOptions?.length) return;

    window.claude.agents.updateCachedConfig(agentId, input.manager.acpConfigOptions)
      .then(() => input.refreshAgents());
  }, [input.manager.acpConfigOptions, input.manager.activeSession, input.refreshAgents]);

  return {
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
    handleImportSessionById,
    handleResumeCliSessionById,
    handleImportCCSession,
    handleSeedDevExampleSpaceData,
    handleNavigateToMessage,
  };
}
