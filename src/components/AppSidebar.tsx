import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import {
  PanelLeft,
  Pencil,
  MessageSquare,
  Trash2,
  MoreHorizontal,
  FolderOpen,
  Plus,
  SquarePen,
  ChevronRight,
  ChevronDown,
  Loader2,
  History,
  ArrowRightLeft,
} from "lucide-react";
import { resolveLucideIcon } from "@/lib/icon-utils";
import { isMac } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatSession, CCSessionInfo, Project, Space } from "@/types";
import { SidebarSearch } from "./SidebarSearch";
import { SpaceBar } from "./SpaceBar";
import { UpdateBanner } from "./UpdateBanner";

interface AppSidebarProps {
  isOpen: boolean;
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

interface SessionGroup {
  label: string;
  sessions: ChatSession[];
}

/** Sort key: latest message timestamp, falling back to creation time. */
function getSortTimestamp(session: ChatSession): number {
  return session.lastMessageAt ?? session.createdAt;
}

function groupSessionsByDate(sessions: ChatSession[]): SessionGroup[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const yesterdayMs = todayMs - 86_400_000;
  const weekAgoMs = todayMs - 7 * 86_400_000;

  const groups: SessionGroup[] = [
    { label: "Today", sessions: [] },
    { label: "Yesterday", sessions: [] },
    { label: "Last 7 Days", sessions: [] },
    { label: "Older", sessions: [] },
  ];

  // Sort by most recent activity first
  const sorted = [...sessions].sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a));

  for (const session of sorted) {
    const ts = getSortTimestamp(session);
    if (ts >= todayMs) {
      groups[0].sessions.push(session);
    } else if (ts >= yesterdayMs) {
      groups[1].sessions.push(session);
    } else if (ts >= weekAgoMs) {
      groups[2].sessions.push(session);
    } else {
      groups[3].sessions.push(session);
    }
  }

  return groups.filter((g) => g.sessions.length > 0);
}

export const AppSidebar = memo(function AppSidebar({
  isOpen,
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
          className="no-drag h-7 w-7 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={onToggleSidebar}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>

        <div className="flex-1" />

        <button
          onClick={onCreateProject}
          className="no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
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
              <p className="px-2 py-8 text-center text-xs text-sidebar-foreground/40">
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

function ProjectSection({
  project,
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onDeleteProject,
  onRenameProject,
  onImportCCSession,
  otherSpaces,
  onMoveToSpace,
  onReorderProject,
  defaultChatLimit,
}: {
  project: Project;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteProject: () => void;
  onRenameProject: (name: string) => void;
  onImportCCSession: (ccSessionId: string) => void;
  otherSpaces: Space[];
  onMoveToSpace: (spaceId: string) => void;
  onReorderProject: (targetProjectId: string) => void;
  defaultChatLimit: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [isDragOver, setIsDragOver] = useState(false);
  // Pagination: show N chats initially, load 20 more on each click
  const [visibleCount, setVisibleCount] = useState(defaultChatLimit);

  // Reset visible count when the configured limit changes
  useEffect(() => {
    setVisibleCount(defaultChatLimit);
  }, [defaultChatLimit]);

  // Sort all sessions by latest message, then slice for pagination
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a)),
    [sessions],
  );
  const visibleSessions = useMemo(
    () => sortedSessions.slice(0, visibleCount),
    [sortedSessions, visibleCount],
  );
  const hasMore = sortedSessions.length > visibleCount;
  const remainingCount = sortedSessions.length - visibleCount;

  const groups = useMemo(() => groupSessionsByDate(visibleSessions), [visibleSessions]);

  const handleRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== project.name) {
      onRenameProject(trimmed);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="mb-1 flex items-center gap-1 px-1">
        <input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") setIsEditing(false);
          }}
          className="flex-1 rounded bg-sidebar-accent px-2 py-1 text-sm text-sidebar-foreground outline-none ring-1 ring-sidebar-ring"
        />
      </div>
    );
  }

  return (
    <div
      className={`mb-1 rounded-md transition-colors ${isDragOver ? "bg-sidebar-accent/60" : ""}`}
      onDragOver={(e) => {
        // Accept project drops for reorder
        if (e.dataTransfer.types.includes("application/x-project-id")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        setIsDragOver(false);
        const draggedId = e.dataTransfer.getData("application/x-project-id");
        if (draggedId && draggedId !== project.id) {
          onReorderProject(draggedId);
        }
      }}
    >
      {/* Project header row */}
      <div
        className="group flex items-center"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-project-id", project.id);
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50"
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-sidebar-foreground/40 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50" />
          <span className="min-w-0 truncate">{project.name}</span>
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-sidebar-foreground/40 hover:text-sidebar-foreground opacity-0 transition-opacity group-hover:opacity-100"
          onClick={onNewChat}
        >
          <SquarePen className="h-3.5 w-3.5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-sidebar-foreground/40 hover:text-sidebar-foreground opacity-0 transition-opacity group-hover:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onClick={() => {
                setEditName(project.name);
                setIsEditing(true);
              }}
            >
              <Pencil className="me-2 h-3.5 w-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <History className="me-2 h-3.5 w-3.5" />
                Resume CC Chat
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-72 max-h-80 overflow-y-auto">
                <CCSessionList
                  projectPath={project.path}
                  onSelect={onImportCCSession}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {otherSpaces.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowRightLeft className="me-2 h-3.5 w-3.5" />
                  Move to space
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  {otherSpaces.map((s) => {
                    const SpIcon = s.iconType === "lucide" ? resolveLucideIcon(s.icon) : null;
                    return (
                      <DropdownMenuItem
                        key={s.id}
                        onClick={() => onMoveToSpace(s.id)}
                      >
                        {s.iconType === "emoji" ? (
                          <span className="me-2 text-sm">{s.icon}</span>
                        ) : SpIcon ? (
                          <SpIcon className="me-2 h-3.5 w-3.5" />
                        ) : null}
                        {s.name}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDeleteProject}
            >
              <Trash2 className="me-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nested chats */}
      {expanded && (
        <div className="ms-5 overflow-hidden">
          {groups.map((group) => (
            <div key={group.label} className="mb-1.5">
              <p className="mb-0.5 px-2 text-[11px] font-medium text-sidebar-foreground/30 uppercase tracking-wider">
                {group.label}
              </p>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onSelect={() => onSelectSession(session.id)}
                  onDelete={() => onDeleteSession(session.id)}
                  onRename={(title) => onRenameSession(session.id, title)}
                />
              ))}
            </div>
          ))}

          {/* Load more button */}
          {hasMore && (
            <button
              onClick={() => setVisibleCount((prev) => prev + 20)}
              className="group/more mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/60"
            >
              <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-hover/more:translate-y-px" />
              <span>
                Show more
                <span className="ms-1 text-sidebar-foreground/25">
                  ({Math.min(20, remainingCount)} of {remainingCount})
                </span>
              </span>
            </button>
          )}

          {sessions.length === 0 && (
            <p className="px-2 py-2 text-xs text-sidebar-foreground/25">
              No conversations yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title);

  const handleRename = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 px-1">
        <input
          autoFocus
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") setIsEditing(false);
          }}
          className="flex-1 rounded bg-sidebar-accent px-2 py-1 text-sm text-sidebar-foreground outline-none ring-1 ring-sidebar-ring"
        />
      </div>
    );
  }

  return (
    <div className="group relative">
      <button
        onClick={onSelect}
        className={`flex w-full min-w-0 items-center gap-2 rounded-md ps-2 pe-6 py-1 text-start text-[13px] transition-colors ${
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
        }`}
      >
        {session.hasPendingPermission ? (
          /* Pulsing amber dot — permission waiting (takes priority over spinner since it's blocking) */
          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
        ) : session.isProcessing ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sidebar-foreground/50" />
        ) : (
          <MessageSquare className="h-3 w-3 shrink-0 text-sidebar-foreground/40" />
        )}
        {session.titleGenerating ? (
          <span className="flex items-center gap-1.5 text-sidebar-foreground/50">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="italic">Generating title...</span>
          </span>
        ) : (
          <span className="min-w-0 truncate">{session.title}</span>
        )}
      </button>

      <div className="absolute end-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-sidebar-foreground/50 hover:text-sidebar-foreground"
            >
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem
              onClick={() => {
                setEditTitle(session.title);
                setIsEditing(true);
              }}
            >
              <Pencil className="me-2 h-3.5 w-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="me-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function CCSessionList({
  projectPath,
  onSelect,
}: {
  projectPath: string;
  onSelect: (sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<CCSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    window.claude.ccSessions
      .list(projectPath)
      .then((result) => {
        setSessions(result);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [projectPath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        No Claude Code sessions found
      </p>
    );
  }

  return (
    <>
      {sessions.map((s) => (
        <DropdownMenuItem
          key={s.sessionId}
          onClick={() => onSelect(s.sessionId)}
          className="flex flex-col items-start gap-0.5 py-2"
        >
          <span className="line-clamp-1 text-sm">{s.preview}</span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeDate(s.timestamp)} · {s.model}
          </span>
        </DropdownMenuItem>
      ))}
    </>
  );
}
