import type { ToolId } from "@/types/tools";
import { isPanelTool } from "@/lib/workspace/tool-island-utils";

export type DockArea = "side" | "bottom";

export interface DockPlacement {
  toolOrder: ToolId[];
  bottomTools: Set<ToolId>;
}

export interface DockDropTarget {
  area: DockArea;
  beforeId?: ToolId;
  atEnd?: boolean;
}

export function getAreaToolIds(
  toolOrder: ToolId[],
  bottomTools: ReadonlySet<ToolId>,
  area: DockArea,
): ToolId[] {
  return toolOrder.filter((toolId) => isPanelTool(toolId) && (area === "bottom" ? bottomTools.has(toolId) : !bottomTools.has(toolId)));
}

export function applyDockDrop(
  placement: DockPlacement,
  draggedId: ToolId,
  target: DockDropTarget,
): DockPlacement {
  const filteredOrder = placement.toolOrder.filter((toolId) => toolId !== draggedId);
  const nextBottomTools = new Set(placement.bottomTools);

  if (target.area === "bottom") {
    nextBottomTools.add(draggedId);
  } else {
    nextBottomTools.delete(draggedId);
  }

  const areaOrder = getAreaToolIds(filteredOrder, nextBottomTools, target.area);
  const insertIndex = target.atEnd || !target.beforeId
    ? areaOrder.length
    : Math.max(0, areaOrder.indexOf(target.beforeId));
  const nextAreaOrder = [...areaOrder];
  nextAreaOrder.splice(insertIndex, 0, draggedId);
  const nextSideOrder = target.area === "side"
    ? nextAreaOrder
    : getAreaToolIds(filteredOrder, nextBottomTools, "side");
  const nextBottomOrder = target.area === "bottom"
    ? nextAreaOrder
    : getAreaToolIds(filteredOrder, nextBottomTools, "bottom");
  const nonPanelIds = placement.toolOrder.filter((toolId) => !isPanelTool(toolId));
  const nextToolOrder = [...nextSideOrder, ...nextBottomOrder, ...nonPanelIds];

  return {
    toolOrder: nextToolOrder,
    bottomTools: nextBottomTools,
  };
}
