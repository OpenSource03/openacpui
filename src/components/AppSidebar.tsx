import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { Bug, PanelLeft, Plus, Paintbrush } from "lucide-react";
import { isMac } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ChatFolder, ChatSession, Project, Space, SpaceColor } from "@/types";
import { APP_SIDEBAR_WIDTH } from "@/lib/layout/constants";
import { SidebarSearch } from "./SidebarSearch";
import { SpaceBar, SpaceIcon } from "./SpaceBar";
import { SpaceCustomizer } from "./SpaceCustomizer";
import { UpdateBanner } from "./UpdateBanner";
import { ProjectSection } from "./sidebar/ProjectSection";
import { SidebarActionsProvider } from "./sidebar/SidebarActionsContext";
import { useAgentContext } from "./AgentContext";

interface AppSidebarState {
  isOpen: boolean;
  islandLayout: boolean;
  projects: Project[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  jiraBoardProjectId: string | null;
  jiraBoardEnabled: boolean;
  foldersByProject: Record<string, ChatFolder[]>;
  organizeByChatBranch: boolean;
  draftSpaceId: string | null;
}

interface AppSidebarProjectActions {
  onNewChat: (projectId: string) => void;
  onToggleProjectJiraBoard: (projectId: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onUpdateProjectIcon: (id: string, icon: string | null, iconType: "emoji" | "lucide" | null) => void;
  onImportCCSession: (projectId: string, ccSessionId: string) => void;
  onToggleSidebar: () => void;
  onNavigateToMessage: (sessionId: string, messageId: string) => void;
  onMoveProjectToSpace: (projectId: string, spaceId: string) => void;
  onReorderProject: (projectId: string, targetProjectId: string) => void;
  onCreateFolder: (projectId: string) => void;
  onSetOrganizeByChatBranch: (on: boolean) => void;
}

interface AppSidebarSpaceState {
  spaces: Space[];
  activeSpaceId: string;
}

interface AppSidebarSpaceActions {
  onSelectSpace: (id: string) => void;
  onStartCreateSpace: () => void;
  onUpdateSpace: (id: string, updates: Partial<Pick<Space, "name" | "icon" | "iconType" | "color">>) => void;
  onDeleteSpace: (id: string) => void;
  onOpenSettings: () => void;
  onConfirmCreateSpace: () => void;
  onCancelCreateSpace: () => void;
}

interface AppSidebarSessionActions {
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onPinSession: (sessionId: string, pinned: boolean) => void;
  onMoveSessionToFolder: (sessionId: string, folderId: string | null) => void;
  onRenameFolder: (projectId: string, folderId: string, name: string) => void;
  onDeleteFolder: (projectId: string, folderId: string) => void;
  onPinFolder: (projectId: string, folderId: string, pinned: boolean) => void;
  onOpenInSplitView?: (sessionId: string) => void;
  canOpenSessionInSplitView?: (sessionId: string) => boolean;
}

interface AppSidebarProps {
  state: AppSidebarState;
  projectActions: AppSidebarProjectActions;
  spaceState: AppSidebarSpaceState;
  spaceActions: AppSidebarSpaceActions;
  sessionActions: AppSidebarSessionActions;
}

export const AppSidebar = memo(function AppSidebar({
  state,
  projectActions,
  spaceState,
  spaceActions,
  sessionActions,
}: AppSidebarProps) {
  const {
    isOpen,
    islandLayout,
    projects,
    sessions,
    activeSessionId,
    jiraBoardProjectId,
    jiraBoardEnabled,
    foldersByProject,
    organizeByChatBranch,
    draftSpaceId,
  } = state;
  const {
    onNewChat,
    onToggleProjectJiraBoard,
    onCreateProject,
    onDeleteProject,
    onRenameProject,
    onUpdateProjectIcon,
    onImportCCSession,
    onToggleSidebar,
    onNavigateToMessage,
    onMoveProjectToSpace,
    onReorderProject,
    onCreateFolder,
    onSetOrganizeByChatBranch,
  } = projectActions;
  const { spaces, activeSpaceId } = spaceState;
  const {
    onSelectSpace,
    onStartCreateSpace,
    onUpdateSpace,
    onDeleteSpace,
    onOpenSettings,
    onConfirmCreateSpace,
    onCancelCreateSpace,
  } = spaceActions;
  const {
    onSelectSession,
    onDeleteSession,
    onRenameSession,
    onPinSession,
    onMoveSessionToFolder,
    onRenameFolder,
    onDeleteFolder,
    onPinFolder,
    onOpenInSplitView,
    canOpenSessionInSplitView,
  } = sessionActions;
  const { agents } = useAgentContext();
  const isCreating = draftSpaceId !== null;
  // The draft is a real space — find it in the spaces array
  const draftSpace = isCreating ? spaces.find((s) => s.id === draftSpaceId) ?? null : null;

  // Slide animation when entering/leaving draft creation mode
  const prevIsCreatingRef = useRef(isCreating);
  const [draftSlideClass, setDraftSlideClass] = useState("");

  useEffect(() => {
    if (prevIsCreatingRef.current === isCreating) return;
    prevIsCreatingRef.current = isCreating;

    // Entering creation → slide from right, exiting → slide from left
    setDraftSlideClass(isCreating ? "space-slide-from-right" : "space-slide-from-left");
    const timer = setTimeout(() => setDraftSlideClass(""), 250);
    return () => clearTimeout(timer);
  }, [isCreating]);

  // Load default chat limit from main-process settings (initial fetch + event-driven updates)
  const [defaultChatLimit, setDefaultChatLimit] = useState(10);
  useEffect(() => {
    window.claude.settings.get().then((s) => {
      if (s?.defaultChatLimit && s.defaultChatLimit > 0) {
        setDefaultChatLimit(s.defaultChatLimit);
      }
    });

    const unsubscribe = window.claude.settings.onChanged((settings) => {
      if (settings.defaultChatLimit > 0) {
        setDefaultChatLimit(settings.defaultChatLimit);
      }
    });
    return unsubscribe;
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

  // Pre-group sessions by projectId (O(n) once) instead of filtering per project (O(n*m))
  const sessionsByProject = useMemo(() => {
    const map = new Map<string, ChatSession[]>();
    for (const s of sessions) {
      const arr = map.get(s.projectId) ?? [];
      arr.push(s);
      map.set(s.projectId, arr);
    }
    return map;
  }, [sessions]);

  // Other spaces for "Move to space" menu
  const otherSpaces = useMemo(() => spaces.filter((s) => s.id !== activeSpaceId), [spaces, activeSpaceId]);

  // Stabilize context value — all callbacks come from useCallback in the orchestrator
  const sidebarActions = useMemo(
    () => ({
      selectSession: onSelectSession,
      deleteSession: onDeleteSession,
      renameSession: onRenameSession,
      pinSession: onPinSession,
      moveSessionToFolder: onMoveSessionToFolder,
      pinFolder: onPinFolder,
      renameFolder: onRenameFolder,
      deleteFolder: onDeleteFolder,
      openInSplitView: onOpenInSplitView,
      canOpenSessionInSplitView,
    }),
    [
      onSelectSession,
      onDeleteSession,
      onRenameSession,
      onPinSession,
      onMoveSessionToFolder,
      onPinFolder,
      onRenameFolder,
      onDeleteFolder,
      onOpenInSplitView,
      canOpenSessionInSplitView,
    ],
  );

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

  // Scroll fade
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

    const ro = new ResizeObserver(updateFade);
    ro.observe(viewport);
    if (viewport.firstElementChild) ro.observe(viewport.firstElementChild);

    return () => {
      viewport.removeEventListener("scroll", updateFade);
      ro.disconnect();
    };
  }, [updateFade]);

  useEffect(() => {
    updateFade();
  }, [filteredProjects, activeSpaceId, updateFade]);

  const maskTop = fadeTop ? "transparent 0%, black 32px" : "black 0%";
  const maskBottom = fadeBottom
    ? "black calc(100% - 48px), rgba(0,0,0,0.35) calc(100% - 26px), rgba(0,0,0,0.07) calc(100% - 10px), transparent 100%"
    : "black 100%";
  const maskValue = `linear-gradient(to bottom, ${maskTop}, ${maskBottom})`;

  const handleDraftIconUpdate = useCallback(
    (icon: string, iconType: "emoji" | "lucide") => {
      if (draftSpaceId) onUpdateSpace(draftSpaceId, { icon, iconType });
    },
    [draftSpaceId, onUpdateSpace],
  );

  const handleDraftColorUpdate = useCallback(
    (color: SpaceColor) => {
      if (draftSpaceId) onUpdateSpace(draftSpaceId, { color });
    },
    [draftSpaceId, onUpdateSpace],
  );

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

        {!isCreating && (
          <button
            onClick={onCreateProject}
            className="no-drag flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-sidebar-foreground/70 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span>Add project</span>
          </button>
        )}
      </div>

      {isCreating && draftSpace ? (
        /* ── Draft space creation UI (replaces project list) ── */
        <div className={`flex min-h-0 flex-1 flex-col ${draftSlideClass}`}>
          <div className="flex flex-1 flex-col items-center px-5 pt-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sidebar-accent/50">
              <SpaceIcon space={draftSpace} size={36} />
            </div>

            <h2 className="mt-4 text-base font-semibold text-sidebar-foreground">
              Create a Space
            </h2>
            <p className="mt-1 text-center text-xs text-sidebar-foreground/50 leading-relaxed">
              Separate your projects for work, life, and more.
            </p>

            {/* Name input */}
            <div className="mt-5 w-full">
              <div className="relative">
                <Plus className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/30" />
                <Input
                  value={draftSpace.name}
                  onChange={(e) => {
                    if (draftSpaceId) onUpdateSpace(draftSpaceId, { name: e.target.value });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draftSpace.name.trim()) onConfirmCreateSpace();
                    if (e.key === "Escape") onCancelCreateSpace();
                  }}
                  placeholder="Space name..."
                  className="h-9 ps-8 text-sm bg-sidebar-accent/40 border-sidebar-border"
                  autoFocus
                />
              </div>
            </div>

            {/* Choose a Theme button — opens SpaceCustomizer in a popover */}
            <Popover>
              <PopoverTrigger asChild>
                <button className="mt-3 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-start text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60">
                  <Paintbrush className="h-4 w-4 text-sidebar-foreground/40" />
                  Choose a Theme
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                sideOffset={12}
                align="start"
                className="w-72"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <SpaceCustomizer
                  icon={draftSpace.icon}
                  iconType={draftSpace.iconType}
                  color={draftSpace.color}
                  onUpdateIcon={handleDraftIconUpdate}
                  onUpdateColor={handleDraftColorUpdate}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Create / Cancel at bottom */}
          <div className="shrink-0 px-4 pb-3 pt-2 space-y-1.5">
            <Button
              className="w-full"
              size="sm"
              onClick={onConfirmCreateSpace}
              disabled={!draftSpace.name.trim()}
            >
              Create Space
            </Button>
            <button
              onClick={onCancelCreateSpace}
              className="w-full py-1.5 text-center text-sm text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* ── Normal sidebar content ── */
        <SidebarActionsProvider value={sidebarActions}>
        <div className={`flex min-h-0 flex-1 flex-col ${draftSlideClass}`}>
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
                  const projectSessions = sessionsByProject.get(project.id) ?? [];
                  const projectFolders = foldersByProject[project.id] ?? [];

                  return (
                    <ProjectSection
                      key={project.id}
                      islandLayout={islandLayout}
                      project={project}
                      sessions={projectSessions}
                      folders={projectFolders}
                      activeSessionId={activeSessionId}
                      jiraBoardEnabled={jiraBoardEnabled}
                      isJiraBoardOpen={jiraBoardProjectId === project.id}
                      organizeByChatBranch={organizeByChatBranch}
                      onNewChat={() => onNewChat(project.id)}
                      onToggleJiraBoard={() => onToggleProjectJiraBoard(project.id)}
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
                      onCreateFolder={() => onCreateFolder(project.id)}
                      onSetOrganizeByChatBranch={onSetOrganizeByChatBranch}
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
        </div>
        </SidebarActionsProvider>
      )}

      <SpaceBar
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        onSelectSpace={onSelectSpace}
        onStartCreateSpace={onStartCreateSpace}
        onUpdateSpace={onUpdateSpace}
        onDeleteSpace={onDeleteSpace}
        onDropProject={onMoveProjectToSpace}
        onOpenSettings={onOpenSettings}
        draftSpace={draftSpace}
      />
    </div>
  );
});
