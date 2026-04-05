/**
 * usePaneResize — handles drag logic for N-1 split handles in multi-pane split view.
 *
 * Each handle adjusts the width fractions of the two adjacent panes.
 * Uses the same ref + mousemove/mouseup pattern as other resize hooks.
 */

import { useCallback, useRef, useState } from "react";
import {
  MIN_PANE_WIDTH_FRACTION,
  equalWidthFractions,
} from "@/lib/layout/constants";

interface UsePaneResizeOptions {
  /** Width fractions for all panes (length = pane count). */
  widthFractions: number[];
  /** Setter for width fractions during drag. */
  setWidthFractions: (fractions: number[]) => void;
  /** Ref to the container element encompassing all panes. */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function usePaneResize({
  widthFractions,
  setWidthFractions,
  containerRef,
}: UsePaneResizeOptions) {
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startFractionsRef = useRef<number[]>([]);
  const containerWidthRef = useRef(0);
  const handleIndexRef = useRef(0);

  /**
   * Start resizing at a specific handle index.
   * Handle 0 sits between panes 0 and 1, handle 1 between panes 1 and 2, etc.
   */
  const handleSplitResizeStart = useCallback(
    (handleIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      setIsResizing(true);
      startXRef.current = e.clientX;
      startFractionsRef.current = [...widthFractions];
      containerWidthRef.current = container.getBoundingClientRect().width;
      handleIndexRef.current = handleIndex;

      const handleMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startXRef.current;
        const deltaFraction = deltaX / containerWidthRef.current;
        const idx = handleIndexRef.current;
        const fractions = [...startFractionsRef.current];

        // Adjust the two adjacent panes
        let leftNew = fractions[idx] + deltaFraction;
        let rightNew = fractions[idx + 1] - deltaFraction;

        // Clamp both to minimum
        if (leftNew < MIN_PANE_WIDTH_FRACTION) {
          const overflow = MIN_PANE_WIDTH_FRACTION - leftNew;
          leftNew = MIN_PANE_WIDTH_FRACTION;
          rightNew -= overflow;
        }
        if (rightNew < MIN_PANE_WIDTH_FRACTION) {
          const overflow = MIN_PANE_WIDTH_FRACTION - rightNew;
          rightNew = MIN_PANE_WIDTH_FRACTION;
          leftNew -= overflow;
        }

        // Final clamp
        leftNew = Math.max(MIN_PANE_WIDTH_FRACTION, leftNew);
        rightNew = Math.max(MIN_PANE_WIDTH_FRACTION, rightNew);

        fractions[idx] = leftNew;
        fractions[idx + 1] = rightNew;

        // Normalize all fractions to sum=1
        const sum = fractions.reduce((a, b) => a + b, 0);
        setWidthFractions(fractions.map(f => f / sum));
      };

      const handleUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [widthFractions, setWidthFractions, containerRef],
  );

  /** Reset all panes to equal widths. */
  const handleSplitDoubleClick = useCallback(() => {
    setWidthFractions(equalWidthFractions(widthFractions.length));
  }, [setWidthFractions, widthFractions.length]);

  return {
    isResizing,
    handleSplitResizeStart,
    handleSplitDoubleClick,
  };
}
