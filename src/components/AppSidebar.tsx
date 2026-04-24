import { useState, useEffect, useMemo, useRef, useCallback, memo, type DragEvent } from "react";
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
import { PreReleaseBanner } from "./PreReleaseBanner";
import { ProjectSection } from "./sidebar/ProjectSection";
import { SidebarActionsProvider } from "./sidebar/SidebarActionsContext";
import { ArchivedSection } from "./sidebar/ArchivedSection";
import { useAgentContext } from "./AgentContext";
import { clearSidebarDragPayload, isSidebarDragKind } from "@/lib/sidebar/dnd";

type ProjectDropPlacement = "before" | "after";

interface ProjectDropTarget {
  placement: ProjectDropPlacement;
  targetProjectId: string;
}

const PROJECT_AUTO_SCROLL_EDGE_PX = 56;
const PROJECT_AUTO_SCROLL_MAX_STEP = 22;

function getScrollViewport(scrollRoot: HTMLDivElement | null): HTMLElement | null {
  return scrollRoot?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null;
}

function getProjectDropTarget(
  projectListRoot: HTMLDivElement | null,
  pointerY: number,
  draggedProjectId: string,
): ProjectDropTarget | null {
  if (!projectListRoot) return null;

  const anchors = Array.from(
    projectListRoot.querySelectorAll<HTMLElement>("[data-project-drop-anchor-id]"),
  );

  let fallback: ProjectDropTarget | null = null;
  for (const anchor of anchors) {
    const targetProjectId = anchor.dataset.projectDropAnchorId;
    if (!targetProjectId || targetProjectId === draggedProjectId) continue;

    const rect = anchor.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    if (pointerY < midpoint) {
      return { placement: "before", targetProjectId };
    }

    fallback = { placement: "after", targetProjectId };
  }

  return fallback;
}

function resolveProjectReorderTarget(
  orderedProjects: Project[],
  draggedProjectId: string,
  dropTarget: ProjectDropTarget,
): string | null {
  const fromIdx = orderedProjects.findIndex((project) => project.id === draggedProjectId);
  const targetIdx = orderedProjects.findIndex((project) => project.id === dropTarget.targetProjectId);
  if (fromIdx === -1 || targetIdx === -1) return null;

  if (dropTarget.placement === "before") {
    if (fromIdx > targetIdx) return dropTarget.targetProjectId;
    return orderedProjects[targetIdx - 1]?.id ?? null;
  }

  if (fromIdx < targetIdx) return dropTarget.targetProjectId;
  return orderedProjects[targetIdx + 1]?.id ?? null;
}

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
  onUpdateProjectIcon: (id: string, icon: string | null, iconType: "emoji" | "lucide" | "simple" | null) => void;
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
  onArchiveSession: (id: string) => void;
  onUnarchiveSession: (id: string) => void;
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
    onArchiveSession,
    onUnarchiveSession,
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

  // Pre-group sessions by projectId (O(n) once) instead of filtering per project (O(n*m)).
  // Archived sessions are excluded from the main per-project lists — they're surfaced
  // via a dedicated "Archived" section below so they don't clutter the active workflow.
  const sessionsByProject = useMemo(() => {
    const map = new Map<string, ChatSession[]>();
    for (const s of sessions) {
      if (s.archivedAt) continue;
      const arr = map.get(s.projectId) ?? [];
      arr.push(s);
      map.set(s.projectId, arr);
    }
    return map;
  }, [sessions]);

  /** Archived sessions grouped by project for the collapsible Archived section. */
  const archivedByProject = useMemo(() => {
    const map = new Map<string, ChatSession[]>();
    for (const s of sessions) {
      if (!s.archivedAt) continue;
      const arr = map.get(s.projectId) ?? [];
      arr.push(s);
      map.set(s.projectId, arr);
    }
    // Sort each project's archived list by archivedAt desc (most recent first)
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
    }
    return map;
  }, [sessions]);
  const totalArchivedCount = useMemo(() => {
    let n = 0;
    for (const arr of archivedByProject.values()) n += arr.length;
    return n;
  }, [archivedByProject]);

  // Other spaces for "Move to space" menu
  const otherSpaces = useMemo(() => spaces.filter((s) => s.id !== activeSpaceId), [spaces, activeSpaceId]);

  // Stabilize context value — all callbacks come from useCallback in the orchestrator
  const sidebarActions = useMemo(
    () => ({
      selectSession: onSelectSession,
      deleteSession: onDeleteSession,
      archiveSession: onArchiveSession,
      unarchiveSession: onUnarchiveSession,
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
      onArchiveSession,
      onUnarchiveSession,
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
  const projectListRef = useRef<HTMLDivElement>(null);
  const draggedProjectIdRef = useRef<string | null>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [projectDropTarget, setProjectDropTarget] = useState<ProjectDropTarget | null>(null);

  const updateFade = useCallback(() => {
    const viewport = getScrollViewport(scrollRef.current);
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    setFadeTop(scrollTop > 4);
    setFadeBottom(scrollHeight - scrollTop - clientHeight > 4);
  }, []);

  useEffect(() => {
    const viewport = getScrollViewport(scrollRef.current);
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
    (icon: string, iconType: "emoji" | "lucide" | "simple") => {
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

  const clearProjectDragState = useCallback(() => {
    draggedProjectIdRef.current = null;
    dragPointerYRef.current = null;
    setDraggedProjectId(null);
    setProjectDropTarget(null);

    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }, []);

  const updateProjectDropPreview = useCallback(
    (pointerY: number, draggedId: string) => {
      setProjectDropTarget(getProjectDropTarget(projectListRef.current, pointerY, draggedId));
    },
    [],
  );

  const tickProjectAutoScroll = useCallback(() => {
    autoScrollFrameRef.current = null;

    const pointerY = dragPointerYRef.current;
    const draggedId = draggedProjectIdRef.current;
    const viewport = getScrollViewport(scrollRef.current);
    if (pointerY === null || !draggedId || !viewport) return;

    const rect = viewport.getBoundingClientRect();
    let delta = 0;

    if (pointerY < rect.top + PROJECT_AUTO_SCROLL_EDGE_PX) {
      const intensity = (rect.top + PROJECT_AUTO_SCROLL_EDGE_PX - pointerY) / PROJECT_AUTO_SCROLL_EDGE_PX;
      delta = -Math.ceil(PROJECT_AUTO_SCROLL_MAX_STEP * Math.min(intensity, 1));
    } else if (pointerY > rect.bottom - PROJECT_AUTO_SCROLL_EDGE_PX) {
      const intensity = (pointerY - (rect.bottom - PROJECT_AUTO_SCROLL_EDGE_PX)) / PROJECT_AUTO_SCROLL_EDGE_PX;
      delta = Math.ceil(PROJECT_AUTO_SCROLL_MAX_STEP * Math.min(intensity, 1));
    }

    if (delta !== 0) {
      const nextScrollTop = Math.max(
        0,
        Math.min(viewport.scrollTop + delta, viewport.scrollHeight - viewport.clientHeight),
      );
      if (nextScrollTop !== viewport.scrollTop) {
        viewport.scrollTop = nextScrollTop;
        updateProjectDropPreview(pointerY, draggedId);
      }
    }

    if (draggedProjectIdRef.current) {
      autoScrollFrameRef.current = requestAnimationFrame(tickProjectAutoScroll);
    }
  }, [updateProjectDropPreview]);

  const ensureProjectAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) return;
    autoScrollFrameRef.current = requestAnimationFrame(tickProjectAutoScroll);
  }, [tickProjectAutoScroll]);

  const handleProjectDragStart = useCallback((projectId: string) => {
    draggedProjectIdRef.current = projectId;
    dragPointerYRef.current = null;
    setDraggedProjectId(projectId);
    setProjectDropTarget(null);
    ensureProjectAutoScroll();
  }, [ensureProjectAutoScroll]);

  const handleProjectDragEnd = useCallback(() => {
    clearSidebarDragPayload();
    clearProjectDragState();
  }, [clearProjectDragState]);

  const handleProjectListDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!isSidebarDragKind("project", e.dataTransfer)) return;

    const draggedId = draggedProjectIdRef.current;
    if (!draggedId) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    dragPointerYRef.current = e.clientY;
    updateProjectDropPreview(e.clientY, draggedId);
    ensureProjectAutoScroll();
  }, [ensureProjectAutoScroll, updateProjectDropPreview]);

  const handleProjectListDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!isSidebarDragKind("project", e.dataTransfer)) return;

    e.preventDefault();

    const draggedId = draggedProjectIdRef.current;
    const dropTarget = projectDropTarget ?? (
      dragPointerYRef.current !== null && draggedId
        ? getProjectDropTarget(projectListRef.current, dragPointerYRef.current, draggedId)
        : null
    );

    if (draggedId && dropTarget) {
      const reorderTargetId = resolveProjectReorderTarget(filteredProjects, draggedId, dropTarget);
      if (reorderTargetId && reorderTargetId !== draggedId) {
        onReorderProject(draggedId, reorderTargetId);
      }
    }

    clearSidebarDragPayload();
    clearProjectDragState();
  }, [clearProjectDragState, filteredProjects, onReorderProject, projectDropTarget]);

  useEffect(() => () => {
    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
    }
  }, []);

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
        <div
          className={`flex min-h-0 flex-1 flex-col ${draftSlideClass}`}
          onDragOver={handleProjectListDragOver}
          onDrop={handleProjectListDrop}
        >
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
              <div ref={projectListRef} className={`px-3 pt-2 pb-8 ${slideClass}`}>
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
                      defaultChatLimit={defaultChatLimit}
                      onCreateFolder={() => onCreateFolder(project.id)}
                      onSetOrganizeByChatBranch={onSetOrganizeByChatBranch}
                      onProjectDragStart={handleProjectDragStart}
                      onProjectDragEnd={handleProjectDragEnd}
                      dropIndicator={
                        projectDropTarget?.targetProjectId === project.id
                          ? projectDropTarget.placement
                          : null
                      }
                      isDraggingProject={draggedProjectId === project.id}
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

                <ArchivedSection
                  projects={filteredProjects}
                  archivedByProject={archivedByProject}
                  totalCount={totalArchivedCount}
                  activeSessionId={activeSessionId}
                  islandLayout={islandLayout}
                />
              </div>
            </ScrollArea>
          </div>

          <UpdateBanner />
          <PreReleaseBanner onOpenSettings={onOpenSettings} />

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
