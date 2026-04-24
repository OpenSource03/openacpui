import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Plus, Settings, ChevronLeft, ChevronRight, Trash2, Pencil } from "lucide-react";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import { resolveLucideIcon } from "@/lib/icon-utils";
import { SimpleIconGlyph } from "@/components/SimpleIconGlyph";
import { SpaceCustomizer } from "./SpaceCustomizer";
import type { Space } from "@/types";

interface SpaceBarProps {
  spaces: Space[];
  activeSpaceId: string;
  onSelectSpace: (id: string) => void;
  onStartCreateSpace: () => void;
  onUpdateSpace: (id: string, updates: Partial<Pick<Space, "name" | "icon" | "iconType" | "color">>) => void;
  onDeleteSpace: (id: string) => void;
  onDropProject?: (projectId: string, spaceId: string) => void;
  onOpenSettings?: () => void;
  /** When non-null, a draft space is active — disable the + button */
  draftSpace?: Space | null;
}

export function SpaceIcon({ space, size = 18 }: { space: Space; size?: number }) {
  if (space.iconType === "emoji") {
    return <span style={{ fontSize: size - 2 }}>{space.icon}</span>;
  }
  if (space.iconType === "simple") {
    return <SimpleIconGlyph slug={space.icon} size={size} />;
  }
  const Icon = resolveLucideIcon(space.icon);
  if (!Icon) return <span style={{ fontSize: size - 2 }}>?</span>;
  return <Icon style={{ width: size, height: size }} />;
}

function getSpaceIndicatorStyle(space: Space) {
  if (space.color.chroma === 0) return { background: "currentColor" };
  const indicatorChroma = Math.min(space.color.chroma, 0.22);
  if (space.color.gradientHue !== undefined) {
    return {
      background: `linear-gradient(135deg, oklch(0.6 ${indicatorChroma} ${space.color.hue}), oklch(0.6 ${indicatorChroma} ${space.color.gradientHue}))`,
    };
  }
  return {
    background: `oklch(0.6 ${indicatorChroma} ${space.color.hue})`,
  };
}

export const SpaceBar = memo(function SpaceBar({
  spaces,
  activeSpaceId,
  onSelectSpace,
  onStartCreateSpace,
  onUpdateSpace,
  onDeleteSpace,
  onDropProject,
  onOpenSettings,
  draftSpace,
}: SpaceBarProps) {
  const isCreatingSpace = draftSpace != null;
  const sorted = [...spaces].sort((a, b) => a.order - b.order);
  const [contextSpace, setContextSpace] = useState<Space | null>(null);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const [dragOverSpaceId, setDragOverSpaceId] = useState<string | null>(null);
  const [deleteSpace, setDeleteSpace] = useState<Space | null>(null);

  // ── Popover for editing existing spaces ──
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const spaceButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const anchorRef = useRef<HTMLDivElement>(null);

  const editingSpace = editingSpaceId
    ? spaces.find((s) => s.id === editingSpaceId) ?? null
    : null;

  const openEditPopover = useCallback((space: Space) => {
    setEditingSpaceId(space.id);
    setEditName(space.name);
  }, []);

  const closeEditPopover = useCallback(() => {
    if (editingSpaceId && editName.trim()) {
      const current = spaces.find((s) => s.id === editingSpaceId);
      if (current && editName.trim() !== current.name) {
        onUpdateSpace(editingSpaceId, { name: editName.trim() });
      }
    }
    setEditingSpaceId(null);
  }, [editingSpaceId, editName, spaces, onUpdateSpace]);

  useEffect(() => {
    if (!editingSpaceId || !anchorRef.current) return;
    const btn = spaceButtonRefs.current.get(editingSpaceId);
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const anchor = anchorRef.current;
    anchor.style.position = "fixed";
    anchor.style.left = `${rect.left + rect.width / 2}px`;
    anchor.style.top = `${rect.top}px`;
    anchor.style.width = "1px";
    anchor.style.height = "1px";
  }, [editingSpaceId, spaces]);

  // Scroll overflow detection
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
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

  const scrollByOne = useCallback((direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * 36, behavior: "smooth" });
  }, []);

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
      {/* Settings gear */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onOpenSettings}
            className="mb-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sidebar-foreground/40 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
          >
            <Settings className="h-4.5 w-4.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Settings
        </TooltipContent>
      </Tooltip>

      {/* Center — scrollable space icons */}
      <div className="group/spaces flex min-w-0 items-end">
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
                      ref={(el) => {
                        if (el) spaceButtonRefs.current.set(space.id, el);
                        else spaceButtonRefs.current.delete(space.id);
                      }}
                      onClick={() => onSelectSpace(space.id)}
                      onDoubleClick={() => openEditPopover(space)}
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
                      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all ${
                        isActive
                          ? "bg-black/10 text-sidebar-foreground shadow-sm dark:bg-white/15"
                          : "text-sidebar-foreground/60 hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
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

        {canScrollRight && (
          <button
            onClick={() => scrollByOne(1)}
            className="mb-1.5 flex h-8 w-4 shrink-0 items-center justify-center text-sidebar-foreground/30 opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/spaces:opacity-100"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* + button — enters draft creation mode in sidebar */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onStartCreateSpace}
            disabled={isCreatingSpace}
            className="mb-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sidebar-foreground/40 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
          >
            <Plus className="h-4.5 w-4.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          New space
        </TooltipContent>
      </Tooltip>

      {/* ── Edit popover (for existing spaces) ── */}
      <Popover
        open={editingSpaceId !== null}
        onOpenChange={(open) => {
          if (!open) closeEditPopover();
        }}
      >
        <PopoverAnchor ref={anchorRef} className="pointer-events-none" />
        <PopoverContent
          side="top"
          sideOffset={12}
          align="center"
          className="w-72"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {editingSpace && (
            <SpaceCustomizer
              icon={editingSpace.icon}
              iconType={editingSpace.iconType}
              color={editingSpace.color}
              onUpdateIcon={(ic, it) => onUpdateSpace(editingSpace.id, { icon: ic, iconType: it })}
              onUpdateColor={(c) => onUpdateSpace(editingSpace.id, { color: c })}
              editMode={{
                name: editName,
                onUpdateName: setEditName,
                onDelete: editingSpace.id !== "default"
                  ? () => { setDeleteSpace(editingSpace); setEditingSpaceId(null); }
                  : undefined,
              }}
            />
          )}
        </PopoverContent>
      </Popover>

      {/* Right-click context menu */}
      <DropdownMenu open={!!contextSpace} onOpenChange={(open) => !open && closeContext()}>
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
          <DropdownMenuItem onClick={() => { if (contextSpace) openEditPopover(contextSpace); closeContext(); }}>
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
