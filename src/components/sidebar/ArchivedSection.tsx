import { useState } from "react";
import { Archive, ChevronDown, ChevronRight } from "lucide-react";
import type { ChatSession, Project } from "@/types";
import { SessionItem } from "./SessionItem";
import { useSidebarActions } from "./SidebarActionsContext";

interface ArchivedSectionProps {
  projects: Project[];
  /** Archived sessions grouped by projectId. */
  archivedByProject: Map<string, ChatSession[]>;
  totalCount: number;
  activeSessionId: string | null;
  islandLayout: boolean;
}

/**
 * Collapsible "Archived" section rendered at the bottom of the sidebar's
 * project list. Lists archived chats grouped by their owning project so users
 * can still find them by context; each row carries the full SessionItem menu
 * so unarchive / delete / rename work the same as for active sessions.
 */
export function ArchivedSection({
  projects,
  archivedByProject,
  totalCount,
  activeSessionId,
  islandLayout,
}: ArchivedSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const {
    selectSession,
    deleteSession,
    archiveSession,
    unarchiveSession,
    renameSession,
  } = useSidebarActions();

  if (totalCount === 0) return null;

  const projectsWithArchives = projects.filter((p) =>
    (archivedByProject.get(p.id) ?? []).length > 0,
  );

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/40 transition-colors hover:text-sidebar-foreground/70"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Archive className="h-3 w-3" />
        <span>Archived</span>
        <span className="ms-auto rounded bg-sidebar-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-normal tabular-nums text-sidebar-foreground/60">
          {totalCount}
        </span>
      </button>

      {expanded && (
        <div className="mt-1">
          {projectsWithArchives.map((project) => {
            const archived = archivedByProject.get(project.id) ?? [];
            return (
              <div key={project.id} className="mb-2">
                <p className="px-2 py-1 text-[10px] text-sidebar-foreground/35">
                  {project.name}
                </p>
                {archived.map((session) => (
                  <SessionItem
                    key={session.id}
                    islandLayout={islandLayout}
                    session={session}
                    isActive={session.id === activeSessionId}
                    onSelect={() => selectSession(session.id)}
                    onDelete={() => deleteSession(session.id)}
                    onArchive={() => archiveSession(session.id)}
                    onUnarchive={() => unarchiveSession(session.id)}
                    onRename={(title) => renameSession(session.id, title)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
