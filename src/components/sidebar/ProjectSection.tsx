import { useState, useMemo, useEffect, useRef } from "react";
import { useInlineRename } from "@/hooks/useInlineRename";
import { useContextMenuPosition } from "@/hooks/useContextMenuPosition";
import {
  Pencil,
  Trash2,
  MoreHorizontal,
  FolderOpen,
  FolderPlus,
  SquarePen,
  KanbanSquare,
  ChevronRight,
  ChevronDown,
  History,
  ArrowRightLeft,
  Smile,
  X,
  GitBranch,
} from "lucide-react";
import { resolveLucideIcon } from "@/lib/icon-utils";
import { SimpleIconGlyph } from "@/components/SimpleIconGlyph";
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
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { IconPicker } from "@/components/IconPicker";
import type { ChatFolder, ChatSession, InstalledAgent, Project, Space } from "@/types";
import { SessionItem } from "./SessionItem";
import { CCSessionList } from "./CCSessionList";
import { PinnedSection } from "./PinnedSection";
import { FolderSection } from "./FolderSection";
import { BranchSection } from "./BranchSection";
import { useSidebarActions } from "./SidebarActionsContext";
import { buildSidebarGroups, type SidebarItem, type PinnedSidebarItem } from "@/lib/sidebar/grouping";
import {
  clearSidebarDragPayload,
  writeSidebarDragPayload,
} from "@/lib/sidebar/dnd";

type ProjectDropIndicator = "before" | "after" | null;

export function ProjectSection({
  islandLayout,
  project,
  sessions,
  folders,
  activeSessionId,
  jiraBoardEnabled,
  isJiraBoardOpen,
  organizeByChatBranch,
  onNewChat,
  onToggleJiraBoard,
  onDeleteProject,
  onRenameProject,
  onUpdateIcon,
  onImportCCSession,
  otherSpaces,
  onMoveToSpace,
  defaultChatLimit,
  onCreateFolder,
  onSetOrganizeByChatBranch,
  onProjectDragStart,
  onProjectDragEnd,
  dropIndicator,
  isDraggingProject,
  agents,
}: {
  islandLayout: boolean;
  project: Project;
  sessions: ChatSession[];
  folders: ChatFolder[];
  activeSessionId: string | null;
  jiraBoardEnabled: boolean;
  isJiraBoardOpen: boolean;
  organizeByChatBranch: boolean;
  onNewChat: () => void;
  onToggleJiraBoard: () => void;
  onDeleteProject: () => void;
  onRenameProject: (name: string) => void;
  onUpdateIcon: (icon: string | null, iconType: "emoji" | "lucide" | "simple" | null) => void;
  onImportCCSession: (ccSessionId: string) => void;
  otherSpaces: Space[];
  onMoveToSpace: (spaceId: string) => void;
  defaultChatLimit: number;
  onCreateFolder: () => void;
  onSetOrganizeByChatBranch: (on: boolean) => void;
  onProjectDragStart: (projectId: string) => void;
  onProjectDragEnd: () => void;
  dropIndicator: ProjectDropIndicator;
  isDraggingProject: boolean;
  agents?: InstalledAgent[];
}) {
  const {
    selectSession,
    deleteSession,
    archiveSession,
    unarchiveSession,
    renameSession,
    pinSession,
    moveSessionToFolder,
    pinFolder,
    renameFolder,
    deleteFolder,
    openInSplitView,
    canOpenSessionInSplitView,
  } = useSidebarActions();
  const { isEditing, startEditing, inputProps: renameInputProps } = useInlineRename({
    initialName: project.name,
    onRename: onRenameProject,
  });
  const {
    menuOpen, menuAlign, setMenuOpen,
    handleContextMenu, handleMenuButtonClick,
    triggerStyle, containerRef,
  } = useContextMenuPosition();
  const [expanded, setExpanded] = useState(true);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const openingIconPickerRef = useRef(false);
  // Pagination: show N items initially, load 20 more on each click
  const [visibleCount, setVisibleCount] = useState(defaultChatLimit);

  // Reset visible count when the configured limit changes
  useEffect(() => {
    setVisibleCount(defaultChatLimit);
  }, [defaultChatLimit]);

  // Build grouped sidebar items using the grouping algorithm
  const sidebarItems = useMemo(
    () => buildSidebarGroups(sessions, folders, organizeByChatBranch),
    [sessions, folders, organizeByChatBranch],
  );

  // Count non-pinned items for pagination
  const pinnedItem = sidebarItems.find((item): item is PinnedSidebarItem => item.type === "pinned");
  const contentItems = sidebarItems.filter((item) => item.type !== "pinned");

  // For pagination, count total visible sessions (not groups)
  const totalSessionCount = sessions.filter((s) => !s.pinned).length;
  const hasMore = totalSessionCount > visibleCount;
  const remainingCount = totalSessionCount - visibleCount;

  // Limit content items to visibleCount sessions
  const visibleContentItems = useMemo(() => {
    let sessionsSoFar = 0;
    const visible: SidebarItem[] = [];
    for (const item of contentItems) {
      if (sessionsSoFar >= visibleCount) break;
      visible.push(item);
      if (item.type === "session") {
        sessionsSoFar += 1;
      } else {
        sessionsSoFar += item.sessions.length;
      }
    }
    return visible;
  }, [contentItems, visibleCount]);

  if (isEditing) {
    return (
      <div className="mb-1 flex items-center gap-1 px-1 ps-2">
        <input
          {...renameInputProps}
          className="flex-1 rounded-lg bg-black/5 px-2 py-1 text-[13px] text-sidebar-foreground outline-none ring-1 ring-sidebar-ring dark:bg-white/5"
        />
      </div>
    );
  }

  /** Render a single sidebar item (folder, branch, or session). */
  function renderItem(item: SidebarItem) {
    if (item.type === "folder") {
      const { folder } = item;
      return (
        <FolderSection
          key={`folder-${folder.id}`}
          folder={folder}
          sessions={item.sessions}
          activeSessionId={activeSessionId}
          islandLayout={islandLayout}
          allFolders={folders}
          onPinFolder={(pinned) => pinFolder(project.id, folder.id, pinned)}
          onRenameFolder={(name) => renameFolder(project.id, folder.id, name)}
          onDeleteFolder={() => deleteFolder(project.id, folder.id)}
          agents={agents}
        />
      );
    }

    if (item.type === "branch") {
      return (
        <BranchSection
          key={`branch-${item.branchName}`}
          branchName={item.branchName}
          children={item.children}
          activeSessionId={activeSessionId}
          islandLayout={islandLayout}
          allFolders={folders}
          agents={agents}
        />
      );
    }

    if (item.type === "session") {
      const { session } = item;
      return (
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
          onPinToggle={() => pinSession(session.id, !session.pinned)}
          folders={folders}
          onMoveToFolder={(folderId) => moveSessionToFolder(session.id, folderId)}
          agents={agents}
          onOpenInSplitView={openInSplitView ? () => openInSplitView(session.id) : undefined}
          canOpenInSplitView={canOpenSessionInSplitView?.(session.id) ?? true}
        />
      );
    }

    return null;
  }

  return (
    <div className="relative mb-2 rounded-xl">
      {dropIndicator === "before" && (
        <div className="pointer-events-none absolute inset-x-2 -top-1 z-20">
          <div className="h-0.5 rounded-full bg-primary shadow-[0_0_0_1px_hsl(var(--background))]" />
        </div>
      )}
      {dropIndicator === "after" && (
        <div className="pointer-events-none absolute inset-x-2 -bottom-1 z-20">
          <div className="h-0.5 rounded-full bg-primary shadow-[0_0_0_1px_hsl(var(--background))]" />
        </div>
      )}

      <div
        className={`rounded-xl transition-opacity ${isDraggingProject ? "opacity-60" : ""}`}
      >
        {/* Project header row */}
        <div
          ref={containerRef}
          className="group relative flex cursor-grab items-center active:cursor-grabbing"
          data-project-drop-anchor-id={project.id}
          draggable
          onDragStart={(e) => {
            writeSidebarDragPayload(e.dataTransfer, { kind: "project", id: project.id });
            e.dataTransfer.effectAllowed = "move";
            onProjectDragStart(project.id);
          }}
          onDragEnd={() => {
            clearSidebarDragPayload();
            onProjectDragEnd();
          }}
          onContextMenu={handleContextMenu}
        >
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-start text-[13px] font-semibold text-sidebar-foreground/90 transition-all group-hover:pe-20 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-sidebar-foreground/50 transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
            />
            {project.icon && project.iconType === "emoji" ? (
              <span className="h-4 w-4 shrink-0 text-center text-sm leading-4">{project.icon}</span>
            ) : project.icon && project.iconType === "simple" ? (
              <SimpleIconGlyph slug={project.icon} size={16} className="shrink-0 text-sidebar-foreground/60" />
            ) : project.icon && project.iconType === "lucide" ? (
              (() => {
                const Icon = resolveLucideIcon(project.icon);
                return Icon ? (
                  <Icon className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />
                ) : (
                  <FolderOpen className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />
                );
              })()
            ) : (
              <FolderOpen className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />
            )}
            <span className="min-w-0 truncate">{project.name}</span>
          </button>

          <div className="absolute end-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {jiraBoardEnabled && (
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 shrink-0 rounded-lg transition-all ${
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
              className="h-7 w-7 shrink-0 rounded-lg text-sidebar-foreground/50 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
              onClick={onNewChat}
            >
              <SquarePen className="h-4 w-4" />
            </Button>

            <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
              <PopoverAnchor asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 rounded-lg text-sidebar-foreground/50 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
                  onClick={handleMenuButtonClick}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </PopoverAnchor>

              {/* Icon picker popover — anchored to the ... button, triggered from dropdown "Set icon" */}
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

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <span style={triggerStyle} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align={menuAlign}
              side="bottom"
              sideOffset={6}
              className="w-48"
              onCloseAutoFocus={(e) => {
                if (!openingIconPickerRef.current) return;
                e.preventDefault();
                openingIconPickerRef.current = false;
              }}
            >
              <DropdownMenuItem onClick={onCreateFolder}>
                <FolderPlus className="me-2 h-3.5 w-3.5" />
                New folder
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={organizeByChatBranch}
                onCheckedChange={onSetOrganizeByChatBranch}
              >
                <GitBranch className="me-2 h-3.5 w-3.5" />
                Organize by branch
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={startEditing}>
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
                <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
                  <CCSessionList projectPath={project.path} onSelect={onImportCCSession} />
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
                        <DropdownMenuItem key={s.id} onClick={() => onMoveToSpace(s.id)}>
                          {s.iconType === "emoji" ? (
                            <span className="me-2 text-sm">{s.icon}</span>
                          ) : s.iconType === "simple" ? (
                            <SimpleIconGlyph slug={s.icon} size={14} className="me-2 shrink-0" />
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
        <div className="ms-2 overflow-hidden">
          {/* Pinned section */}
          {pinnedItem && (
            <PinnedSection
              sessions={pinnedItem.sessions}
              pinnedFolders={pinnedItem.children}
              activeSessionId={activeSessionId}
              islandLayout={islandLayout}
              folders={folders}
              agents={agents}
            />
          )}

          {/* Content items (folders, branches, ungrouped sessions) */}
          {visibleContentItems.map((item) => renderItem(item))}

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
            <p className="px-3 py-2 text-[13px] font-medium text-sidebar-foreground/40">
              No conversations yet
            </p>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
