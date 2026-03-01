import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeRatios, type Settings } from "@/hooks/useSettings";

// ── Layout constants ──
const MIN_CHAT_WIDTH = 768;
const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 500;
const MIN_TOOLS_WIDTH = 280;
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

  // ToolPicker strip (w-14 = 56px) + its left margin (ms-2 = 8px)
  const pickerW = isIsland ? 64 : 56; // w-14 = 56px, no ms-2 in flat mode
  const handleW = isIsland ? 8 : 1; // 8px pill vs 1px border

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
        let reserved = MIN_CHAT_WIDTH + pickerW + handleW;
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
    [settings, pickerW, handleW],
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
        let reserved = MIN_CHAT_WIDTH + pickerW + handleW;
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
    [settings, pickerW, handleW],
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

      let reserved = MIN_CHAT_WIDTH + (activeSessionId ? pickerW : 0);
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
  }, [hasRightPanel, hasToolsColumn, activeSessionId, activeProjectId, pickerW, handleW]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tools vertical split ratios ──

  // Track the current NORMALIZED ratios so the drag handler always has correct values
  // (raw settings.toolsSplitRatios can be empty or wrong length when tools are toggled)
  const normalizedToolRatiosRef = useRef<number[]>([]);

  // Count of active panel tools (used to sync stored ratios when tools are toggled)
  const activeToolCount = useMemo(
    () => settings.toolOrder.filter((id) => settings.activeTools.has(id) && ["terminal", "git", "browser", "files", "mcp", "changes"].includes(id)).length,
    [settings.toolOrder, settings.activeTools],
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
    normalizedToolRatiosRef,
    handleResizeStart,
    handleToolsResizeStart,
    handleToolsSplitStart,
    handleRightSplitStart,
    // Expose constants for JSX layout
    MIN_CHAT_WIDTH,
    MIN_PANEL_WIDTH,
    MIN_TOOLS_WIDTH,
    TOOL_PICKER_WIDTH: isIsland ? 64 : 56,
    RESIZE_HANDLE_WIDTH: handleW,
    pickerW,
    handleW,
  } as const;
}
