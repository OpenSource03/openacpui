import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings } from "@/hooks/useSettings";
import {
  MIN_RIGHT_PANEL_WIDTH,
  getMinChatWidth,
  getResizeHandleWidth,
  getToolPickerWidth,
} from "@/lib/layout/constants";

// ── Layout constants ──
const MIN_PANEL_WIDTH = MIN_RIGHT_PANEL_WIDTH;
const MAX_PANEL_WIDTH = 500;

interface UsePanelResizeOptions {
  settings: Settings;
  isIsland: boolean;
  hasRightPanel: boolean;
  activeSessionId: string | null;
  activeProjectId: string | null | undefined;
}

export function usePanelResize({
  settings,
  isIsland,
  hasRightPanel,
  activeSessionId,
  activeProjectId,
}: UsePanelResizeOptions) {
  const [isResizing, setIsResizing] = useState(false);
  const minChatWidth = getMinChatWidth(isIsland);

  // ToolPicker strip width (flat divider is an overlay, excluded from width math)
  const pickerW = getToolPickerWidth(isIsland);
  const handleW = getResizeHandleWidth(isIsland);

  const contentRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const toolsColumnRef = useRef<HTMLDivElement>(null);

  // ── Right panel resize ──

  const rightPanelWidthRef = useRef(settings.rightPanelWidth);
  rightPanelWidthRef.current = settings.rightPanelWidth;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = rightPanelWidthRef.current;
      // Capture tools panel visibility at drag start
      const toolsVisible = !!toolsColumnRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        // Dynamically cap so the chat always keeps MIN_CHAT_WIDTH
        const containerWidth = contentRef.current?.clientWidth ?? window.innerWidth;
        let reserved = minChatWidth + pickerW + handleW;
        if (toolsVisible) {
          reserved += (toolsColumnRef.current?.getBoundingClientRect().width ?? 0) + handleW;
        }
        const dynamicMax = Math.max(MIN_PANEL_WIDTH, containerWidth - reserved);

        const delta = startX - ev.clientX;
        const next = Math.max(MIN_PANEL_WIDTH, Math.min(Math.min(MAX_PANEL_WIDTH, dynamicMax), startWidth + delta));
        settings.setRightPanelWidth(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveRightPanelWidth();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings, minChatWidth, pickerW, handleW],
  );

  // ── Reactive right panel clamping on window resize / project switch ──
  // When the container shrinks (window resize or panel toggle), clamp the right panel width
  // so the chat island never goes below MIN_CHAT_WIDTH.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const clamp = () => {
      const containerW = el.clientWidth;
      const hasRight = !!rightPanelRef.current;
      if (!hasRight) return;

      let reserved = minChatWidth + (activeSessionId ? pickerW : 0);
      reserved += handleW;
      // Account for tools column width if visible
      const toolsW = toolsColumnRef.current?.getBoundingClientRect().width ?? 0;
      if (toolsW > 0) reserved += toolsW + handleW;

      const available = containerW - reserved;
      const rw = rightPanelWidthRef.current;

      if (rw > available) {
        const next = Math.max(MIN_PANEL_WIDTH, available);
        if (Math.abs(next - rw) > 1) settings.setRightPanelWidth(next);
      }
    };

    const observer = new ResizeObserver(clamp);
    observer.observe(el);
    // Also clamp immediately on mount / project switch
    clamp();
    return () => observer.disconnect();
  }, [hasRightPanel, activeSessionId, activeProjectId, minChatWidth, pickerW, handleW]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Right panel vertical split (Tasks / Agents) ──

  const handleRightSplitStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startY = e.clientY;
      const startRatio = settings.rightSplitRatio;
      const panelEl = rightPanelRef.current;
      if (!panelEl) return;
      const panelHeight = panelEl.getBoundingClientRect().height;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        const next = Math.max(0.2, Math.min(0.8, startRatio + delta / panelHeight));
        settings.setRightSplitRatio(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveRightSplitRatio();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings],
  );

  return {
    isResizing,
    contentRef,
    rightPanelRef,
    toolsColumnRef,
    handleResizeStart,
    handleRightSplitStart,
    // Expose constants for JSX layout
    MIN_CHAT_WIDTH: minChatWidth,
    MIN_PANEL_WIDTH,
    TOOL_PICKER_WIDTH: pickerW,
    RESIZE_HANDLE_WIDTH: handleW,
    pickerW,
    handleW,
  } as const;
}
