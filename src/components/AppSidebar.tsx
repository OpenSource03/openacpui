import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { PanelLeft, Plus } from "lucide-react";
import { isMac } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatSession, Project, Space } from "@/types";
import { SidebarSearch } from "./SidebarSearch";
import { SpaceBar } from "./SpaceBar";
import { UpdateBanner } from "./UpdateBanner";
import { ProjectSection } from "./sidebar/ProjectSection";

interface AppSidebarProps {
  isOpen: boolean;
  islandLayout: boolean;
  projects: Project[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  onNewChat: (projectId: string) => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onImportCCSession: (projectId: string, ccSessionId: string) => void;
  onToggleSidebar: () => void;
  onNavigateToMessage: (sessionId: string, messageId: string) => void;
  onMoveProjectToSpace: (projectId: string, spaceId: string) => void;
  onReorderProject: (projectId: string, targetProjectId: string) => void;
  spaces: Space[];
  activeSpaceId: string;
  onSelectSpace: (id: string) => void;
  onCreateSpace: () => void;
  onEditSpace: (space: Space) => void;
  onDeleteSpace: (id: string) => void;
  onOpenSettings: () => void;
}

export const AppSidebar = memo(function AppSidebar({
  isOpen,
  islandLayout,
  projects,
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onCreateProject,
  onDeleteProject,
  onRenameProject,
  onImportCCSession,
  onToggleSidebar,
  onNavigateToMessage,
  onMoveProjectToSpace,
  onReorderProject,
  spaces,
  activeSpaceId,
  onSelectSpace,
  onCreateSpace,
  onEditSpace,
  onDeleteSpace,
  onOpenSettings,
}: AppSidebarProps) {
  // Load default chat limit from main-process settings
  const [defaultChatLimit, setDefaultChatLimit] = useState(10);
  useEffect(() => {
    window.claude.settings.get().then((s: { defaultChatLimit?: number } | null) => {
      if (s?.defaultChatLimit && s.defaultChatLimit > 0) {
        setDefaultChatLimit(s.defaultChatLimit);
      }
    });
  }, []);

  // Listen for settings changes so the limit updates without restart
  useEffect(() => {
    const interval = setInterval(() => {
      window.claude.settings.get().then((s: { defaultChatLimit?: number } | null) => {
        if (s?.defaultChatLimit && s.defaultChatLimit > 0) {
          setDefaultChatLimit((prev) => s.defaultChatLimit !== prev ? s.defaultChatLimit! : prev);
        }
      });
    }, 5000); // Poll every 5s — lightweight since it's a small JSON read
    return () => clearInterval(interval);
  }, []);

  // Filter projects by active space
  const filteredProjects = useMemo(
    () =>
      projects.filter((p) => {
        const pSpace = p.spaceId || "default";
        return pSpace === activeSpaceId;
      }),
    [projects, activeSpaceId],
  );

  const projectIds = useMemo(() => filteredProjects.map((p) => p.id), [filteredProjects]);

  // Other spaces for "Move to space" menu
  const otherSpaces = useMemo(() => spaces.filter((s) => s.id !== activeSpaceId), [spaces, activeSpaceId]);

  // Slide direction on space switch
  const prevSpaceIdRef = useRef(activeSpaceId);
  const [slideClass, setSlideClass] = useState("");

  useEffect(() => {
    const prev = prevSpaceIdRef.current;
    if (prev === activeSpaceId) return;

    const prevOrder = spaces.find((s) => s.id === prev)?.order ?? 0;
    const nextOrder = spaces.find((s) => s.id === activeSpaceId)?.order ?? 0;
    const dir = nextOrder >= prevOrder ? "space-slide-from-right" : "space-slide-from-left";

    setSlideClass(dir);
    prevSpaceIdRef.current = activeSpaceId;

    const timer = setTimeout(() => setSlideClass(""), 250);
    return () => clearTimeout(timer);
  }, [activeSpaceId, spaces]);

  // Scroll fade: hide top/bottom fade when at the edge
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);

  const updateFade = useCallback(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    setFadeTop(scrollTop > 4);
    setFadeBottom(scrollHeight - scrollTop - clientHeight > 4);
  }, []);

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;
    viewport.addEventListener("scroll", updateFade, { passive: true });
    // Check initial state
    updateFade();
    return () => viewport.removeEventListener("scroll", updateFade);
  }, [updateFade]);

  // Recheck fade when projects/space change (content size changes)
  useEffect(() => {
    updateFade();
  }, [filteredProjects, activeSpaceId, updateFade]);

  const maskTop = fadeTop ? "transparent 0%, black 32px" : "black 0%";
  const maskBottom = fadeBottom ? "black calc(100% - 32px), transparent 100%" : "black 100%";
  const maskValue = `linear-gradient(to bottom, ${maskTop}, ${maskBottom})`;

  return (
    <div
      className={`flex shrink-0 flex-col overflow-hidden bg-sidebar transition-[width] duration-200 ${
        isOpen ? "w-[260px] ps-2" : "w-0"
      }`}
    >
      <div
        className={`drag-region flex h-[46px] items-center gap-1 pe-2 ${isMac ? "ps-[84px]" : "ps-0"}`}
      >
        <Button
          variant="ghost"
          size="icon"
          className="no-drag h-7 w-7 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={onToggleSidebar}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>

        <div className="flex-1" />

        <button
          onClick={onCreateProject}
          className="no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" />
          <span>Add project</span>
        </button>
      </div>

      <SidebarSearch
        projectIds={projectIds}
        onNavigateToMessage={onNavigateToMessage}
        onSelectSession={onSelectSession}
      />

      <div
        className="min-h-0 flex-1"
        style={{ maskImage: maskValue, WebkitMaskImage: maskValue }}
      >
        <ScrollArea ref={scrollRef} className="h-full">
          <div className={`px-2 pt-2 pb-8 ${slideClass}`}>
            {filteredProjects.map((project) => {
              const projectSessions = sessions.filter(
                (s) => s.projectId === project.id,
              );

              return (
                <ProjectSection
                  key={project.id}
                  islandLayout={islandLayout}
                  project={project}
                  sessions={projectSessions}
                  activeSessionId={activeSessionId}
                  onNewChat={() => onNewChat(project.id)}
                  onSelectSession={onSelectSession}
                  onDeleteSession={onDeleteSession}
                  onRenameSession={onRenameSession}
                  onDeleteProject={() => onDeleteProject(project.id)}
                  onRenameProject={(name) => onRenameProject(project.id, name)}
                  onImportCCSession={(ccSessionId) =>
                    onImportCCSession(project.id, ccSessionId)
                  }
                  otherSpaces={otherSpaces}
                  onMoveToSpace={(spaceId) =>
                    onMoveProjectToSpace(project.id, spaceId)
                  }
                  onReorderProject={(targetId) =>
                    onReorderProject(project.id, targetId)
                  }
                  defaultChatLimit={defaultChatLimit}
                />
              );
            })}

            {filteredProjects.length === 0 && (
              <p className="px-2 py-8 text-center text-xs text-sidebar-foreground/50">
                {projects.length === 0
                  ? "Add a project to get started"
                  : "No projects in this space"}
              </p>
            )}
          </div>
        </ScrollArea>
      </div>

      <UpdateBanner />

      <SpaceBar
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        onSelectSpace={onSelectSpace}
        onCreateSpace={onCreateSpace}
        onEditSpace={onEditSpace}
        onDeleteSpace={onDeleteSpace}
        onDropProject={onMoveProjectToSpace}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
});
