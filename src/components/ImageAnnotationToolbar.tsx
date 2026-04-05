import React from "react";
import {
  MousePointer2,
  Pencil,
  Square,
  Circle,
  MoveUpRight,
  Type,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import type { AnnotationTool } from "@/lib/chat/annotation-types";
import { ANNOTATION_COLORS } from "@/lib/chat/annotation-types";

interface ImageAnnotationToolbarProps {
  activeTool: AnnotationTool;
  onToolChange: (tool: AnnotationTool) => void;
  strokeColor: string;
  onStrokeColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

const TOOLS: Array<{ tool: AnnotationTool; icon: React.ElementType; label: string }> = [
  { tool: "select", icon: MousePointer2, label: "Select" },
  { tool: "freehand", icon: Pencil, label: "Freehand" },
  { tool: "rectangle", icon: Square, label: "Rectangle" },
  { tool: "circle", icon: Circle, label: "Circle" },
  { tool: "arrow", icon: MoveUpRight, label: "Arrow" },
  { tool: "text", icon: Type, label: "Text" },
  { tool: "highlight", icon: Highlighter, label: "Highlight" },
  { tool: "eraser", icon: Eraser, label: "Eraser" },
];

export const ImageAnnotationToolbar = React.memo(function ImageAnnotationToolbar({
  activeTool,
  onToolChange,
  strokeColor,
  onStrokeColorChange,
  strokeWidth,
  onStrokeWidthChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: ImageAnnotationToolbarProps) {
  // Color/stroke controls are irrelevant for non-drawing tools
  const showColorPicker = activeTool !== "eraser" && activeTool !== "select";
  const showStrokeWidth = showColorPicker && activeTool !== "text";

  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/30 px-1.5 py-1">
      <div className="flex items-center gap-0.5">
        {TOOLS.map(({ tool, icon: Icon, label }) => (
          <Tooltip key={tool}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={activeTool === tool ? "bg-accent text-accent-foreground" : "text-muted-foreground"}
                onClick={() => onToolChange(tool)}
              >
                <Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{label}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="mx-1 h-5 w-px bg-border/50" />

      {showColorPicker && (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="relative">
                  <div
                    className="h-4 w-4 rounded-full border border-border/60 shadow-sm"
                    style={{ backgroundColor: strokeColor }}
                  />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Color</p>
            </TooltipContent>
          </Tooltip>
          <PopoverContent className="w-auto p-2" side="bottom" align="start">
            <div className="grid grid-cols-4 gap-1.5">
              {ANNOTATION_COLORS.map((color) => (
                <button
                  key={color}
                  className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                    strokeColor === color ? "border-foreground scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => onStrokeColorChange(color)}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => onStrokeColorChange(e.target.value)}
                className="h-6 w-6 cursor-pointer rounded border-none bg-transparent p-0"
              />
              <span className="text-xs text-muted-foreground">Custom</span>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {showStrokeWidth && (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
                  <div className="flex h-4 w-4 items-center justify-center">
                    <div
                      className="rounded-full bg-foreground"
                      style={{
                        width: Math.max(4, strokeWidth + 2),
                        height: Math.max(4, strokeWidth + 2),
                      }}
                    />
                  </div>
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Stroke width: {strokeWidth}px</p>
            </TooltipContent>
          </Tooltip>
          <PopoverContent className="w-44 p-3" side="bottom" align="start">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Stroke width</p>
              <Slider
                min={1}
                max={12}
                step={1}
                value={[strokeWidth]}
                onValueChange={([val]) => onStrokeWidthChange(val)}
              />
              <p className="text-center text-xs font-medium">{strokeWidth}px</p>
            </div>
          </PopoverContent>
        </Popover>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={!canUndo} onClick={onUndo} className="text-muted-foreground">
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Undo</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={!canRedo} onClick={onRedo} className="text-muted-foreground">
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Redo</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});
