/**
 * Wraps `usePaneResize` with the chat-fraction coordinate transform
 * needed by the main workspace tool column resize.
 *
 * In single-chat mode, width fractions are [chatFraction, ...toolFractions].
 * `usePaneResize` operates in tool-relative space (fractions normalized to sum=1
 * within the tool area only). This hook converts between the two coordinate systems
 * so the resize operates smoothly without corrupting the chat fraction.
 */

import { useRef } from "react";
import { usePaneResize } from "@/hooks/usePaneResize";
import type { MainToolWorkspaceState } from "@/hooks/useMainToolWorkspace";
import { MIN_TOOLS_PANEL_WIDTH, SPLIT_HANDLE_WIDTH } from "@/lib/layout/constants";

export function useMainToolPaneResize(
  workspace: MainToolWorkspaceState,
  containerRef: React.RefObject<HTMLDivElement | null>,
  toolAreaFraction: number,
) {
  // Ref for stable tool-area access during drag (avoids stale closure in mousemove handler)
  const toolAreaFractionRef = useRef(toolAreaFraction);
  toolAreaFractionRef.current = toolAreaFraction;

  return usePaneResize({
    widthFractions: (() => {
      const toolFractions = workspace.widthFractions.slice(1);
      const totalToolFraction = Math.max(toolAreaFraction, 0.0001);
      return toolFractions.length > 0
        ? toolFractions.map((fraction) => fraction / totalToolFraction)
        : [];
    })(),
    setWidthFractions: (fractions) => {
      const totalToolFraction = Math.max(toolAreaFractionRef.current, 0);
      // Scale tool fractions back to workspace space, preserving chat fraction exactly.
      // Use setWidthFractionsDirect to bypass double clamping — usePaneResize already
      // clamped in the tool-relative coordinate system.
      workspace.setWidthFractionsDirect([
        Math.max(0, 1 - totalToolFraction),
        ...fractions.map((fraction) => fraction * totalToolFraction),
      ]);
    },
    containerRef,
    minWidthsPx: workspace.widthFractions.slice(1).map(() => MIN_TOOLS_PANEL_WIDTH),
    handleWidthPx: SPLIT_HANDLE_WIDTH,
  });
}
