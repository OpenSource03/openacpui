import { useCallback } from "react";
import { useInlineRename } from "@/hooks/useInlineRename";
import {
  Archive,
  ArchiveRestore,
  Columns2,
  GitFork,
  Pencil,
  Trash2,
  MoreHorizontal,
  Loader2,
  Pin,
  PinOff,
  FolderInput,
  FolderMinus,
} from "lucide-react";
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
import type { ChatFolder, ChatSession, InstalledAgent } from "@/types";
import { AgentIcon } from "@/components/AgentIcon";
import { getSessionEngineIcon } from "@/lib/engine-icons";
import {
  writeSidebarDragPayload,
  clearSidebarDragPayload,
} from "@/lib/sidebar/dnd";
import { useContextMenuPosition } from "@/hooks/useContextMenuPosition";

export function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onArchive,
  onUnarchive,
  onFork,
  onRename,
  onPinToggle,
  folders,
  onMoveToFolder,
  agents,
  onOpenInSplitView,
  canOpenInSplitView = true,
}: {
  islandLayout: boolean;
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  /** Move session to archive (hidden from main list, data preserved). */
  onArchive?: () => void;
  /** Restore an archived session back to the main list. */
  onUnarchive?: () => void;
  /**
   * Fork a CLI session. Only meaningful when session.engine === 'cli'
   * — caller passes undefined for other engines so the menu item is
   * hidden.
   */
  onFork?: () => void;
  onRename: (title: string) => void;
  /** Toggle pin state. Omit if pin feature not available in this context. */
  onPinToggle?: () => void;
  /** Available folders for "Move to folder" submenu. Omit to hide the menu. */
  folders?: ChatFolder[];
  /** Move session to a folder (null = remove from folder). */
  onMoveToFolder?: (folderId: string | null) => void;
  agents?: InstalledAgent[];
  /** Open this session in the split view secondary pane. */
  onOpenInSplitView?: () => void;
  canOpenInSplitView?: boolean;
}) {
  const { isEditing, startEditing, inputProps: renameInputProps } = useInlineRename({
    initialName: session.title,
    onRename,
  });
  const {
    menuOpen, menuAlign, setMenuOpen,
    handleContextMenu, handleMenuButtonClick,
    triggerStyle, containerRef,
  } = useContextMenuPosition();

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      writeSidebarDragPayload(e.dataTransfer, {
        kind: "session",
        id: session.id,
      });
      e.dataTransfer.effectAllowed = "move";
    },
    [session.id],
  );

  const handleDragEnd = useCallback(() => {
    clearSidebarDragPayload();
  }, []);

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 px-1 ps-2">
        <input
          {...renameInputProps}
          className="flex-1 rounded-lg bg-black/5 px-2 py-1 text-[13px] text-sidebar-foreground outline-none ring-1 ring-sidebar-ring dark:bg-white/5"
        />
      </div>
    );
  }

  const hasFolderMenu = folders && folders.length > 0 && onMoveToFolder;

  return (
    <div
      ref={containerRef}
      className="group relative"
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onContextMenu={handleContextMenu}
    >
      <button
        onClick={onSelect}
        className={`session-item-button flex w-full min-w-0 items-center gap-2.5 rounded-lg ps-4 pe-3 group-hover:pe-8 py-1.5 text-start text-[13px] font-medium transition-all ${
          isActive
            ? "session-item-active bg-primary/10 text-black dark:bg-primary/15 dark:text-primary"
            : "text-sidebar-foreground/75 hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/5"
        }`}
      >
        {session.hasPendingPermission ? (
          /* Pulsing amber dot — permission waiting (takes priority over spinner since it's blocking) */
          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
        ) : session.isProcessing ? (
          <Loader2
            className={`h-3 w-3 shrink-0 animate-spin ${
              isActive ? "text-current opacity-80" : "text-sidebar-foreground/60"
            }`}
          />
        ) : session.hasUnreadCompletion && !isActive ? (
          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
        ) : (
          <span className="relative flex shrink-0 items-center">
            <AgentIcon
              icon={getSessionEngineIcon(session.engine, session.agentId, agents)}
              size={12}
              className={`shrink-0 ${isActive ? "opacity-80" : "opacity-50"}`}
            />
            {session.pinned && (
              <Pin className="absolute -end-1 -top-1 h-2 w-2 text-sidebar-foreground/40" />
            )}
          </span>
        )}
        {session.titleGenerating ? (
          <span
            className={
              isActive
                ? "text-current opacity-80 italic"
                : "text-sidebar-foreground/60 italic"
            }
          >
            Generating title...
          </span>
        ) : (
          <span className="min-w-0 truncate">{session.title}</span>
        )}
      </button>

      <div className="absolute end-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-all group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-md text-sidebar-foreground/60 hover:bg-black/10 hover:text-sidebar-foreground dark:hover:bg-white/10"
          onClick={handleMenuButtonClick}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </div>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span style={triggerStyle} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={menuAlign} side="bottom" sideOffset={6} className="w-44">
          {/* Pin / Unpin */}
          {onPinToggle && (
            <DropdownMenuItem onClick={onPinToggle}>
              {session.pinned ? (
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
          )}

          {/* Move to folder */}
          {hasFolderMenu && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="me-2 h-3.5 w-3.5" />
                Move to folder
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {session.folderId && (
                  <DropdownMenuItem onClick={() => onMoveToFolder(null)}>
                    <FolderMinus className="me-2 h-3.5 w-3.5" />
                    Remove from folder
                  </DropdownMenuItem>
                )}
                {folders
                  .filter((f) => f.id !== session.folderId)
                  .map((folder) => (
                    <DropdownMenuItem
                      key={folder.id}
                      onClick={() => onMoveToFolder(folder.id)}
                    >
                      <FolderInput className="me-2 h-3.5 w-3.5" />
                      {folder.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {(onPinToggle || hasFolderMenu) && <DropdownMenuSeparator />}

          {onOpenInSplitView && canOpenInSplitView && (
            <DropdownMenuItem onClick={onOpenInSplitView}>
              <Columns2 className="me-2 h-3.5 w-3.5" />
              Open in Split View
            </DropdownMenuItem>
          )}

          <DropdownMenuItem onClick={startEditing}>
            <Pencil className="me-2 h-3.5 w-3.5" />
            Rename
          </DropdownMenuItem>
          {/* Fork is CLI-only; hidden when caller doesn't pass onFork. */}
          {onFork && (
            <DropdownMenuItem onClick={onFork}>
              <GitFork className="me-2 h-3.5 w-3.5" />
              Fork from here
            </DropdownMenuItem>
          )}
          {session.archivedAt ? (
            onUnarchive && (
              <DropdownMenuItem onClick={onUnarchive}>
                <ArchiveRestore className="me-2 h-3.5 w-3.5" />
                Unarchive
              </DropdownMenuItem>
            )
          ) : (
            onArchive && (
              <DropdownMenuItem onClick={onArchive}>
                <Archive className="me-2 h-3.5 w-3.5" />
                Archive
              </DropdownMenuItem>
            )
          )}
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
  );
}
