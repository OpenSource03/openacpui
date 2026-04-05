import type { ChatSession, Project } from "@/types";

interface ResolveProjectForSpaceOptions {
  spaceId: string;
  activeProjectId: string | null;
  lastSessionBySpace: Record<string, string>;
  projects: Project[];
  sessions: Pick<ChatSession, "id" | "projectId">[];
}

interface ResolveRememberedSessionForSpaceOptions {
  spaceId: string;
  lastSessionBySpace: Record<string, string>;
  projects: Project[];
  sessions: Pick<ChatSession, "id" | "projectId">[];
}

export function resolveRememberedSessionForSpace({
  spaceId,
  lastSessionBySpace,
  projects,
  sessions,
}: ResolveRememberedSessionForSpaceOptions): Pick<ChatSession, "id" | "projectId"> | null {
  const rememberedSessionId = lastSessionBySpace[spaceId];
  if (!rememberedSessionId) return null;

  const projectIdsInSpace = new Set(
    projects
      .filter((project) => (project.spaceId || "default") === spaceId)
      .map((project) => project.id),
  );
  if (projectIdsInSpace.size === 0) return null;

  const rememberedSession = sessions.find((session) => session.id === rememberedSessionId);
  if (!rememberedSession || !projectIdsInSpace.has(rememberedSession.projectId)) return null;

  return rememberedSession;
}

export function resolveProjectForSpace({
  spaceId,
  activeProjectId,
  lastSessionBySpace,
  projects,
  sessions,
}: ResolveProjectForSpaceOptions): Project | null {
  const projectsInSpace = projects.filter((project) => (project.spaceId || "default") === spaceId);
  if (projectsInSpace.length === 0) return null;

  const projectsById = new Map(projectsInSpace.map((project) => [project.id, project]));

  if (activeProjectId) {
    const activeProject = projectsById.get(activeProjectId);
    if (activeProject) return activeProject;
  }

  const rememberedSession = resolveRememberedSessionForSpace({
    spaceId,
    lastSessionBySpace,
    projects,
    sessions,
  });
  if (rememberedSession) {
    const rememberedProject = projectsById.get(rememberedSession.projectId);
    if (rememberedProject) return rememberedProject;
  }

  return projectsInSpace[0];
}

export function getStoredProjectGitCwd(projectId: string): string | null {
  const stored = localStorage.getItem(`harnss-${projectId}-git-cwd`);
  if (!stored) return null;

  const trimmed = stored.trim();
  return trimmed ? trimmed : null;
}
