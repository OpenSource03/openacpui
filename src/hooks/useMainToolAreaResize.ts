/**
 * Manages the horizontal resize handle between the chat pane and the
 * main workspace tool area.
 *
 * Same pattern as `useBottomHeightResize` — encapsulates the manual
 * mousemove/mouseup listener pattern that was previously a 50-line
 * `handleMainToolAreaResizeStart` useCallback in AppLayout.
 */

import { useCallback, useState } from "react";
import type { MainToolWorkspaceState } from "@/hooks/useMainToolWorkspace";
import { MIN_TOOLS_PANEL_WIDTH } from "@/lib/layout/constants";

export interface UseMainToolAreaResizeInput {
  mainToolWorkspace: MainToolWorkspaceState;
  mainTopToolColumnCount: number;
  mainCombinedWorkspaceWidth: number;
  mainMinChatFraction: number;
  effectiveMainChatFraction: number;
  effectiveMainToolAreaFraction: number;
  mainToolRelativeFractions: number[];
}

export interface UseMainToolAreaResizeReturn {
  isResizing: boolean;
  handleResizeStart: (event: React.MouseEvent) => void;
}

export function useMainToolAreaResize(
  input: UseMainToolAreaResizeInput,
): UseMainToolAreaResizeReturn {
  const {
    mainToolWorkspace,
    mainTopToolColumnCount,
    mainCombinedWorkspaceWidth,
    mainMinChatFraction,
    effectiveMainChatFraction,
    effectiveMainToolAreaFraction,
    mainToolRelativeFractions,
  } = input;

  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      if (mainTopToolColumnCount <= 0 || mainCombinedWorkspaceWidth <= 0) return;

      event.preventDefault();
      setIsResizing(true);
      const startX = event.clientX;
      const startFractions = [
        effectiveMainChatFraction,
        ...mainToolRelativeFractions.map(
          (fraction) => fraction * effectiveMainToolAreaFraction,
        ),
      ];
      const firstToolFraction = startFractions[1] ?? 0;
      const otherToolFractions = startFractions.slice(2);
      const otherToolFractionTotal = otherToolFractions.reduce(
        (sum, fraction) => sum + fraction,
        0,
      );
      const minFirstToolFraction = Math.min(
        0.92,
        MIN_TOOLS_PANEL_WIDTH / mainCombinedWorkspaceWidth,
      );
      const maxFirstToolFraction = Math.max(
        minFirstToolFraction,
        1 - otherToolFractionTotal - mainMinChatFraction,
      );

      const handleMove = (moveEvent: MouseEvent) => {
        const deltaFraction =
          (startX - moveEvent.clientX) / mainCombinedWorkspaceWidth;
        const nextFirstToolFraction = Math.max(
          minFirstToolFraction,
          Math.min(maxFirstToolFraction, firstToolFraction + deltaFraction),
        );
        const nextChatFraction = Math.max(
          0,
          1 - otherToolFractionTotal - nextFirstToolFraction,
        );
        const nextToolAreaFraction = Math.max(0, 1 - nextChatFraction);
        // Fractions are already clamped above — bypass double-clamping via setWidthFractionsDirect
        mainToolWorkspace.setWidthFractionsDirect([
          nextChatFraction,
          nextFirstToolFraction,
          ...otherToolFractions,
        ]);
        mainToolWorkspace.setPreferredTopAreaWidthPx(
          nextToolAreaFraction * mainCombinedWorkspaceWidth,
        );
      };

      const handleUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [
      effectiveMainChatFraction,
      effectiveMainToolAreaFraction,
      mainCombinedWorkspaceWidth,
      mainMinChatFraction,
      mainToolRelativeFractions,
      mainToolWorkspace,
      mainTopToolColumnCount,
    ],
  );

  return { isResizing, handleResizeStart };
}
