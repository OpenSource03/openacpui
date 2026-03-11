import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { Bug, PanelLeft, Plus } from "lucide-react";
import { isMac } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatSession, InstalledAgent, Project, Space } from "@/types";
import { APP_SIDEBAR_WIDTH } from "@/lib/layout-constants";
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
  jiraBoardProjectId: string | null;
  jiraBoardEnabled: boolean;
  onNewChat: (projectId: string) => void;
  onToggleProjectJiraBoard: (projectId: string) => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onUpdateProjectIcon: (id: string, icon: string | null, iconType: "emoji" | "lucide" | null) => void;
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
  agents?: InstalledAgent[];
}

export const AppSidebar = memo(function AppSidebar({
  isOpen,
  islandLayout,
  projects,
  sessions,
  activeSessionId,
  jiraBoardProjectId,
  jiraBoardEnabled,
  onNewChat,
  onToggleProjectJiraBoard,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onCreateProject,
  onDeleteProject,
  onRenameProject,
  onUpdateProjectIcon,
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
  agents,
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

    // ResizeObserver catches initial content render + any size changes
    const ro = new ResizeObserver(updateFade);
    ro.observe(viewport);
    if (viewport.firstElementChild) ro.observe(viewport.firstElementChild);

    return () => {
      viewport.removeEventListener("scroll", updateFade);
      ro.disconnect();
    };
  }, [updateFade]);

  // Recheck fade when projects/space change (content size changes)
  useEffect(() => {
    updateFade();
  }, [filteredProjects, activeSpaceId, updateFade]);

  const maskTop = fadeTop ? "transparent 0%, black 32px" : "black 0%";
  const maskBottom = fadeBottom
    ? "black calc(100% - 48px), rgba(0,0,0,0.35) calc(100% - 26px), rgba(0,0,0,0.07) calc(100% - 10px), transparent 100%"
    : "black 100%";
  const maskValue = `linear-gradient(to bottom, ${maskTop}, ${maskBottom})`;

  return (
    <div
      className={`flex shrink-0 flex-col overflow-hidden bg-sidebar transition-[width] duration-200 ${
        isOpen ? (islandLayout ? "ps-[var(--island-gap)]" : "ps-2") : ""
      }`}
      style={{ width: isOpen ? APP_SIDEBAR_WIDTH : 0 }}
    >
      <div
        className={`drag-region flex h-[52px] items-center gap-2 pe-3 ${isMac ? "ps-[84px]" : "ps-2"}`}
      >
        <Button
          variant="ghost"
          size="icon"
          className="no-drag h-8 w-8 rounded-full text-sidebar-foreground/70 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
          onClick={onToggleSidebar}
        >
          <PanelLeft className="h-4.5 w-4.5" />
        </Button>

        <div className="flex-1" />

        <button
          onClick={onCreateProject}
          className="no-drag flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-sidebar-foreground/70 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
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
          <div className={`px-3 pt-2 pb-8 ${slideClass}`}>
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
                  jiraBoardEnabled={jiraBoardEnabled}
                  isJiraBoardOpen={jiraBoardProjectId === project.id}
                  onNewChat={() => onNewChat(project.id)}
                  onToggleJiraBoard={() => onToggleProjectJiraBoard(project.id)}
                  onSelectSession={onSelectSession}
                  onDeleteSession={onDeleteSession}
                  onRenameSession={onRenameSession}
                  onDeleteProject={() => onDeleteProject(project.id)}
                  onRenameProject={(name) => onRenameProject(project.id, name)}
                  onUpdateIcon={(icon, iconType) =>
                    onUpdateProjectIcon(project.id, icon, iconType)
                  }
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
                  agents={agents}
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

      <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] text-sidebar-foreground/40">
        <span>Harnss is in early beta</span>
        <span className="text-sidebar-foreground/20">·</span>
        <a
          href="https://github.com/OpenSource03/harnss/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground/80"
        >
          <Bug className="h-3 w-3" />
          <span>Report a bug</span>
        </a>
      </div>

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
