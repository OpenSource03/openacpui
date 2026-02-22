import { memo, useState, useCallback } from "react";
import { Plus, Settings } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Pencil, Trash2 } from "lucide-react";
import { resolveLucideIcon } from "@/lib/icon-utils";
import type { Space } from "@/types";

interface SpaceBarProps {
  spaces: Space[];
  activeSpaceId: string;
  onSelectSpace: (id: string) => void;
  onCreateSpace: () => void;
  onEditSpace: (space: Space) => void;
  onDeleteSpace: (id: string) => void;
  onDropProject?: (projectId: string, spaceId: string) => void;
  onOpenSettings?: () => void;
}

function SpaceIcon({ space, size = 18 }: { space: Space; size?: number }) {
  if (space.iconType === "emoji") {
    return <span style={{ fontSize: size - 2 }}>{space.icon}</span>;
  }
  const Icon = resolveLucideIcon(space.icon);
  if (!Icon) return <span style={{ fontSize: size - 2 }}>?</span>;
  return <Icon style={{ width: size, height: size }} />;
}

function getSpaceIndicatorStyle(space: Space) {
  if (space.color.chroma === 0) return { background: "currentColor" };
  if (space.color.gradientHue !== undefined) {
    return {
      background: `linear-gradient(135deg, oklch(0.6 0.15 ${space.color.hue}), oklch(0.6 0.15 ${space.color.gradientHue}))`,
    };
  }
  return {
    background: `oklch(0.6 ${Math.min(space.color.chroma, 0.15)} ${space.color.hue})`,
  };
}

export const SpaceBar = memo(function SpaceBar({
  spaces,
  activeSpaceId,
  onSelectSpace,
  onCreateSpace,
  onEditSpace,
  onDeleteSpace,
  onDropProject,
  onOpenSettings,
}: SpaceBarProps) {
  const sorted = [...spaces].sort((a, b) => a.order - b.order);
  const [contextSpace, setContextSpace] = useState<Space | null>(null);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const [dragOverSpaceId, setDragOverSpaceId] = useState<string | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, space: Space) => {
    e.preventDefault();
    setContextSpace(space);
    setContextPos({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContext = useCallback(() => setContextSpace(null), []);

  return (
    <div className="no-drag grid grid-cols-[2rem_1fr_2rem] items-center px-2 py-1.5">
      {/* Settings gear — mirrors the + button on the right */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onOpenSettings}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/30 transition-colors hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          >
            <Settings className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Settings
        </TooltipContent>
      </Tooltip>
      {/* Center group */}
      <div className="flex items-center justify-center gap-1">
        {sorted.map((space) => {
          const isActive = space.id === activeSpaceId;
          const isDragOver = dragOverSpaceId === space.id;
          return (
            <Tooltip key={space.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelectSpace(space.id)}
                  onContextMenu={(e) => handleContextMenu(e, space)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverSpaceId(space.id);
                  }}
                  onDragLeave={() => setDragOverSpaceId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverSpaceId(null);
                    const projectId = e.dataTransfer.getData("application/x-project-id");
                    if (projectId && onDropProject) {
                      onDropProject(projectId, space.id);
                    }
                  }}
                  className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-all ${
                    isActive
                      ? "text-sidebar-foreground bg-sidebar-accent"
                      : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  } ${isDragOver ? "ring-2 ring-primary scale-110" : ""}`}
                >
                  <SpaceIcon space={space} />
                  {isActive && (
                    <div
                      className="absolute -bottom-1 h-0.5 w-4 rounded-full"
                      style={getSpaceIndicatorStyle(space)}
                    />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {space.name}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* + on far right */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onCreateSpace}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/30 transition-colors hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          >
            <Plus className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          New space
        </TooltipContent>
      </Tooltip>

      {/* Right-click context menu (positioned at cursor) */}
      <DropdownMenu open={!!contextSpace} onOpenChange={(open) => !open && closeContext()}>
        {/* Invisible anchor at cursor position */}
        <div
          className="fixed"
          style={{ left: contextPos.x, top: contextPos.y, width: 1, height: 1 }}
        />
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-36"
          style={{
            position: "fixed",
            left: contextPos.x,
            top: contextPos.y - 8,
            transform: "translateY(-100%)",
          }}
        >
          <DropdownMenuItem onClick={() => { if (contextSpace) onEditSpace(contextSpace); closeContext(); }}>
            <Pencil className="me-2 h-3.5 w-3.5" />
            Edit
          </DropdownMenuItem>
          {contextSpace?.id !== "default" && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => { if (contextSpace) onDeleteSpace(contextSpace.id); closeContext(); }}
            >
              <Trash2 className="me-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
