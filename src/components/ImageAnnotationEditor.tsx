import React, { useState, useEffect, useRef, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Ellipse, Arrow, Line, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ImageAnnotationToolbar } from "@/components/ImageAnnotationToolbar";
import { useAnnotationHistory } from "@/hooks/useAnnotationHistory";
import type { ImageAttachment } from "@/types";
import type { Annotation, AnnotationTool, FreehandAnnotation, RectAnnotation, CircleAnnotation, ArrowAnnotation, TextAnnotation } from "@/lib/chat/annotation-types";
import { DEFAULT_STROKE_COLOR, DEFAULT_STROKE_WIDTH, DEFAULT_FONT_SIZE, HIGHLIGHT_COLOR } from "@/lib/chat/annotation-types";

interface ImageAnnotationEditorProps {
  image: ImageAttachment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updatedImage: ImageAttachment) => void;
}

/** Generate a unique annotation ID. */
function annId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Check if a drawn shape has enough size to be worth committing (filters out accidental clicks). */
function hasVisibleSize(ann: Annotation): boolean {
  switch (ann.type) {
    case "freehand":
      return ann.points.length > 4;
    case "rectangle":
    case "highlight":
      return Math.abs(ann.width) > 2 || Math.abs(ann.height) > 2;
    case "circle":
      return ann.radiusX > 2 || ann.radiusY > 2;
    case "arrow": {
      const [x1, y1, x2, y2] = ann.points;
      return Math.abs(x2 - x1) > 2 || Math.abs(y2 - y1) > 2;
    }
    case "text":
      return true;
  }
}

export const ImageAnnotationEditor = React.memo(function ImageAnnotationEditor({
  image,
  open,
  onOpenChange,
  onSave,
}: ImageAnnotationEditorProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);

  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const img = new window.Image();
    img.src = `data:${image.mediaType};base64,${image.data}`;
    img.onload = () => setLoadedImage(img);
    return () => { img.onload = null; };
  }, [image.data, image.mediaType, open]);

  // Fit image to container preserving aspect ratio
  const [stageDims, setStageDims] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!loadedImage || !containerRef.current) return;

    function recalcSize() {
      if (!containerRef.current || !loadedImage) return;
      const maxW = containerRef.current.clientWidth;
      const maxH = containerRef.current.clientHeight;
      const ratio = loadedImage.width / loadedImage.height;

      if (maxW / maxH > ratio) {
        setStageDims({ width: Math.floor(maxH * ratio), height: maxH });
      } else {
        setStageDims({ width: maxW, height: Math.floor(maxW / ratio) });
      }
    }

    recalcSize();
    const ro = new ResizeObserver(recalcSize);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [loadedImage]);

  const { annotations, pushState, undo, redo, canUndo, canRedo, clear } =
    useAnnotationHistory(containerRef);

  const [activeTool, setActiveTool] = useState<AnnotationTool>("freehand");
  const [strokeColor, setStrokeColor] = useState(DEFAULT_STROKE_COLOR);
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_STROKE_WIDTH);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawingAnnotation, setDrawingAnnotation] = useState<Annotation | null>(null);

  const [textEditing, setTextEditing] = useState<{
    x: number;
    y: number;
    stageX: number;
    stageY: number;
  } | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textEditing && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [textEditing]);

  // Reset all state when dialog closes
  useEffect(() => {
    if (!open) {
      clear();
      setDrawingAnnotation(null);
      setSelectedId(null);
      setTextEditing(null);
      setActiveTool("freehand");
      setLoadedImage(null);
    }
  }, [open, clear]);

  useEffect(() => {
    setSelectedId(null);
    transformerRef.current?.nodes([]);
  }, [activeTool]);

  useEffect(() => {
    if (!selectedId || !transformerRef.current || !stageRef.current) return;
    const node = stageRef.current.findOne(`#${selectedId}`);
    if (node) {
      transformerRef.current.nodes([node]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [selectedId]);

  const handleMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const pos = e.target.getStage()?.getPointerPosition();
      if (!pos) return;

      // Eraser: remove the clicked annotation
      if (activeTool === "eraser") {
        const target = e.target;
        const id = target.id();
        if (id && annotations.some((a) => a.id === id)) {
          pushState(annotations.filter((a) => a.id !== id));
        }
        return;
      }

      // Select: handle click on shapes for transformer
      if (activeTool === "select") {
        const id = e.target.id();
        if (id && annotations.some((a) => a.id === id)) {
          setSelectedId(id);
        } else {
          setSelectedId(null);
          transformerRef.current?.nodes([]);
        }
        return;
      }

      // Text: show text input overlay at click position
      if (activeTool === "text") {
        const stage = e.target.getStage();
        if (!stage) return;
        const stageBox = stage.container().getBoundingClientRect();
        setTextEditing({
          x: stageBox.left + pos.x,
          y: stageBox.top + pos.y,
          stageX: pos.x,
          stageY: pos.y,
        });
        return;
      }

      // Start drawing a shape
      isDrawing.current = true;

      const baseProps = {
        id: annId(),
        strokeColor: activeTool === "highlight" ? HIGHLIGHT_COLOR : strokeColor,
        strokeWidth,
        opacity: 1,
      };

      switch (activeTool) {
        case "freehand": {
          const ann: FreehandAnnotation = {
            ...baseProps,
            type: "freehand",
            points: [pos.x, pos.y],
          };
          setDrawingAnnotation(ann);
          break;
        }
        case "rectangle":
        case "highlight": {
          const ann: RectAnnotation = {
            ...baseProps,
            type: activeTool,
            x: pos.x,
            y: pos.y,
            width: 0,
            height: 0,
            ...(activeTool === "highlight" ? { fill: HIGHLIGHT_COLOR, strokeWidth: 0, opacity: 1 } : {}),
          };
          setDrawingAnnotation(ann);
          break;
        }
        case "circle": {
          const ann: CircleAnnotation = {
            ...baseProps,
            type: "circle",
            x: pos.x,
            y: pos.y,
            radiusX: 0,
            radiusY: 0,
          };
          setDrawingAnnotation(ann);
          break;
        }
        case "arrow": {
          const ann: ArrowAnnotation = {
            ...baseProps,
            type: "arrow",
            points: [pos.x, pos.y, pos.x, pos.y],
          };
          setDrawingAnnotation(ann);
          break;
        }
      }
    },
    [activeTool, strokeColor, strokeWidth, annotations, pushState],
  );

  const handleMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (!isDrawing.current || !drawingAnnotation) return;
      const pos = e.target.getStage()?.getPointerPosition();
      if (!pos) return;

      switch (drawingAnnotation.type) {
        case "freehand":
          setDrawingAnnotation({
            ...drawingAnnotation,
            points: [...drawingAnnotation.points, pos.x, pos.y],
          });
          break;
        case "rectangle":
        case "highlight":
          setDrawingAnnotation({
            ...drawingAnnotation,
            width: pos.x - drawingAnnotation.x,
            height: pos.y - drawingAnnotation.y,
          });
          break;
        case "circle":
          setDrawingAnnotation({
            ...drawingAnnotation,
            radiusX: Math.abs(pos.x - drawingAnnotation.x),
            radiusY: Math.abs(pos.y - drawingAnnotation.y),
          });
          break;
        case "arrow":
          setDrawingAnnotation({
            ...drawingAnnotation,
            points: [drawingAnnotation.points[0], drawingAnnotation.points[1], pos.x, pos.y],
          });
          break;
      }
    },
    [drawingAnnotation],
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawing.current || !drawingAnnotation) return;
    isDrawing.current = false;

    if (hasVisibleSize(drawingAnnotation)) {
      pushState([...annotations, drawingAnnotation]);
    }
    setDrawingAnnotation(null);
  }, [drawingAnnotation, annotations, pushState]);

  const handleTextSubmit = useCallback(
    (value: string) => {
      if (!textEditing || !value.trim()) {
        setTextEditing(null);
        return;
      }
      const ann: TextAnnotation = {
        id: annId(),
        type: "text",
        strokeColor,
        strokeWidth: 0,
        opacity: 1,
        x: textEditing.stageX,
        y: textEditing.stageY,
        text: value.trim(),
        fontSize: DEFAULT_FONT_SIZE,
        fill: strokeColor,
      };
      pushState([...annotations, ann]);
      setTextEditing(null);
    },
    [textEditing, strokeColor, annotations, pushState],
  );

  const handleSave = useCallback(() => {
    if (!stageRef.current || !loadedImage) return;

    // Clear transformer handles before export, then wait one frame for the render to flush
    transformerRef.current?.nodes([]);
    setSelectedId(null);

    requestAnimationFrame(() => {
      if (!stageRef.current || !loadedImage) return;
      const pixelRatio = loadedImage.width / stageDims.width;
      const dataUrl = stageRef.current.toDataURL({
        pixelRatio,
        mimeType: "image/png",
      });
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      onSave({
        ...image,
        data: base64,
        mediaType: "image/png",
      });
    });
  }, [loadedImage, stageDims.width, image, onSave]);

  const renderAnnotation = useCallback(
    (ann: Annotation) => {
      const isDraggable = activeTool === "select";
      const commonProps = {
        id: ann.id,
        key: ann.id,
        draggable: isDraggable,
        opacity: ann.opacity,
      };

      switch (ann.type) {
        case "freehand":
          return (
            <Line
              {...commonProps}
              points={ann.points}
              stroke={ann.strokeColor}
              strokeWidth={ann.strokeWidth}
              lineCap="round"
              lineJoin="round"
              tension={0.5}
            />
          );
        case "rectangle":
          return (
            <Rect
              {...commonProps}
              x={ann.x}
              y={ann.y}
              width={ann.width}
              height={ann.height}
              stroke={ann.strokeColor}
              strokeWidth={ann.strokeWidth}
            />
          );
        case "highlight":
          return (
            <Rect
              {...commonProps}
              x={ann.x}
              y={ann.y}
              width={ann.width}
              height={ann.height}
              fill={ann.fill}
              stroke="transparent"
              strokeWidth={0}
            />
          );
        case "circle":
          return (
            <Ellipse
              {...commonProps}
              x={ann.x}
              y={ann.y}
              radiusX={ann.radiusX}
              radiusY={ann.radiusY}
              stroke={ann.strokeColor}
              strokeWidth={ann.strokeWidth}
            />
          );
        case "arrow":
          return (
            <Arrow
              {...commonProps}
              points={ann.points}
              stroke={ann.strokeColor}
              strokeWidth={ann.strokeWidth}
              fill={ann.strokeColor}
              pointerLength={8 + ann.strokeWidth}
              pointerWidth={6 + ann.strokeWidth}
            />
          );
        case "text":
          return (
            <Text
              {...commonProps}
              x={ann.x}
              y={ann.y}
              text={ann.text}
              fontSize={ann.fontSize}
              fill={ann.fill}
              fontFamily="system-ui, -apple-system, sans-serif"
            />
          );
        default:
          return null;
      }
    },
    [activeTool],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[90vh] max-h-[90vh] w-[90vw] max-w-[90vw] flex-col gap-0 p-0"
        showCloseButton={false}
        // Prevent Radix from auto-focusing the first focusable element — keep focus on the canvas area
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Visually-hidden title for a11y */}
        <DialogTitle className="sr-only">Annotate Image</DialogTitle>
        <DialogDescription className="sr-only">
          Draw, highlight, and annotate the image before sending.
        </DialogDescription>

        {/* Toolbar */}
        <div className="border-b px-3 py-2">
          <ImageAnnotationToolbar
            activeTool={activeTool}
            onToolChange={setActiveTool}
            strokeColor={strokeColor}
            onStrokeColorChange={setStrokeColor}
            strokeWidth={strokeWidth}
            onStrokeWidthChange={setStrokeWidth}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
          />
        </div>

        {/* Canvas area */}
        <div
          ref={containerRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-muted/20"
          // Tabindex so keyboard shortcuts (undo/redo) fire on this container
          tabIndex={0}
        >
          {loadedImage && (
            <Stage
              ref={stageRef}
              width={stageDims.width}
              height={stageDims.height}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ cursor: activeTool === "select" ? "default" : "crosshair" }}
            >
              {/* Bottom layer: source image */}
              <Layer listening={false}>
                <KonvaImage
                  image={loadedImage}
                  width={stageDims.width}
                  height={stageDims.height}
                />
              </Layer>

              {/* Top layer: annotations */}
              <Layer>
                {annotations.map(renderAnnotation)}
                {drawingAnnotation && renderAnnotation(drawingAnnotation)}
                {activeTool === "select" && <Transformer ref={transformerRef} />}
              </Layer>
            </Stage>
          )}

          {/* Text input overlay — positioned at click point */}
          {textEditing && (
            <input
              ref={textInputRef}
              type="text"
              className="fixed z-[60] rounded border border-border bg-background px-2 py-1 text-sm text-foreground shadow-md outline-none"
              style={{ left: textEditing.x, top: textEditing.y }}
              placeholder="Type here..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleTextSubmit(e.currentTarget.value);
                } else if (e.key === "Escape") {
                  setTextEditing(null);
                }
                // Stop propagation so undo/redo shortcuts don't fire while typing
                e.stopPropagation();
              }}
              onBlur={(e) => handleTextSubmit(e.currentTarget.value)}
            />
          )}

          {/* Loading state */}
          {!loadedImage && open && (
            <div className="text-sm text-muted-foreground">Loading image…</div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="border-t px-4 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!loadedImage}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
