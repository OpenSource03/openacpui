import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Plus, Settings, ChevronLeft, ChevronRight } from "lucide-react";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  // Space pending deletion — shown in confirmation dialog
  const [deleteSpace, setDeleteSpace] = useState<Space | null>(null);

  // Scroll overflow detection for arrow buttons
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 1px tolerance for sub-pixel rounding
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState, sorted.length]);

  // Scroll by one space button width (2rem + gap)
  const scrollByOne = useCallback((direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * 36, behavior: "smooth" });
  }, []);

  // Gradient mask fades out edge icons when more content is scrollable
  const fadeMask = useMemo<React.CSSProperties>(() => {
    const FADE = "20px";
    if (canScrollLeft && canScrollRight) {
      return { maskImage: `linear-gradient(to right, transparent, black ${FADE}, black calc(100% - ${FADE}), transparent)` };
    }
    if (canScrollLeft) {
      return { maskImage: `linear-gradient(to right, transparent, black ${FADE})` };
    }
    if (canScrollRight) {
      return { maskImage: `linear-gradient(to left, transparent, black ${FADE})` };
    }
    return {};
  }, [canScrollLeft, canScrollRight]);

  const handleContextMenu = useCallback((e: React.MouseEvent, space: Space) => {
    e.preventDefault();
    setContextSpace(space);
    setContextPos({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContext = useCallback(() => setContextSpace(null), []);

  return (
    <div className="no-drag grid grid-cols-[2rem_1fr_2rem] items-end px-2 pt-1.5">
      {/* Settings gear — mirrors the + button on the right */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onOpenSettings}
            className="mb-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/40 transition-colors hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          >
            <Settings className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Settings
        </TooltipContent>
      </Tooltip>
      {/* Center group — flex row: [◂] [masked scroll area] [▸].
           Arrows sit outside the scroll container so they never cover icons.
           The mask fades edge icons to hint at more content. */}
      <div className="group/spaces flex min-w-0 items-end">
        {/* Left arrow — hidden until hover, only when scrollable left */}
        {canScrollLeft && (
          <button
            onClick={() => scrollByOne(-1)}
            className="mb-1.5 flex h-8 w-4 shrink-0 items-center justify-center text-sidebar-foreground/30 opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/spaces:opacity-100"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}

        <div
          ref={scrollRef}
          className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-1.5 scrollbar-none"
          style={fadeMask}
        >
          <div className="mx-auto flex w-fit items-center gap-1">
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
                      className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-all ${
                        isActive
                          ? "text-sidebar-foreground bg-sidebar-accent"
                          : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
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
        </div>

        {/* Right arrow — hidden until hover, only when scrollable right */}
        {canScrollRight && (
          <button
            onClick={() => scrollByOne(1)}
            className="mb-1.5 flex h-8 w-4 shrink-0 items-center justify-center text-sidebar-foreground/30 opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/spaces:opacity-100"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* + on far right */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onCreateSpace}
            className="mb-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/40 transition-colors hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
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
              onClick={() => { if (contextSpace) setDeleteSpace(contextSpace); closeContext(); }}
            >
              <Trash2 className="me-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteSpace !== null}
        onOpenChange={(open) => !open && setDeleteSpace(null)}
        onConfirm={() => { if (deleteSpace) onDeleteSpace(deleteSpace.id); }}
        title="Delete Space"
        description={
          <>
            Are you sure you want to delete{" "}
            <span className="font-medium text-foreground">{deleteSpace?.name}</span>?
            Projects in this space will be moved to General.
          </>
        }
        confirmLabel="Delete"
      />
    </div>
  );
});
