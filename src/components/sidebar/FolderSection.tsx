import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  MoreHorizontal,
  Folder,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatSession, ChatFolder, InstalledAgent } from "@/types";
import { SessionItem } from "./SessionItem";

export function FolderSection({
  islandLayout,
  folder,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onRenameFolder,
  onDeleteFolder,
  agents,
}: {
  islandLayout: boolean;
  folder: ChatFolder;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onRenameFolder: (name: string) => void;
  onDeleteFolder: () => void;
  agents?: InstalledAgent[];
}) {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== folder.name) {
      onRenameFolder(trimmed);
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
      className={`mb-1.5 rounded-lg transition-all ${isDragOver ? "bg-black/5 dark:bg-white/5 ring-1 ring-primary/20" : ""}`}
      onDragOver={(e) => {
        // Accept session drops for moving to folder
        if (e.dataTransfer.types.includes("application/x-session-id")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setIsDragOver(true);
        }
        // Accept folder drops for reordering
        if (e.dataTransfer.types.includes("application/x-folder-id")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        setIsDragOver(false);
        const sessionId = e.dataTransfer.getData("application/x-session-id");
        const folderId = e.dataTransfer.getData("application/x-folder-id");

        if (sessionId) {
          // Session dropped on folder - handled by parent
          e.dataTransfer.setData("application/x-target-folder-id", folder.id);
        } else if (folderId && folderId !== folder.id) {
          // Folder reorder - handled by parent
          e.dataTransfer.setData("application/x-target-folder-id", folder.id);
        }
      }}
    >
      {/* Folder header row */}
      <div
        className="group flex items-center"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-folder-id", folder.id);
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-start text-[12px] font-semibold text-sidebar-foreground/80 transition-all hover:bg-black/5 dark:hover:bg-white/10"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <Folder className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
          <span className="min-w-0 truncate">{folder.name}</span>
          <span className="ms-auto shrink-0 text-[11px] text-sidebar-foreground/40">
            {sessions.length}
          </span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-lg shrink-0 text-sidebar-foreground/50 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10 opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44"
          >
            <DropdownMenuItem
              onClick={() => {
                setEditName(folder.name);
                setIsEditing(true);
              }}
            >
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

      {/* Nested chats */}
      {expanded && (
        <div className="ms-2 overflow-hidden">
          {sessions.length === 0 ? (
            <p className="px-3 py-1.5 text-[12px] text-sidebar-foreground/40 italic">
              No conversations
            </p>
          ) : (
            sessions.map((session) => (
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
            ))
          )}
        </div>
      )}
    </div>
  );
}
