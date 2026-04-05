import { MIN_TOOLS_PANEL_WIDTH, SPLIT_HANDLE_WIDTH } from "@/lib/layout/constants";

export type ToolColumnDropIntent =
  | { area: "top"; side: "before" | "after" }
  | { area: "top-stack"; side: "before" | "after" };

export function getHorizontalInsertSide(rect: DOMRect, clientX: number): "before" | "after" | null {
  const relative = (clientX - rect.left) / Math.max(rect.width, 1);
  if (relative <= 0.42) return "before";
  if (relative >= 0.58) return "after";
  return null;
}

export function getColumnEdgeInsertSide(rect: DOMRect, clientX: number): "before" | "after" | null {
  const relative = (clientX - rect.left) / Math.max(rect.width, 1);
  if (relative <= 0.22) return "before";
  if (relative >= 0.78) return "after";
  return null;
}

export function getVerticalInsertSide(rect: DOMRect, clientY: number): "before" | "after" | null {
  const relative = (clientY - rect.top) / Math.max(rect.height, 1);
  if (relative <= 0.42) return "before";
  if (relative >= 0.58) return "after";
  return null;
}

export function getToolColumnDropIntent(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): ToolColumnDropIntent {
  const width = Math.max(rect.width, 1);
  const edgeThresholdPx = width < 280
    ? Math.min(Math.max(width * 0.05, 10), 14)
    : Math.min(Math.max(width * 0.08, 12), 22);
  const leftDistance = clientX - rect.left;
  const rightDistance = rect.right - clientX;

  if (leftDistance <= edgeThresholdPx) {
    return { area: "top", side: "before" };
  }
  if (rightDistance <= edgeThresholdPx) {
    return { area: "top", side: "after" };
  }

  const relativeY = (clientY - rect.top) / Math.max(rect.height, 1);
  return {
    area: "top-stack",
    side: relativeY < 0.5 ? "before" : "after",
  };
}

export function isNearBottomDockZone(rect: DOMRect, clientY: number): boolean {
  const bottomZoneHeight = Math.min(180, rect.height * 0.28);
  return clientY >= rect.bottom - bottomZoneHeight;
}

export function getRequiredToolIslandsWidth(count: number): number {
  if (count <= 0) return 0;
  return (MIN_TOOLS_PANEL_WIDTH * count) + (SPLIT_HANDLE_WIDTH * Math.max(0, count - 1));
}
