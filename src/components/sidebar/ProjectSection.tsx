import { useState, useMemo, useEffect, useRef } from "react";
import {
  Pencil,
  Trash2,
  MoreHorizontal,
  FolderOpen,
  SquarePen,
  KanbanSquare,
  ChevronRight,
  ChevronDown,
  History,
  ArrowRightLeft,
  Smile,
  X,
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
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { IconPicker } from "@/components/IconPicker";
import type { ChatSession, InstalledAgent, Project, Space } from "@/types";
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
  jiraBoardEnabled,
  isJiraBoardOpen,
  onNewChat,
  onToggleJiraBoard,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onDeleteProject,
  onRenameProject,
  onUpdateIcon,
  onImportCCSession,
  otherSpaces,
  onMoveToSpace,
  onReorderProject,
  defaultChatLimit,
  agents,
}: {
  islandLayout: boolean;
  project: Project;
  sessions: ChatSession[];
  activeSessionId: string | null;
  jiraBoardEnabled: boolean;
  isJiraBoardOpen: boolean;
  onNewChat: () => void;
  onToggleJiraBoard: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteProject: () => void;
  onRenameProject: (name: string) => void;
  onUpdateIcon: (icon: string | null, iconType: "emoji" | "lucide" | null) => void;
  onImportCCSession: (ccSessionId: string) => void;
  otherSpaces: Space[];
  onMoveToSpace: (spaceId: string) => void;
  onReorderProject: (targetProjectId: string) => void;
  defaultChatLimit: number;
  agents?: InstalledAgent[];
}) {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [isDragOver, setIsDragOver] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const openingIconPickerRef = useRef(false);
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
      <div className="mb-1 flex items-center gap-1 px-1 ps-2">
        <input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") setIsEditing(false);
          }}
          className="flex-1 rounded-lg bg-black/5 px-2 py-1 text-[13px] text-sidebar-foreground outline-none ring-1 ring-sidebar-ring dark:bg-white/5"
        />
      </div>
    );
  }

  return (
    <div
      className={`mb-2 rounded-xl transition-all ${isDragOver ? "bg-black/5 dark:bg-white/5 ring-1 ring-primary/20" : ""}`}
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
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2.5 py-2 text-start text-[13px] font-semibold text-sidebar-foreground/90 transition-all hover:bg-black/5 dark:hover:bg-white/10"
        >
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-sidebar-foreground/50 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          {project.icon && project.iconType === "emoji" ? (
            <span className="h-4 w-4 shrink-0 text-sm leading-4 text-center">{project.icon}</span>
          ) : project.icon && project.iconType === "lucide" ? (
            (() => {
              const Icon = resolveLucideIcon(project.icon);
              return Icon ? <Icon className="h-4 w-4 shrink-0 text-sidebar-foreground/60" /> : <FolderOpen className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />;
            })()
          ) : (
            <FolderOpen className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />
          )}
          <span className="min-w-0 truncate">{project.name}</span>
        </button>

        {jiraBoardEnabled && (
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 rounded-lg shrink-0 transition-all ${
              isJiraBoardOpen
                ? "bg-black/10 text-sidebar-foreground dark:bg-white/15"
                : "text-sidebar-foreground/50 hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
            }`}
            onClick={onToggleJiraBoard}
            title="Open Jira board"
          >
            <KanbanSquare className="h-4 w-4" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg shrink-0 text-sidebar-foreground/50 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
          onClick={onNewChat}
        >
          <SquarePen className="h-4 w-4" />
        </Button>

        <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
        <PopoverAnchor>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg shrink-0 text-sidebar-foreground/50 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44"
            onCloseAutoFocus={(e) => {
              if (!openingIconPickerRef.current) return;
              e.preventDefault();
              openingIconPickerRef.current = false;
            }}
          >
            <DropdownMenuItem
              onClick={() => {
                setEditName(project.name);
                setIsEditing(true);
              }}
            >
              <Pencil className="me-2 h-3.5 w-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                openingIconPickerRef.current = true;
                setMenuOpen(false);
                requestAnimationFrame(() => setIconPickerOpen(true));
              }}
            >
              <Smile className="me-2 h-3.5 w-3.5" />
              Set icon
            </DropdownMenuItem>
            {project.icon && (
              <DropdownMenuItem onClick={() => onUpdateIcon(null, null)}>
                <X className="me-2 h-3.5 w-3.5" />
                Remove icon
              </DropdownMenuItem>
            )}
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
        </PopoverAnchor>

        {/* Icon picker popover — anchored to the ⋯ button, triggered from dropdown "Set icon" */}
        <PopoverContent align="start" side="right" className="w-72 p-3">
          <IconPicker
            value={project.icon ?? ""}
            iconType={project.iconType ?? "emoji"}
            onChange={(icon, type) => {
              onUpdateIcon(icon, type);
              setIconPickerOpen(false);
            }}
          />
        </PopoverContent>
        </Popover>
      </div>

      {/* Nested chats */}
      {expanded && (
        <div className="ms-2 overflow-hidden">
          {groups.map((group, i) => (
            <div key={group.label} className={i < groups.length - 1 ? "mb-3" : ""}>
              <div className="mb-1.5 px-3">
                <p className="mb-1 text-[10px] font-bold text-sidebar-foreground/40 uppercase tracking-wider">
                  {group.label}
                </p>
              </div>
                {group.sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    islandLayout={islandLayout}
                    session={session}
                    isActive={session.id === activeSessionId}
                    onSelect={() => onSelectSession(session.id)}
                    onDelete={() => onDeleteSession(session.id)}
                    onRename={(title) => onRenameSession(session.id, title)}
                    agents={agents}
                  />
                ))}
              </div>
            ))}

            {/* Load more button */}
            {hasMore && (
              <button
                onClick={() => setVisibleCount((prev) => prev + 20)}
                className="group/more mt-1 flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-sidebar-foreground/50 transition-all hover:bg-black/5 hover:text-sidebar-foreground/70 dark:hover:bg-white/5"
              >
                <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-hover/more:translate-y-0.5" />
                <span>
                  Show more
                  <span className="ms-1 text-sidebar-foreground/35">
                    ({Math.min(20, remainingCount)} of {remainingCount})
                  </span>
                </span>
              </button>
            )}

            {sessions.length === 0 && (
              <p className="px-3 py-2 text-[13px] text-sidebar-foreground/40 font-medium">
                No conversations yet
              </p>
            )}
        </div>
      )}
    </div>
  );
}
