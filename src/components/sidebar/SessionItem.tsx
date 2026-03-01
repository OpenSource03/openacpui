import { useState } from "react";
import { Pencil, MessageSquare, Trash2, MoreHorizontal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatSession } from "@/types";

export function SessionItem({
  islandLayout,
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  islandLayout: boolean;
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
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
        }`}
      >
        {session.hasPendingPermission ? (
          /* Pulsing amber dot — permission waiting (takes priority over spinner since it's blocking) */
          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
        ) : session.isProcessing ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sidebar-foreground/60" />
        ) : (
          <MessageSquare className="h-3 w-3 shrink-0 text-sidebar-foreground/50" />
        )}
        {session.titleGenerating ? (
          <span className="text-sidebar-foreground/60 italic">Generating title...</span>
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
              className="h-5 w-5 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:!bg-black/10 dark:hover:!bg-sidebar-accent/50"
            >
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className={
              islandLayout
                ? "w-36 border-none bg-transparent shadow-[0_14px_34px_-10px_color-mix(in_oklab,var(--foreground)_40%,transparent)]"
                : "w-36"
            }
          >
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
