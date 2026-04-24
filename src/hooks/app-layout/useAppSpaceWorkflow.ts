import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectManager } from "@/hooks/useProjectManager";
import { useSessionManager } from "@/hooks/useSessionManager";
import {
  getStoredProjectGitCwd,
  resolveProjectForSpace,
  resolveRememberedSessionForSpace,
} from "@/lib/session/space-projects";
import { useSpaceManager } from "@/hooks/useSpaceManager";
import { useSplitView } from "@/hooks/useSplitView";
import { SPACE_COLOR_PRESETS } from "@/hooks/useSpaceManager";

const LAST_SESSION_KEY = "harnss-last-session-per-space";

type ProjectManagerState = ReturnType<typeof useProjectManager>;
type SpaceManagerState = ReturnType<typeof useSpaceManager>;
type SessionManagerState = ReturnType<typeof useSessionManager>;
type SplitViewState = ReturnType<typeof useSplitView>;
interface UseAppSpaceWorkflowInput {
  projectManager: ProjectManagerState;
  spaceManager: SpaceManagerState;
  manager: SessionManagerState;
  splitView: SplitViewState;
  handleNewChat: (projectId: string) => Promise<void>;
}

export function useAppSpaceWorkflow(input: UseAppSpaceWorkflowInput) {
  const [isSpaceSwitching, setIsSpaceSwitching] = useState(false);
  const [draftSpaceId, setDraftSpaceId] = useState<string | null>(null);
  const draftSpaceIdRef = useRef<string | null>(null);
  const preDraftSpaceRef = useRef<string | null>(null);
  const preDraftSessionRef = useRef<string | null>(null);
  const prevSpaceIdRef = useRef(input.spaceManager.activeSpaceId);
  const spaceSwitchRequestIdRef = useRef(0);

  useEffect(() => {
    draftSpaceIdRef.current = draftSpaceId;
  }, [draftSpaceId]);

  const activeProjectId = input.manager.activeSession?.projectId ?? input.manager.draftProjectId ?? null;

  const readLastSessionMap = useCallback((): Record<string, string> => {
    try {
      const raw = localStorage.getItem(LAST_SESSION_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  const activeSpaceProject = useMemo(
    () => resolveProjectForSpace({
      spaceId: input.spaceManager.activeSpaceId,
      activeProjectId,
      lastSessionBySpace: readLastSessionMap(),
      projects: input.projectManager.projects,
      sessions: input.manager.sessions,
    }),
    [activeProjectId, input.manager.sessions, input.projectManager.projects, input.spaceManager.activeSpaceId, readLastSessionMap],
  );

  const activeProject = input.projectManager.projects.find((project) => project.id === activeProjectId) ?? null;
  const activeProjectPath = activeProject?.path;
  const activeSessionTerminalCwd = activeSpaceProject
    ? (getStoredProjectGitCwd(activeSpaceProject.id) ?? activeSpaceProject.path)
    : null;
  const hasProjects = input.projectManager.projects.length > 0;

  const handleStartCreateSpace = useCallback(async () => {
    const randomColor = SPACE_COLOR_PRESETS[1 + Math.floor(Math.random() * (SPACE_COLOR_PRESETS.length - 1))];
    preDraftSpaceRef.current = input.spaceManager.activeSpaceId;
    preDraftSessionRef.current = input.manager.activeSessionId;
    const space = await input.spaceManager.createSpace("", "⭐", "emoji", randomColor);
    input.spaceManager.setActiveSpaceId(space.id);
    setDraftSpaceId(space.id);
  }, [input.manager.activeSessionId, input.spaceManager]);

  const handleConfirmCreateSpace = useCallback(() => {
    const draft = draftSpaceId ? input.spaceManager.spaces.find((space) => space.id === draftSpaceId) : null;
    if (!draft || !draft.name.trim()) return;
    setDraftSpaceId(null);
    preDraftSpaceRef.current = null;
    preDraftSessionRef.current = null;
  }, [draftSpaceId, input.spaceManager.spaces]);

  const handleCancelCreateSpace = useCallback(async () => {
    const currentDraftSpaceId = draftSpaceId;
    setDraftSpaceId(null);
    if (currentDraftSpaceId) {
      await input.spaceManager.deleteSpace(currentDraftSpaceId);
    }
    const prevSpace = preDraftSpaceRef.current;
    if (prevSpace) {
      input.spaceManager.setActiveSpaceId(prevSpace);
    }
    const prevSession = preDraftSessionRef.current;
    if (prevSession) {
      setTimeout(() => input.manager.switchSession(prevSession), 60);
    }
    preDraftSpaceRef.current = null;
    preDraftSessionRef.current = null;
  }, [draftSpaceId, input.manager, input.spaceManager]);

  const handleUpdateSpace = useCallback((id: string, updates: object) => {
    void input.spaceManager.updateSpace(id, updates);
  }, [input.spaceManager]);

  const handleDeleteSpace = useCallback(async (id: string) => {
    const deletedId = await input.spaceManager.deleteSpace(id);
    if (!deletedId) return;
    // Terminals are session-scoped now; deleting a space no longer implies
    // killing any pty. Projects that belonged to this space move to "default"
    // and keep their sessions (and the sessions' terminals).
    for (const project of input.projectManager.projects) {
      if (project.spaceId === deletedId) {
        await input.projectManager.updateProjectSpace(project.id, "default");
      }
    }
  }, [input.projectManager, input.spaceManager]);

  const handleMoveProjectToSpace = useCallback(async (projectId: string, spaceId: string) => {
    await input.projectManager.updateProjectSpace(projectId, spaceId);
  }, [input.projectManager]);

  useEffect(() => {
    if (!input.manager.activeSessionId || input.manager.isDraft) return;
    const active = input.manager.sessions.find((session) => session.id === input.manager.activeSessionId);
    if (!active) return;
    const project = input.projectManager.projects.find((entry) => entry.id === active.projectId);
    if (!project) return;
    const sessionSpaceId = project.spaceId || "default";
    const map = readLastSessionMap();
    map[sessionSpaceId] = input.manager.activeSessionId;
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(map));
  }, [input.manager.activeSessionId, input.manager.isDraft, input.manager.sessions, input.projectManager.projects, readLastSessionMap]);

  useEffect(() => {
    if (!draftSpaceId || input.spaceManager.activeSpaceId === draftSpaceId) return;
    void input.spaceManager.deleteSpace(draftSpaceId);
    const prevSession = preDraftSessionRef.current;
    if (prevSession) {
      setTimeout(() => input.manager.switchSession(prevSession), 60);
    }
    setDraftSpaceId(null);
    preDraftSpaceRef.current = null;
    preDraftSessionRef.current = null;
  }, [draftSpaceId, input.manager, input.spaceManager]);

  useEffect(() => {
    const prev = prevSpaceIdRef.current;
    const next = input.spaceManager.activeSpaceId;
    prevSpaceIdRef.current = next;
    if (prev === next) return;
    if (next === draftSpaceIdRef.current) return;

    const requestId = spaceSwitchRequestIdRef.current + 1;
    spaceSwitchRequestIdRef.current = requestId;
    const finishSpaceSwitch = () => {
      if (spaceSwitchRequestIdRef.current === requestId) {
        setIsSpaceSwitching(false);
      }
    };

    const currentSessionProject = input.manager.activeSession
      ? input.projectManager.projects.find((project) => project.id === input.manager.activeSession?.projectId) ?? null
      : null;
    const currentSessionSpaceId = currentSessionProject?.spaceId || "default";
    const isCurrentSessionAlreadyInNextSpace = !!input.manager.activeSession && currentSessionSpaceId === next;
    const lastSessionMap = readLastSessionMap();
    const rememberedSession = resolveRememberedSessionForSpace({
      spaceId: next,
      lastSessionBySpace: lastSessionMap,
      projects: input.projectManager.projects,
      sessions: input.manager.sessions,
    });

    if (!isCurrentSessionAlreadyInNextSpace) {
      input.splitView.dismissSplitView();
    }

    if (isCurrentSessionAlreadyInNextSpace) {
      setIsSpaceSwitching(false);
      finishSpaceSwitch();
      return;
    }

    if (rememberedSession) {
      setIsSpaceSwitching(true);
      void Promise.resolve(input.manager.deselectSession())
        .then(() => input.manager.switchSession(rememberedSession.id))
        .finally(finishSpaceSwitch);
      return;
    }

    setIsSpaceSwitching(false);
    void Promise.resolve(input.manager.deselectSession()).finally(finishSpaceSwitch);
  }, [input.manager, input.projectManager.projects, input.spaceManager.activeSpaceId, input.splitView, readLastSessionMap]);

  useEffect(() => {
    if (!activeProjectPath) {
      input.manager.setCurrentBranch(undefined);
      return;
    }
    let cancelled = false;
    window.claude.git.status(activeProjectPath).then((result) => {
      if (!cancelled && !("error" in result)) {
        input.manager.setCurrentBranch(result.branch);
      }
    }).catch(() => {
      if (!cancelled) input.manager.setCurrentBranch(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProjectPath, input.manager]);

  return {
    activeProjectId,
    activeProject,
    activeProjectPath,
    activeSpaceProject,
    activeSessionTerminalCwd,
    hasProjects,
    isSpaceSwitching,
    draftSpaceId,
    handleStartCreateSpace,
    handleConfirmCreateSpace,
    handleCancelCreateSpace,
    handleUpdateSpace,
    handleDeleteSpace,
    handleMoveProjectToSpace,
  };
}
