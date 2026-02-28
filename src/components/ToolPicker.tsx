import { memo, useCallback, useMemo, useState } from "react";
import { Terminal, Globe, GitBranch, FileText, ListTodo, Bot, Plug, SquareArrowOutUpRight, FileDiff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ToolId = "terminal" | "browser" | "git" | "files" | "tasks" | "agents" | "mcp" | "changes";

interface ToolDef {
  id: ToolId;
  label: string;
  icon: typeof Terminal;
}

const PANEL_TOOLS_MAP: Record<string, ToolDef> = {
  terminal: { id: "terminal", label: "Terminal", icon: Terminal },
  browser: { id: "browser", label: "Browser", icon: Globe },
  git: { id: "git", label: "Source Control", icon: GitBranch },
  files: { id: "files", label: "Open Files", icon: FileText },
  mcp: { id: "mcp", label: "MCP Servers", icon: Plug },
  changes: { id: "changes", label: "Changes", icon: FileDiff },
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
  onReorder: (fromId: ToolId, toId: ToolId) => void;
  /** Current project directory — enables "Open in Editor" button */
  projectPath?: string;
}

export const ToolPicker = memo(function ToolPicker({ activeTools, onToggle, availableContextual, toolOrder, onReorder, projectPath }: ToolPickerProps) {
  const visibleContextual = useMemo(
    () => CONTEXTUAL_TOOLS.filter((t) => availableContextual?.has(t.id)),
    [availableContextual],
  );

  // Panel tools ordered by toolOrder, falling back to map for unknown ids
  const orderedPanelTools = useMemo(
    () => toolOrder.filter((id) => id in PANEL_TOOLS_MAP).map((id) => PANEL_TOOLS_MAP[id]),
    [toolOrder],
  );

  // Track which button is being dragged over for visual feedback
  const [dragOverId, setDragOverId] = useState<ToolId | null>(null);
  const [draggingId, setDraggingId] = useState<ToolId | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, toolId: ToolId) => {
    e.dataTransfer.setData("text/plain", toolId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(toolId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, toolId: ToolId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(toolId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toId: ToolId) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain") as ToolId;
    setDragOverId(null);
    setDraggingId(null);
    if (fromId && fromId !== toId) {
      onReorder(fromId, toId);
    }
  }, [onReorder]);

  const handleDragEnd = useCallback(() => {
    setDragOverId(null);
    setDraggingId(null);
  }, []);

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

  return (
    <div className="island relative flex h-full w-14 shrink-0 flex-col items-center rounded-lg bg-background pt-3 pb-3 gap-2">
      <div className="drag-region absolute inset-x-0 top-0 h-2" />
      {visibleContextual.length > 0 && (
        <>
          {visibleContextual.map((tool) => {
            const Icon = tool.icon;
            const isActive = activeTools.has(tool.id);
            return (
              <Tooltip key={tool.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onToggle(tool.id)}
                    className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200 cursor-pointer ${
                      isActive
                        ? "bg-foreground/10 text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-foreground/[0.08]"
                        : "text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.05]"
                    }`}
                  >
                    <Icon className="h-5 w-5" strokeWidth={isActive ? 2 : 1.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8}>
                  <p className="text-xs font-medium">{tool.label}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
          <Separator className="w-7 my-0.5" />
        </>
      )}
      {orderedPanelTools.map((tool) => {
        const Icon = tool.icon;
        const isActive = activeTools.has(tool.id);
        const isDragTarget = dragOverId === tool.id && draggingId !== tool.id;
        return (
          <Tooltip key={tool.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onToggle(tool.id)}
                draggable
                onDragStart={(e) => handleDragStart(e, tool.id)}
                onDragOver={(e) => handleDragOver(e, tool.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, tool.id)}
                onDragEnd={handleDragEnd}
                className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200 cursor-pointer ${
                  isActive
                    ? "bg-foreground/10 text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-foreground/[0.08]"
                    : "text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.05]"
                } ${isDragTarget ? "ring-2 ring-foreground/20" : ""}`}
              >
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2 : 1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={8}>
              <p className="text-xs font-medium">{tool.label}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}

      {/* Open project in preferred editor — pushed to the bottom */}
      {projectPath && (
        <div className="mt-auto">
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
                    className="flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200 cursor-pointer
                      text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.05]"
                  >
                    <SquareArrowOutUpRight className="h-5 w-5" strokeWidth={1.5} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={8}>
                <p className="text-xs font-medium">Open in Editor</p>
                <p className="text-[10px] text-background/50">Right-click for options</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="left" align="end" sideOffset={8}>
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
  );
});
