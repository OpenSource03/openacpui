import { useState, useCallback } from "react";
import { useInlineRename } from "@/hooks/useInlineRename";
import { Folder, ChevronRight, Pencil, Trash2, MoreHorizontal, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatFolder, ChatSession, InstalledAgent } from "@/types";
import { SessionItem } from "./SessionItem";
import { useSidebarActions } from "./SidebarActionsContext";
import {
  isSidebarDragKind,
  handleSidebarFolderDrop,
} from "@/lib/sidebar/dnd";
import { useContextMenuPosition } from "@/hooks/useContextMenuPosition";

export function FolderSection({
  folder,
  sessions,
  activeSessionId,
  islandLayout,
  allFolders,
  onPinFolder,
  onRenameFolder,
  onDeleteFolder,
  agents,
  defaultCollapsed = false,
}: {
  folder: ChatFolder;
  sessions: ChatSession[];
  activeSessionId: string | null;
  islandLayout: boolean;
  allFolders: ChatFolder[];
  /** Toggle pin on this specific folder. Pre-bound by the parent. */
  onPinFolder: (pinned: boolean) => void;
  /** Rename this specific folder. Pre-bound by the parent. */
  onRenameFolder: (name: string) => void;
  /** Delete this specific folder. Pre-bound by the parent. */
  onDeleteFolder: () => void;
  agents?: InstalledAgent[];
  defaultCollapsed?: boolean;
}) {
  const {
    selectSession,
    deleteSession,
    archiveSession,
    unarchiveSession,
    renameSession,
    pinSession,
    moveSessionToFolder,
    openInSplitView,
    canOpenSessionInSplitView,
  } = useSidebarActions();
  const { isEditing, startEditing, inputProps: renameInputProps } = useInlineRename({
    initialName: folder.name,
    onRename: onRenameFolder,
  });
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const [isDragOver, setIsDragOver] = useState(false);
  const {
    menuOpen, menuAlign, setMenuOpen,
    handleContextMenu, handleMenuButtonClick,
    triggerStyle, containerRef,
  } = useContextMenuPosition();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (isSidebarDragKind("session", e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setIsDragOver(false);
      handleSidebarFolderDrop(e, folder.id, {
        onMoveSessionToFolder: (sessionId, folderId) => {
          moveSessionToFolder(sessionId, folderId);
        },
        onReorderFolder: () => {
          // folder reorder not implemented yet
        },
      });
    },
    [folder.id, moveSessionToFolder],
  );

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 px-1 ps-4">
        <input
          {...renameInputProps}
          className="flex-1 rounded-lg bg-black/5 px-2 py-1 text-[13px] text-sidebar-foreground outline-none ring-1 ring-sidebar-ring dark:bg-white/5"
        />
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg transition-all ${
        isDragOver
          ? "bg-primary/5 ring-1 ring-primary/20 dark:bg-primary/10"
          : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Folder header */}
      <div
        ref={containerRef}
        className="group relative flex items-center"
        onContextMenu={handleContextMenu}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-3 group-hover:pe-8 py-1.5 text-start text-[12px] font-semibold text-sidebar-foreground/60 transition-all hover:bg-black/5 hover:text-sidebar-foreground/80 dark:hover:bg-white/5"
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-sidebar-foreground/40 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <Folder className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40" />
          <span className="min-w-0 truncate">{folder.name}</span>
          <span className="ms-auto shrink-0 text-[10px] font-normal text-sidebar-foreground/30">
            {sessions.length}
          </span>
        </button>

        <div className="absolute end-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md text-sidebar-foreground/50 hover:bg-black/10 hover:text-sidebar-foreground dark:hover:bg-white/10"
            onClick={handleMenuButtonClick}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <span style={triggerStyle} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align={menuAlign} side="bottom" sideOffset={6} className="w-36">
            <DropdownMenuItem onClick={() => onPinFolder(!folder.pinned)}>
              {folder.pinned ? (
                <>
                  <PinOff className="me-2 h-3.5 w-3.5" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="me-2 h-3.5 w-3.5" />
                  Pin
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={startEditing}>
              <Pencil className="me-2 h-3.5 w-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDeleteFolder}
            >
              <Trash2 className="me-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Folder contents */}
      {expanded && (
        <div className="ms-2">
          {sessions.length === 0 ? (
            <p className="px-3 py-1.5 text-[11px] text-sidebar-foreground/30 italic">
              No chats
            </p>
          ) : (
            sessions.map((session) => (
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
                folders={allFolders}
                onMoveToFolder={(folderId) => moveSessionToFolder(session.id, folderId)}
                agents={agents}
                onOpenInSplitView={openInSplitView ? () => openInSplitView(session.id) : undefined}
                canOpenInSplitView={canOpenSessionInSplitView?.(session.id) ?? true}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
