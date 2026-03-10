import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeRatios, type Settings } from "@/hooks/useSettings";
import {
  MIN_RIGHT_PANEL_WIDTH,
  MIN_TOOLS_PANEL_WIDTH,
  MIN_BOTTOM_TOOLS_HEIGHT,
  MAX_BOTTOM_TOOLS_HEIGHT,
  getMinChatWidth,
  getResizeHandleWidth,
  getToolPickerWidth,
} from "@/lib/layout-constants";

// ── Layout constants ──
const MIN_PANEL_WIDTH = MIN_RIGHT_PANEL_WIDTH;
const MAX_PANEL_WIDTH = 500;
const MIN_TOOLS_WIDTH = MIN_TOOLS_PANEL_WIDTH;
const MAX_TOOLS_WIDTH = 800;

interface UsePanelResizeOptions {
  settings: Settings;
  isIsland: boolean;
  hasRightPanel: boolean;
  hasToolsColumn: boolean;
  activeSessionId: string | null;
  activeProjectId: string | null | undefined;
}

export function usePanelResize({
  settings,
  isIsland,
  hasRightPanel,
  hasToolsColumn,
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
  const bottomToolsRowRef = useRef<HTMLDivElement>(null);

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
          reserved += toolsPanelWidthRef.current + handleW;
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

  // ── Tools panel resize ──

  const toolsPanelWidthRef = useRef(settings.toolsPanelWidth);
  toolsPanelWidthRef.current = settings.toolsPanelWidth;

  const handleToolsResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = toolsPanelWidthRef.current;
      // Capture right panel visibility at drag start
      const rightVisible = !!rightPanelRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        // Dynamically cap so the chat always keeps MIN_CHAT_WIDTH
        const containerWidth = contentRef.current?.clientWidth ?? window.innerWidth;
        let reserved = minChatWidth + pickerW + handleW;
        if (rightVisible) {
          reserved += rightPanelWidthRef.current + handleW;
        }
        const dynamicMax = Math.max(MIN_TOOLS_WIDTH, containerWidth - reserved);

        const delta = startX - ev.clientX;
        const next = Math.max(MIN_TOOLS_WIDTH, Math.min(Math.min(MAX_TOOLS_WIDTH, dynamicMax), startWidth + delta));
        settings.setToolsPanelWidth(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveToolsPanelWidth();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings, minChatWidth, pickerW, handleW],
  );

  // ── Reactive panel clamping on window resize / project switch ──
  // When the container shrinks (window resize or panel toggle), clamp stored panel widths
  // so the chat island never goes below MIN_CHAT_WIDTH. Tools panel yields first, then right panel.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const clamp = () => {
      const containerW = el.clientWidth;
      const hasRight = !!rightPanelRef.current;
      const hasTools = !!toolsColumnRef.current;

      let reserved = minChatWidth + (activeSessionId ? pickerW : 0);
      if (hasRight) reserved += handleW;
      if (hasTools) reserved += handleW;

      const available = containerW - reserved;
      let rw = hasRight ? rightPanelWidthRef.current : 0;
      let tw = hasTools ? toolsPanelWidthRef.current : 0;

      if (rw + tw > available) {
        // Shrink tools panel first, then right panel
        const excess = rw + tw - available;
        const twReduction = Math.min(excess, Math.max(0, tw - MIN_TOOLS_WIDTH));
        tw = Math.max(MIN_TOOLS_WIDTH, tw - twReduction);
        const remaining = rw + tw - available;
        if (remaining > 0) rw = Math.max(MIN_PANEL_WIDTH, rw - remaining);

        // Only update state if actually changed (>1px guard against loops)
        if (hasRight && Math.abs(rw - rightPanelWidthRef.current) > 1) settings.setRightPanelWidth(rw);
        if (hasTools && Math.abs(tw - toolsPanelWidthRef.current) > 1) settings.setToolsPanelWidth(tw);
      }
    };

    const observer = new ResizeObserver(clamp);
    observer.observe(el);
    // Also clamp immediately on mount / project switch
    clamp();
    return () => observer.disconnect();
  }, [hasRightPanel, hasToolsColumn, activeSessionId, activeProjectId, minChatWidth, pickerW, handleW]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tools vertical split ratios ──

  // Track the current NORMALIZED ratios so the drag handler always has correct values
  // (raw settings.toolsSplitRatios can be empty or wrong length when tools are toggled)
  const normalizedToolRatiosRef = useRef<number[]>([]);

  // Count of active SIDE tools (exclude bottom-placed tools)
  const columnToolIds = ["terminal", "git", "browser", "files", "project-files", "mcp"];
  const activeToolCount = useMemo(
    () => settings.toolOrder.filter((id) =>
      settings.activeTools.has(id) && columnToolIds.includes(id) && !settings.bottomTools.has(id),
    ).length,
    [settings.toolOrder, settings.activeTools, settings.bottomTools],
  );

  // Sync stored ratios to the actual tool count whenever tools are toggled on/off.
  // Without this, the drag handler would start from stale ratios of a different length.
  useEffect(() => {
    if (activeToolCount <= 0) return;
    if (settings.toolsSplitRatios.length !== activeToolCount) {
      const synced = normalizeRatios(settings.toolsSplitRatios, activeToolCount);
      settings.setToolsSplitRatios(synced);
    }
  }, [activeToolCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToolsSplitStart = useCallback(
    (e: React.MouseEvent, dividerIndex: number) => {
      e.preventDefault();
      setIsResizing(true);
      const startY = e.clientY;
      const columnEl = toolsColumnRef.current;
      if (!columnEl) return;
      const columnHeight = columnEl.getBoundingClientRect().height;
      // Use the normalized ratios (always match current tool count, never NaN/empty)
      const startRatios = [...normalizedToolRatiosRef.current];
      if (dividerIndex + 1 >= startRatios.length) return; // safety guard
      const minRatio = 0.1;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = (ev.clientY - startY) / columnHeight;
        const next = [...startRatios];
        let upper = startRatios[dividerIndex] + delta;
        let lower = startRatios[dividerIndex + 1] - delta;
        // Clamp both sides
        if (upper < minRatio) { lower += upper - minRatio; upper = minRatio; }
        if (lower < minRatio) { upper += lower - minRatio; lower = minRatio; }
        next[dividerIndex] = upper;
        next[dividerIndex + 1] = lower;
        settings.setToolsSplitRatios(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveToolsSplitRatios();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings],
  );

  // ── Bottom tools row resize (vertical drag between top area and bottom tools) ──

  const bottomToolsHeightRef = useRef(settings.bottomToolsHeight);
  bottomToolsHeightRef.current = settings.bottomToolsHeight;

  const handleBottomResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startY = e.clientY;
      const startHeight = bottomToolsHeightRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        const next = Math.max(MIN_BOTTOM_TOOLS_HEIGHT, Math.min(MAX_BOTTOM_TOOLS_HEIGHT, startHeight + delta));
        settings.setBottomToolsHeight(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveBottomToolsHeight();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings],
  );

  // ── Bottom tools horizontal split ratios ──

  const normalizedBottomRatiosRef = useRef<number[]>([]);

  const activeBottomToolCount = useMemo(
    () => settings.toolOrder.filter((id) =>
      settings.activeTools.has(id) && settings.bottomTools.has(id) && columnToolIds.includes(id),
    ).length,
    [settings.toolOrder, settings.activeTools, settings.bottomTools],
  );

  useEffect(() => {
    if (activeBottomToolCount <= 0) return;
    if (settings.bottomToolsSplitRatios.length !== activeBottomToolCount) {
      const synced = normalizeRatios(settings.bottomToolsSplitRatios, activeBottomToolCount);
      settings.setBottomToolsSplitRatios(synced);
    }
  }, [activeBottomToolCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBottomSplitStart = useCallback(
    (e: React.MouseEvent, dividerIndex: number) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const rowEl = bottomToolsRowRef.current;
      if (!rowEl) return;
      const rowWidth = rowEl.getBoundingClientRect().width;
      const startRatios = [...normalizedBottomRatiosRef.current];
      if (dividerIndex + 1 >= startRatios.length) return;
      const minRatio = 0.1;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = (ev.clientX - startX) / rowWidth;
        const next = [...startRatios];
        let left = startRatios[dividerIndex] + delta;
        let right = startRatios[dividerIndex + 1] - delta;
        if (left < minRatio) { right += left - minRatio; left = minRatio; }
        if (right < minRatio) { left += right - minRatio; right = minRatio; }
        next[dividerIndex] = left;
        next[dividerIndex + 1] = right;
        settings.setBottomToolsSplitRatios(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveBottomToolsSplitRatios();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings],
  );

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
    bottomToolsRowRef,
    normalizedToolRatiosRef,
    normalizedBottomRatiosRef,
    handleResizeStart,
    handleToolsResizeStart,
    handleToolsSplitStart,
    handleRightSplitStart,
    handleBottomResizeStart,
    handleBottomSplitStart,
    // Expose constants for JSX layout
    MIN_CHAT_WIDTH: minChatWidth,
    MIN_PANEL_WIDTH,
    MIN_TOOLS_WIDTH,
    TOOL_PICKER_WIDTH: pickerW,
    RESIZE_HANDLE_WIDTH: handleW,
    pickerW,
    handleW,
  } as const;
}
