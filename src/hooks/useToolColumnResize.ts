import { useCallback, useState } from "react";
import { MIN_PANE_WIDTH_FRACTION } from "@/lib/layout/constants";

interface UseToolColumnResizeOptions {
  columnRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  setSplitRatios: (columnId: string, ratios: number[]) => void;
}

export function useToolColumnResize({
  columnRefs,
  setSplitRatios,
}: UseToolColumnResizeOptions) {
  const [activeResizeId, setActiveResizeId] = useState<string | null>(null);

  const handleResizeStart = useCallback((
    columnId: string,
    handleIndex: number,
    splitRatios: number[],
    event: React.MouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const container = columnRefs.current[columnId];
    if (!container) return;

    setActiveResizeId(`${columnId}:${handleIndex}`);
    const startY = event.clientY;
    const startFractions = [...splitRatios];
    const containerHeight = Math.max(container.getBoundingClientRect().height, 1);

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaFraction = (moveEvent.clientY - startY) / containerHeight;
      const nextFractions = [...startFractions];

      let topNew = nextFractions[handleIndex]! + deltaFraction;
      let bottomNew = nextFractions[handleIndex + 1]! - deltaFraction;

      if (topNew < MIN_PANE_WIDTH_FRACTION) {
        const overflow = MIN_PANE_WIDTH_FRACTION - topNew;
        topNew = MIN_PANE_WIDTH_FRACTION;
        bottomNew -= overflow;
      }
      if (bottomNew < MIN_PANE_WIDTH_FRACTION) {
        const overflow = MIN_PANE_WIDTH_FRACTION - bottomNew;
        bottomNew = MIN_PANE_WIDTH_FRACTION;
        topNew -= overflow;
      }

      topNew = Math.max(MIN_PANE_WIDTH_FRACTION, topNew);
      bottomNew = Math.max(MIN_PANE_WIDTH_FRACTION, bottomNew);

      nextFractions[handleIndex] = topNew;
      nextFractions[handleIndex + 1] = bottomNew;
      const sum = nextFractions.reduce((acc, value) => acc + value, 0);
      setSplitRatios(
        columnId,
        nextFractions.map((value) => value / sum),
      );
    };

    const handleUp = () => {
      setActiveResizeId(null);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [columnRefs, setSplitRatios]);

  return {
    activeResizeId,
    handleResizeStart,
  };
}
