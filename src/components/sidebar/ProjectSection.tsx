import { useState, useMemo, useEffect } from "react";
import {
  Pencil,
  Trash2,
  MoreHorizontal,
  FolderOpen,
  SquarePen,
  ChevronRight,
  ChevronDown,
  History,
  ArrowRightLeft,
} from "lucide-react";
import { resolveLucideIcon } from "@/lib/icon-utils";
import { Button } from "@/components/ui/button";
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
import type { ChatSession, Project, Space } from "@/types";
import { SessionItem } from "./SessionItem";
import { CCSessionList } from "./CCSessionList";

interface SessionGroup {
  label: string;
  sessions: ChatSession[];
}

/** Sort key: latest user-message timestamp, falling back to creation time. */
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

  // Sort by most recent user activity first
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

export function ProjectSection({
  islandLayout,
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
  islandLayout: boolean;
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
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-sm font-medium text-sidebar-foreground/90 transition-colors hover:bg-sidebar-accent/50"
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-sidebar-foreground/50 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
          <span className="min-w-0 truncate">{project.name}</span>
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:!bg-black/10 dark:hover:!bg-sidebar-accent/50 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={onNewChat}
        >
          <SquarePen className="h-3.5 w-3.5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:!bg-black/10 dark:hover:!bg-sidebar-accent/50 opacity-0 transition-opacity group-hover:opacity-100"
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
          {groups.map((group, i) => (
            <div key={group.label} className={i < groups.length - 1 ? "mb-1.5" : ""}>
              <p className="mb-0.5 px-2 text-[11px] font-medium text-sidebar-foreground/40 uppercase tracking-wider">
                {group.label}
              </p>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  islandLayout={islandLayout}
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
              className="group/more flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/70"
            >
              <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-hover/more:translate-y-px" />
              <span>
                Show more
                <span className="ms-1 text-sidebar-foreground/35">
                  ({Math.min(20, remainingCount)} of {remainingCount})
                </span>
              </span>
            </button>
          )}

          {sessions.length === 0 && (
            <p className="px-2 py-2 text-xs text-sidebar-foreground/35">
              No conversations yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}
