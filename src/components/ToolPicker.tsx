import { memo, useCallback, useMemo, useState } from "react";
import { Terminal, Globe, GitBranch, FileText, FolderTree, ListTodo, Bot, Plug, SquareArrowOutUpRight, ArrowDown, ArrowRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettingsStore } from "@/stores/settings-store";
import type { ToolId, ToolDef } from "@/types/tools";

// Re-export for backward compatibility — consumers importing from ToolPicker continue to work
export type { ToolId, ToolDef } from "@/types/tools";

/** SVG circular progress ring that wraps the tool icon button. */
function ToolProgressRing({ progress, isComplete, size }: { progress: number; isComplete: boolean; size: number }) {
  const radius = (size - 3) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="pointer-events-none absolute inset-0 -rotate-90"
    >
      {/* Track */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="text-foreground/[0.06]"
      />
      {/* Progress arc */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={isComplete ? "rgb(52, 211, 153)" : "rgb(96, 165, 250)"}
        strokeOpacity={isComplete ? 0.8 : 0.6}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 700ms ease-out, stroke 300ms ease-out" }}
      />
    </svg>
  );
}

/** Very subtle per-tool color tints. Uses *-500 for light mode (visible on white) and *-200 for dark mode (soft pastels on dark). */
const TOOL_TINTS: Record<string, { idle: string; hover: string; active: string }> = {
  terminal:        { idle: "text-emerald-600/70 dark:text-emerald-200/50",  hover: "hover:text-emerald-600/90 dark:hover:text-emerald-200/70",  active: "text-emerald-600 dark:text-emerald-200/90" },
  browser:         { idle: "text-sky-600/70 dark:text-sky-200/50",          hover: "hover:text-sky-600/90 dark:hover:text-sky-200/70",          active: "text-sky-600 dark:text-sky-200/90" },
  git:             { idle: "text-orange-600/70 dark:text-orange-200/50",    hover: "hover:text-orange-600/90 dark:hover:text-orange-200/70",    active: "text-orange-600 dark:text-orange-200/90" },
  files:           { idle: "text-amber-600/70 dark:text-amber-200/50",      hover: "hover:text-amber-600/90 dark:hover:text-amber-200/70",     active: "text-amber-600 dark:text-amber-200/90" },
  "project-files": { idle: "text-teal-600/70 dark:text-teal-200/50",       hover: "hover:text-teal-600/90 dark:hover:text-teal-200/70",       active: "text-teal-600 dark:text-teal-200/90" },
  mcp:             { idle: "text-violet-600/70 dark:text-violet-200/50",    hover: "hover:text-violet-600/90 dark:hover:text-violet-200/70",   active: "text-violet-600 dark:text-violet-200/90" },
  tasks:           { idle: "text-blue-600/70 dark:text-blue-200/50",        hover: "hover:text-blue-600/90 dark:hover:text-blue-200/70",       active: "text-blue-600 dark:text-blue-200/90" },
  agents:          { idle: "text-indigo-600/70 dark:text-indigo-200/50",    hover: "hover:text-indigo-600/90 dark:hover:text-indigo-200/70",   active: "text-indigo-600 dark:text-indigo-200/90" },
};

export const PANEL_TOOLS_MAP: Record<string, ToolDef> = {
  terminal: { id: "terminal", label: "Terminal", icon: Terminal },
  browser: { id: "browser", label: "Browser", icon: Globe },
  git: { id: "git", label: "Source Control", icon: GitBranch },
  files: { id: "files", label: "Open Files", icon: FileText },
  "project-files": { id: "project-files", label: "Project Files", icon: FolderTree },
  mcp: { id: "mcp", label: "MCP Servers", icon: Plug },
};

const CONTEXTUAL_TOOLS: ToolDef[] = [
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "agents", label: "Background Agents", icon: Bot },
];

interface ToolPickerProps {
  activeTools: Set<ToolId>;
  onToggle: (toolId: ToolId) => void;
  /** Which contextual tools have data and should be shown */
  availableContextual?: Set<ToolId>;
  /** Display order of panel tools — drives render order and drag reordering */
  toolOrder: ToolId[];
  /** Optional transient drag-preview order rendered instead of the persisted order. */
  displayToolOrder?: ToolId[];
  /** Optional transient drag-preview bottom placement set. */
  displayBottomTools?: ReadonlySet<ToolId>;
  onReorder: (fromId: ToolId, toId: ToolId) => void;
  panelInteractionMode?: "legacy" | "workspace";
  onPanelToolDragStart?: (event: React.DragEvent<HTMLDivElement>, toolId: ToolId) => void;
  onPanelToolDragEnd?: () => void;
  /** Current project directory — enables "Open in Editor" button */
  projectPath?: string;
  /** Tools placed in the bottom row */
  bottomTools: Set<ToolId>;
  onMoveToBottom: (id: ToolId) => void;
  onMoveToSide: (id: ToolId) => void;
  /** Task completion progress for the tasks icon ring */
  taskProgress?: { completed: number; total: number };
}

/** Single tool button with active indicator and hover feedback. Drag is handled by the outer wrapper. */
function ToolButton({
  tool,
  isActive,
  coloredIcons = true,
  isDragTarget,
  isBottom,
  badge,
  tooltipExtra,
  onClick,
}: {
  tool: ToolDef;
  isActive: boolean;
  coloredIcons?: boolean;
  isDragTarget?: boolean;
  isBottom?: boolean;
  badge?: React.ReactNode;
  tooltipExtra?: React.ReactNode;
  onClick: () => void;
}) {
  const Icon = tool.icon;
  const buttonSize = "h-8 w-8";
  const iconSize = "h-4 w-4";
  const radius = "rounded-lg";
  const tint = coloredIcons ? TOOL_TINTS[tool.id] : undefined;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={`tool-picker-btn group/btn relative mx-auto flex ${buttonSize} items-center justify-center ${radius} overflow-visible p-0 transition-all duration-200 cursor-pointer ${
            isActive
              ? `tool-picker-btn-active bg-foreground/[0.08] ${tint?.active ?? "text-foreground"} shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_1px_2px_0_rgba(0,0,0,0.05)]`
              : `${tint?.idle ?? "text-foreground/35"} ${tint?.hover ?? "hover:text-foreground/70"} hover:bg-foreground/[0.05] active:scale-[0.92]`
          } ${isDragTarget ? "ring-2 ring-foreground/20 ring-offset-1 ring-offset-background" : ""}`}
        >
          <Icon
            className={`${iconSize} transition-transform duration-200 ${!isActive ? "group-hover/btn:scale-110" : ""}`}
            strokeWidth={isActive ? 2 : 1.5}
          />
          {badge}
          {/* Bottom placement indicator — small dot */}
          {isBottom && !badge && (
            <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-foreground/25" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={10}>
        <p className="text-xs font-medium">{tool.label}</p>
        {tooltipExtra}
        {isBottom && <p className="text-[10px] text-background/50">Bottom panel</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Panel tool button wrapped with a right-click context menu for placement (bottom / side). */
function PanelToolWithMenu({
  tool,
  isActive,
  coloredIcons,
  isDragTarget,
  isBottom,
  badge,
  tooltipExtra,
  onToggle,
  onMoveToBottom,
  onMoveToSide,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  moveToBottomLabel = "Move to Bottom",
  moveToSideLabel = "Move to Side",
}: {
  tool: ToolDef;
  isActive: boolean;
  coloredIcons: boolean;
  isDragTarget: boolean;
  isBottom: boolean;
  badge?: React.ReactNode;
  tooltipExtra?: React.ReactNode;
  onToggle: () => void;
  onMoveToBottom: () => void;
  onMoveToSide: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  moveToBottomLabel?: string;
  moveToSideLabel?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(true);
  }, []);

  /* The DropdownMenuTrigger with asChild injects onPointerDown that calls
     preventDefault(), which kills native HTML drag-and-drop. To fix:
     - Drag attrs go on the outer div (no Radix interference)
     - Context menu is handled manually via open state
     - DropdownMenuTrigger is a hidden overlay (pointer-events-none) used
       only as a positioning anchor for the menu content */
  return (
    <div
      className="relative"
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onContextMenu={handleContextMenu}
    >
      <ToolButton
        tool={tool}
        isActive={isActive}
        coloredIcons={coloredIcons}
        isDragTarget={isDragTarget}
        isBottom={isBottom}
        badge={badge}
        tooltipExtra={tooltipExtra}
        onClick={onToggle}
      />
      <DropdownMenu open={menuOpen} onOpenChange={(open) => { if (!open) setMenuOpen(false); }}>
        {/* Hidden trigger — positioned over the button for correct menu placement */}
        <DropdownMenuTrigger className="absolute inset-0 opacity-0 pointer-events-none" tabIndex={-1} />
        <DropdownMenuContent side="left" align="start" sideOffset={10}>
          <DropdownMenuItem disabled className="text-[11px] font-semibold tracking-wide text-foreground/50 uppercase">
            {tool.label}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isBottom ? (
            <DropdownMenuItem onClick={onMoveToSide} className="gap-2">
              <ArrowRight className="h-3.5 w-3.5" />
              {moveToSideLabel}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onMoveToBottom} className="gap-2">
              <ArrowDown className="h-3.5 w-3.5" />
              {moveToBottomLabel}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export const ToolPicker = memo(function ToolPicker({
  activeTools,
  onToggle,
  availableContextual,
  toolOrder,
  displayToolOrder,
  displayBottomTools,
  onReorder,
  panelInteractionMode = "legacy",
  onPanelToolDragStart,
  onPanelToolDragEnd,
  projectPath,
  bottomTools,
  onMoveToBottom,
  onMoveToSide,
  taskProgress,
}: ToolPickerProps) {
  // ── Layout & appearance settings from Zustand store ──
  const islandLayout = useSettingsStore((s) => s.islandLayout);
  const transparentBackground = useSettingsStore((s) => s.transparentToolPicker);
  const coloredIcons = useSettingsStore((s) => s.coloredSidebarIcons);
  const visibleContextual = useMemo(
    () => CONTEXTUAL_TOOLS.filter((t) => availableContextual?.has(t.id)),
    [availableContextual],
  );

  // Panel tools ordered by toolOrder, falling back to map for unknown ids
  const orderedPanelTools = useMemo(
    () => (displayToolOrder ?? toolOrder).filter((id) => id in PANEL_TOOLS_MAP).map((id) => PANEL_TOOLS_MAP[id]),
    [displayToolOrder, toolOrder],
  );
  const effectiveBottomTools = displayBottomTools ?? bottomTools;
  const sidePanelTools = useMemo(
    () => orderedPanelTools.filter((tool) => !effectiveBottomTools.has(tool.id)),
    [effectiveBottomTools, orderedPanelTools],
  );
  const bottomPanelTools = useMemo(
    () => orderedPanelTools.filter((tool) => effectiveBottomTools.has(tool.id)),
    [effectiveBottomTools, orderedPanelTools],
  );

  // Track which button is being dragged over for visual feedback
  const [dragOverId, setDragOverId] = useState<ToolId | null>(null);
  const [draggingId, setDraggingId] = useState<ToolId | null>(null);
  const workspaceMode = panelInteractionMode === "workspace";

  const handleDragStart = useCallback((e: React.DragEvent, toolId: ToolId) => {
    if (workspaceMode) {
      onPanelToolDragStart?.(e as React.DragEvent<HTMLDivElement>, toolId);
      return;
    }
    e.dataTransfer.setData("text/plain", toolId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(toolId);
  }, [onPanelToolDragStart, workspaceMode]);

  const handleDragOver = useCallback((e: React.DragEvent, toolId: ToolId) => {
    if (workspaceMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(toolId);
  }, [workspaceMode]);

  const handleDragLeave = useCallback(() => {
    if (workspaceMode) return;
    setDragOverId(null);
  }, [workspaceMode]);

  const handleDrop = useCallback((e: React.DragEvent, toId: ToolId) => {
    if (workspaceMode) return;
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain") as ToolId;
    setDragOverId(null);
    setDraggingId(null);
    if (fromId && fromId !== toId) {
      onReorder(fromId, toId);
    }
  }, [onReorder, workspaceMode]);

  const handleDragEnd = useCallback(() => {
    setDragOverId(null);
    setDraggingId(null);
    onPanelToolDragEnd?.();
  }, [onPanelToolDragEnd]);

  const handleOpenInEditor = useCallback(() => {
    if (projectPath) window.claude.openInEditor(projectPath);
  }, [projectPath]);

  // Right-click menu state — controlled DropdownMenu opened on contextMenu
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);

  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEditorMenuOpen(true);
  }, []);

  const handleOpenWithEditor = useCallback(
    (editor: string) => {
      if (projectPath) window.claude.openInEditor(projectPath, undefined, editor);
    },
    [projectPath],
  );

  const pickerClassName = islandLayout
    ? `tool-picker ${transparentBackground ? "" : "island "}relative flex h-full shrink-0 flex-col items-center gap-0.5${transparentBackground ? "" : " rounded-[var(--island-radius)] bg-background"} pt-2 pb-2`
    : `tool-picker ${transparentBackground ? "" : "island "}relative flex h-full w-11 shrink-0 flex-col items-center gap-0.5${transparentBackground ? "" : " rounded-lg bg-background"} pt-2 pb-2`;
  const pickerStyle = islandLayout ? { width: "var(--tool-picker-strip-width)" } : undefined;

  const editorButtonSize = "h-8 w-8";
  const editorIconSize = "h-4 w-4";
  const editorRadius = "rounded-lg";

  return (
    <div className={pickerClassName} style={pickerStyle}>
      <div className="drag-region absolute inset-x-0 top-0 h-2" />

      {/* Contextual tools (Tasks, Agents) — shown only when data exists */}
      {visibleContextual.length > 0 && (
        <>
          {visibleContextual.map((tool) => {
            const hasTaskProgress = tool.id === "tasks" && taskProgress && taskProgress.total > 0;
            const progressFraction = hasTaskProgress ? taskProgress.completed / taskProgress.total : 0;
            const isComplete = hasTaskProgress ? taskProgress.completed === taskProgress.total : false;
            const ringSize = 32;

            return (
              <div key={tool.id} className="relative">
                {hasTaskProgress && (
                  <ToolProgressRing progress={progressFraction} isComplete={isComplete} size={ringSize} />
                )}
                <ToolButton
                  tool={tool}
                  isActive={activeTools.has(tool.id)}
                  coloredIcons={coloredIcons}
                  onClick={() => onToggle(tool.id)}
                  tooltipExtra={hasTaskProgress ? (
                    <p className="text-[10px] text-background/50 tabular-nums">
                      {taskProgress.completed}/{taskProgress.total} completed
                    </p>
                  ) : undefined}
                />
              </div>
            );
          })}
          {/* Divider between contextual and panel tools */}
          <div className="my-0.5 w-5">
            <div className="h-px w-full bg-foreground/[0.08]" />
          </div>
        </>
      )}

      {/* Panel tools — draggable, reorderable, with right-click placement menu */}
      {sidePanelTools.map((tool) => (
        <PanelToolWithMenu
          key={tool.id}
          tool={tool}
          isActive={activeTools.has(tool.id)}
          coloredIcons={coloredIcons}
          isDragTarget={dragOverId === tool.id && draggingId !== tool.id}
          isBottom={false}
          onToggle={() => onToggle(tool.id)}
          onMoveToBottom={() => onMoveToBottom(tool.id)}
          onMoveToSide={() => onMoveToSide(tool.id)}
          onDragStart={(e) => handleDragStart(e, tool.id)}
          onDragOver={workspaceMode ? undefined : (e) => handleDragOver(e, tool.id)}
          onDragLeave={workspaceMode ? undefined : handleDragLeave}
          onDrop={workspaceMode ? undefined : (e) => handleDrop(e, tool.id)}
          onDragEnd={handleDragEnd}
          moveToSideLabel="Move to Top Row"
        />
      ))}

      <div className="mt-auto flex w-full flex-col items-center">
        {bottomPanelTools.length > 0 && (
          <>
            <div className="mb-1 w-5">
              <div className="h-px w-full bg-foreground/[0.08]" />
            </div>
            <div className="flex w-full flex-col items-center gap-0.5">
              {bottomPanelTools.map((tool) => (
                <PanelToolWithMenu
                  key={tool.id}
                  tool={tool}
                  isActive={activeTools.has(tool.id)}
                  coloredIcons={coloredIcons}
                  isDragTarget={dragOverId === tool.id && draggingId !== tool.id}
                  isBottom={true}
                  onToggle={() => onToggle(tool.id)}
                  onMoveToBottom={() => onMoveToBottom(tool.id)}
                  onMoveToSide={() => onMoveToSide(tool.id)}
                  onDragStart={(e) => handleDragStart(e, tool.id)}
                  onDragOver={workspaceMode ? undefined : (e) => handleDragOver(e, tool.id)}
                  onDragLeave={workspaceMode ? undefined : handleDragLeave}
                  onDrop={workspaceMode ? undefined : (e) => handleDrop(e, tool.id)}
                  onDragEnd={handleDragEnd}
                  moveToSideLabel="Move to Top Row"
                />
              ))}
            </div>
          </>
        )}

        {/* Open project in preferred editor — pinned under bottom-docked tools */}
        {projectPath && (
          <div className="mt-1.5 flex w-full flex-col items-center">
            <div className="mb-1 w-5">
              <div className="h-px w-full bg-foreground/[0.06]" />
            </div>
            {/* Only allow closing via onOpenChange — opening is handled by our contextMenu handler
                so that left-click goes straight to the editor without showing the menu */}
            <DropdownMenu open={editorMenuOpen} onOpenChange={(open) => { if (!open) setEditorMenuOpen(false); }}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={handleOpenInEditor}
                      onContextMenu={handleEditorContextMenu}
                      className={`tool-picker-btn group/btn relative mx-auto flex ${editorButtonSize} items-center justify-center ${editorRadius} p-0 transition-all duration-200 cursor-pointer text-foreground/30 hover:text-foreground/60 hover:bg-foreground/[0.05] active:scale-[0.92]`}
                    >
                      <SquareArrowOutUpRight
                        className={`${editorIconSize} transition-transform duration-200 group-hover/btn:scale-110`}
                        strokeWidth={1.5}
                      />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={10}>
                  <p className="text-xs font-medium">Open in Editor</p>
                  <p className="text-[10px] text-background/50">Right-click for options</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="left" align="end" sideOffset={10}>
                <DropdownMenuItem onClick={() => handleOpenWithEditor("cursor")}>
                  Cursor
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleOpenWithEditor("code")}>
                  VS Code
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleOpenWithEditor("zed")}>
                  Zed
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
});
