import { useState } from "react";
import { Pencil, Trash2, MoreHorizontal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatSession, InstalledAgent } from "@/types";
import { AgentIcon } from "@/components/AgentIcon";
import { getSessionEngineIcon } from "@/lib/engine-icons";

export function SessionItem({
  islandLayout,
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
  agents,
}: {
  islandLayout: boolean;
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  agents?: InstalledAgent[];
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
      <div className="flex items-center gap-1 px-1 ps-2">
        <input
          autoFocus
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
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
    <div className="group relative">
      <button
        onClick={onSelect}
        className={`session-item-button flex w-full min-w-0 items-center gap-2.5 rounded-lg ps-4 pe-8 py-1.5 text-start text-[13px] font-medium transition-all ${
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
          <Loader2 className={`h-3 w-3 shrink-0 animate-spin ${isActive ? "text-current opacity-80" : "text-sidebar-foreground/60"}`} />
        ) : (
          <AgentIcon
            icon={getSessionEngineIcon(session.engine, session.agentId, agents)}
            size={12}
            className={`shrink-0 ${isActive ? "opacity-80" : "opacity-50"}`}
          />
        )}
        {session.titleGenerating ? (
          <span className={isActive ? "text-current opacity-80 italic" : "text-sidebar-foreground/60 italic"}>Generating title...</span>
        ) : (
          <span className="min-w-0 truncate">{session.title}</span>
        )}
      </button>

      <div className="absolute end-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-all group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md text-sidebar-foreground/60 hover:bg-black/10 hover:text-sidebar-foreground dark:hover:bg-white/10"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
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
