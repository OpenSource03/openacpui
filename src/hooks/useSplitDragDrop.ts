/**
 * useSplitDragDrop — manages drag-from-sidebar-to-split state.
 *
 * When a session is dragged from the sidebar over the chat area, this hook:
 * 1. Detects whether the drag payload is a session
 * 2. Calculates which drop position the cursor is over (between/beside panes)
 * 3. Provides state for rendering animated drop zones
 *
 * Drop positions are indices into the pane array:
 *   0 = before the first pane
 *   1 = after the first pane (between first and second)
 *   N = after the last pane
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { clearSidebarDragPayload, getSidebarDragPayload } from "@/lib/sidebar/dnd";

export interface SplitDragState {
  /** Whether a valid session is being dragged over the chat area. */
  isDragging: boolean;
  /** Which drop position the cursor is over (index in the pane array where the new pane would be inserted). */
  dropPosition: number | null;
  /** Session ID being dragged (for preview). */
  draggedSessionId: string | null;
}

interface UseSplitDragDropOptions {
  /** Current number of panes. */
  paneCount: number;
  /** Whether another session can currently be added to split view. */
  canAcceptDrop: boolean;
  /** Ref to the container element for measuring positions. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Width fractions for current panes. */
  widthFractions: number[];
  /** Callback when a session is dropped at a position. */
  onDrop: (sessionId: string, position: number) => void;
  /** Set of session IDs already visible in panes (to prevent duplicate drops). */
  visibleSessionIds: Set<string>;
}

export function useSplitDragDrop({
  paneCount,
  canAcceptDrop,
  containerRef,
  widthFractions,
  onDrop,
  visibleSessionIds,
}: UseSplitDragDropOptions) {
  const [dragState, setDragState] = useState<SplitDragState>({
    isDragging: false,
    dropPosition: null,
    draggedSessionId: null,
  });

  const dragCounterRef = useRef(0);
  const resetDragPreview = useCallback(() => {
    dragCounterRef.current = 0;
    setDragState({ isDragging: false, dropPosition: null, draggedSessionId: null });
  }, []);
  const finishDrag = useCallback(() => {
    resetDragPreview();
    clearSidebarDragPayload();
  }, [resetDragPreview]);

  /** Calculate which drop position the mouse X is closest to. */
  const calcDropPosition = useCallback((clientX: number): number | null => {
    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const totalWidth = rect.width;

    if (totalWidth <= 0) return null;

    // Calculate the x-position of each pane boundary
    const boundaries: number[] = [0]; // left edge
    let cumulative = 0;
    for (let i = 0; i < widthFractions.length; i++) {
      cumulative += widthFractions[i] * totalWidth;
      boundaries.push(cumulative);
    }

    // Find the closest boundary to the cursor
    // Drop zones are in the edge regions of each pane
    const edgeThreshold = Math.min(80, totalWidth / (paneCount * 3));

    // Check left edge of first pane
    if (relativeX < edgeThreshold) return 0;

    // Check right edge of last pane
    if (relativeX > totalWidth - edgeThreshold) return paneCount;

    // Check boundaries between panes
    for (let i = 1; i < boundaries.length - 1; i++) {
      const boundary = boundaries[i];
      if (Math.abs(relativeX - boundary) < edgeThreshold) {
        return i;
      }
    }

    // If cursor is in the middle of a pane, find the closest edge
    // (use whichever half of the pane the cursor is in)
    for (let i = 0; i < widthFractions.length; i++) {
      const paneLeft = boundaries[i];
      const paneRight = boundaries[i + 1];
      if (relativeX >= paneLeft && relativeX <= paneRight) {
        const paneMid = (paneLeft + paneRight) / 2;
        return relativeX < paneMid ? i : i + 1;
      }
    }

    return paneCount; // fallback: append to end
  }, [containerRef, widthFractions, paneCount]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    const payload = getSidebarDragPayload(e.dataTransfer);
    if (!payload || payload.kind !== "session") return;

    // Don't allow if already at max panes
    if (!canAcceptDrop) return;

    // Don't allow duplicates
    if (visibleSessionIds.has(payload.id)) return;

    dragCounterRef.current++;
    e.preventDefault();
    const position = calcDropPosition(e.clientX);

    setDragState({
      isDragging: true,
      dropPosition: position,
      draggedSessionId: payload.id,
    });
  }, [canAcceptDrop, calcDropPosition, visibleSessionIds]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const payload = getSidebarDragPayload(e.dataTransfer);
    if (!payload || payload.kind !== "session") return;
    if (!canAcceptDrop) return;
    if (visibleSessionIds.has(payload.id)) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const position = calcDropPosition(e.clientX);
    setDragState(prev => {
      if (prev.dropPosition === position && prev.isDragging) return prev;
      return { isDragging: true, dropPosition: position, draggedSessionId: payload.id };
    });
  }, [canAcceptDrop, calcDropPosition, visibleSessionIds]);

  const handleDragLeave = useCallback((_e: React.DragEvent) => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      resetDragPreview();
    }
  }, [resetDragPreview]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    const payload = getSidebarDragPayload(e.dataTransfer);
    if (!payload || payload.kind !== "session") {
      finishDrag();
      return;
    }

    if (!canAcceptDrop || visibleSessionIds.has(payload.id)) {
      finishDrag();
      return;
    }

    const effectivePosition = calcDropPosition(e.clientX) ?? paneCount;
    finishDrag();
    onDrop(payload.id, effectivePosition);
  }, [calcDropPosition, canAcceptDrop, finishDrag, onDrop, paneCount, visibleSessionIds]);

  useEffect(() => {
    if (!dragState.isDragging) {
      return;
    }

    const handleWindowDragEnd = () => {
      finishDrag();
    };
    const handleWindowBlur = () => {
      resetDragPreview();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        resetDragPreview();
      }
    };

    window.addEventListener("dragend", handleWindowDragEnd, true);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("dragend", handleWindowDragEnd, true);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [dragState.isDragging, finishDrag, resetDragPreview]);

  useEffect(() => {
    if (dragState.isDragging && !canAcceptDrop) {
      resetDragPreview();
    }
  }, [canAcceptDrop, dragState.isDragging, resetDragPreview]);

  return {
    dragState,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
