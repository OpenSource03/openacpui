import React, { type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from "react";
import { motion } from "motion/react";
import { normalizeRatios } from "@/hooks/useSettings";
import type { MainToolWorkspaceState } from "@/hooks/useMainToolWorkspace";
import { equalWidthFractions } from "@/lib/layout/constants";
import { getHorizontalInsertSide, getToolColumnDropIntent } from "@/lib/workspace/drag";
import { PanelDockControls } from "@/components/PanelDockControls";
import { PanelDockPreview } from "@/components/PanelDockPreview";
import { SplitHandle } from "@/components/split/SplitHandle";
import type { PanelToolId } from "@/types/tools";
import type { PaneResizeController, ToolDragState, ToolIsland } from "@/types";

interface MainTopToolAreaLayoutProps {
  isIsland: boolean;
  shouldAnimateTopRowLayout: boolean;
  showSinglePaneSplitPreview: boolean;
  toolAreaWidth: number;
  toolRelativeFractions: number[];
  isOuterResizeActive: boolean;
  canAddMainTopColumn: boolean;
  onOuterResizeStart: (event: React.MouseEvent) => void;
  topAreaRef: MutableRefObject<HTMLDivElement | null>;
  toolsColumnRef: MutableRefObject<HTMLDivElement | null>;
  topToolColumnRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  topPaneResize: PaneResizeController;
  activeToolColumnResizeId: string | null;
  onToolColumnResizeStart: (
    columnId: string,
    handleIndex: number,
    splitRatios: number[],
    event: React.MouseEvent,
  ) => void;
}

interface MainTopToolAreaDragProps {
  mainToolDrag: ToolDragState | null;
  setMainToolDrag: Dispatch<SetStateAction<ToolDragState | null>>;
  mainDraggedIsland: ToolIsland | null;
  mainToolLabel: string | null;
  onCommitDrop: () => void;
  onResetDrag: () => void;
}

interface MainTopToolAreaProps {
  layout: MainTopToolAreaLayoutProps;
  workspace: MainToolWorkspaceState;
  drag: MainTopToolAreaDragProps;
  renderToolContent: (toolId: PanelToolId, controls: ReactNode) => ReactNode;
}

export function MainTopToolArea({
  layout,
  workspace,
  drag,
  renderToolContent,
}: MainTopToolAreaProps) {
  const {
    isIsland,
    shouldAnimateTopRowLayout,
    showSinglePaneSplitPreview,
    toolAreaWidth,
    toolRelativeFractions,
    isOuterResizeActive,
    canAddMainTopColumn,
    onOuterResizeStart,
    topAreaRef,
    toolsColumnRef,
    topToolColumnRefs,
    topPaneResize,
    activeToolColumnResizeId,
    onToolColumnResizeStart,
  } = layout;
  const {
    mainToolDrag,
    setMainToolDrag,
    mainDraggedIsland,
    mainToolLabel,
    onCommitDrop,
    onResetDrag,
  } = drag;
  const topItems = workspace.topRowItems;
  const projectedToolFractions = toolRelativeFractions.length > 0
    ? normalizeRatios(toolRelativeFractions, toolRelativeFractions.length)
    : equalWidthFractions(Math.max(topItems.length, 1));
  const canShowTopInsertPreview = mainToolDrag?.targetArea === "top" && canAddMainTopColumn;
  const topEntries: Array<{ kind: "item"; item: (typeof topItems)[number] } | { kind: "preview" }> = (() => {
    const draggedIslandId = mainToolDrag?.targetArea !== null
      ? (mainToolDrag?.islandId ?? mainDraggedIsland?.id ?? null)
      : null;
    const baseItems: Array<{ kind: "item"; item: (typeof topItems)[number] }> = draggedIslandId
      ? topItems.flatMap((item) => {
        const filteredIslands = item.islands.filter((island) => island.id !== draggedIslandId);
        if (filteredIslands.length === 0) return [];
        return [{
          kind: "item" as const,
          item: {
            ...item,
            column: {
              ...item.column,
              islandIds: filteredIslands.map((island) => island.id),
              splitRatios: equalWidthFractions(filteredIslands.length),
            },
            islands: filteredIslands,
          },
        }];
      })
      : topItems.map((item) => ({ kind: "item" as const, item }));

    if (!canShowTopInsertPreview || mainToolDrag.targetIndex === null) {
      return baseItems;
    }

    const next: Array<{ kind: "item"; item: (typeof topItems)[number] } | { kind: "preview" }> = [...baseItems];
    next.splice(Math.max(0, Math.min(mainToolDrag.targetIndex, next.length)), 0, { kind: "preview" });
    return next;
  })();
  const topPreviewFractions = topEntries.length === projectedToolFractions.length
    ? projectedToolFractions
    : equalWidthFractions(Math.max(topEntries.length, 1));
  const showMainToolArea = topEntries.length > 0 || canShowTopInsertPreview || mainToolDrag?.targetArea === "top-stack";

  if (!showMainToolArea) return null;

  return (
    <motion.div
      layout={shouldAnimateTopRowLayout}
      transition={shouldAnimateTopRowLayout
        ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
        : { duration: 0 }}
      className={`flex min-w-0 shrink-0 overflow-hidden ${showSinglePaneSplitPreview ? "pointer-events-none opacity-0" : ""}`}
      style={showSinglePaneSplitPreview ? { width: 0, minWidth: 0 } : { width: toolAreaWidth, minWidth: 0 }}
    >
      <div
        className="resize-col flat-divider-soft group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
        style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
        onMouseDown={onOuterResizeStart}
      >
        <div className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${isOuterResizeActive ? "bg-foreground/40" : "bg-transparent group-hover:bg-foreground/25"}`} />
      </div>
      <div
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        onDragOver={(event) => {
          if (!mainToolDrag) return;
          if (topEntries.length === 0) {
            if (!canAddMainTopColumn) {
              if (mainToolDrag.targetArea === "top") {
                setMainToolDrag((current) => current && current.targetArea === "top"
                  ? { ...current, targetArea: null, targetIndex: null, targetColumnId: null }
                  : current);
              }
              return;
            }
            event.preventDefault();
            setMainToolDrag((current) => current ? {
              ...current,
              targetArea: "top",
              targetIndex: 0,
              targetColumnId: null,
            } : current);
          }
        }}
      >
        <div
          ref={(element) => {
            topAreaRef.current = element;
            toolsColumnRef.current = element;
          }}
          className="flex min-h-0 min-w-0 flex-1"
        >
          {topEntries.length === 0 && canShowTopInsertPreview && (
            <div
              className="flex min-h-0 flex-1"
              onDragOver={(event) => {
                if (!canAddMainTopColumn) {
                  setMainToolDrag((current) => current && current.targetArea === "top"
                    ? { ...current, targetArea: null, targetIndex: null, targetColumnId: null }
                    : current);
                  return;
                }
                event.preventDefault();
                setMainToolDrag((current) => current ? { ...current, targetArea: "top", targetIndex: 0 } : current);
              }}
              onDrop={(event) => {
                event.preventDefault();
                onCommitDrop();
              }}
            >
              <PanelDockPreview orientation="horizontal" label={mainToolLabel ?? undefined} className="min-h-0 flex-1" />
            </div>
          )}
          {topEntries.map((entry, displayIndex) => {
            const insertBeforeIndex = topEntries.slice(0, displayIndex).filter((candidate) => candidate.kind === "item").length;
            const fraction = topPreviewFractions[displayIndex] ?? (1 / Math.max(topEntries.length, 1));

            if (entry.kind === "preview") {
              return (
                <div
                  key={`main-top-preview-${displayIndex}`}
                  className="mx-1 flex min-h-0"
                  style={{ flex: `${fraction} 1 0%`, minWidth: 0 }}
                  onDragOver={(event) => {
                    if (!canAddMainTopColumn) {
                      setMainToolDrag((current) => current && current.targetArea === "top"
                        ? { ...current, targetArea: null, targetIndex: null, targetColumnId: null }
                        : current);
                      return;
                    }
                    event.preventDefault();
                    setMainToolDrag((current) => current ? { ...current, targetArea: "top", targetIndex: insertBeforeIndex } : current);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    onCommitDrop();
                  }}
                >
                  <PanelDockPreview orientation="horizontal" label={mainToolLabel ?? undefined} className="min-h-0 flex-1" />
                </div>
              );
            }

            const item = entry.item;
            const stackEntries: Array<{ kind: "item"; island: (typeof item.islands)[number] } | { kind: "preview" }> = mainToolDrag?.targetArea === "top-stack" && mainToolDrag.targetColumnId === item.column.id
              ? (() => {
                const next: Array<{ kind: "item"; island: (typeof item.islands)[number] } | { kind: "preview" }> = item.islands.map((island) => ({ kind: "item" as const, island }));
                next.splice(Math.max(0, Math.min(mainToolDrag.targetIndex ?? next.length, next.length)), 0, { kind: "preview" as const });
                return next;
              })()
              : item.islands.map((island) => ({ kind: "item" as const, island }));
            const stackRatios = stackEntries.some((candidate) => candidate.kind === "preview")
              ? equalWidthFractions(Math.max(stackEntries.length, 1))
              : normalizeRatios(item.column.splitRatios, Math.max(stackEntries.length, 1));

            return (
              <React.Fragment key={item.column.id}>
                <div
                  ref={(element) => { topToolColumnRefs.current[item.column.id] = element; }}
                  className="flex min-h-0 min-w-0 flex-col"
                  style={{ flex: `${fraction} 1 0%`, minWidth: 0 }}
                  onDragOver={(event) => {
                    if (!mainToolDrag) return;
                    if (!canAddMainTopColumn) {
                      if (mainToolDrag.targetArea === "top") {
                        setMainToolDrag((current) => current && current.targetArea === "top"
                          ? { ...current, targetArea: null, targetIndex: null, targetColumnId: null }
                          : current);
                      }
                      return;
                    }
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    const insertSide = getHorizontalInsertSide(rect, event.clientX);
                    if (!insertSide) return;
                    setMainToolDrag((current) => current ? {
                      ...current,
                      targetArea: "top",
                      targetIndex: insertSide === "before" ? insertBeforeIndex : insertBeforeIndex + 1,
                    } : current);
                  }}
                  onDrop={(event) => {
                    if (!mainToolDrag) return;
                    event.preventDefault();
                    onCommitDrop();
                  }}
                >
                  {stackEntries.map((stackEntry, stackIndex) => {
                    const stackFraction = stackRatios[stackIndex] ?? (1 / Math.max(stackEntries.length, 1));
                    const stackInsertBeforeIndex = stackEntries.slice(0, stackIndex).filter((candidate) => candidate.kind === "item").length;
                    const previousEntry = stackIndex > 0 ? stackEntries[stackIndex - 1] : null;
                    const stackHandleIndex = stackInsertBeforeIndex - 1;
                    const canResizeStackPair = previousEntry?.kind === "item" && stackEntry.kind === "item" && stackHandleIndex >= 0;
                    const isStackPairResizing = activeToolColumnResizeId === `${item.column.id}:${stackHandleIndex}`;

                    return (
                      <React.Fragment key={stackEntry.kind === "item" ? stackEntry.island.id : `main-stack-preview-${item.column.id}-${stackIndex}`}>
                        {stackIndex > 0 && (
                          canResizeStackPair ? (
                            <div
                              className="resize-row group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                              style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
                              onMouseDown={(event) => onToolColumnResizeStart(
                                item.column.id,
                                stackHandleIndex,
                                item.column.splitRatios,
                                event,
                              )}
                              onDoubleClick={() => workspace.setTopToolColumnSplitRatios(
                                item.column.id,
                                equalWidthFractions(item.islands.length),
                              )}
                            >
                              <div
                                className={`h-0.5 w-10 rounded-full transition-colors duration-150 ${
                                  isStackPairResizing
                                    ? "bg-foreground/40"
                                    : "bg-transparent group-hover:bg-foreground/25"
                                }`}
                              />
                            </div>
                          ) : (
                            <div className="h-2 shrink-0" style={isIsland ? { height: "var(--island-panel-gap)" } : undefined} />
                          )
                        )}
                        {stackEntry.kind === "preview" ? (
                          <div
                            className="flex min-h-0"
                            style={{ flex: `${stackFraction} 1 0%`, minHeight: 0 }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const rect = event.currentTarget.getBoundingClientRect();
                              const intent = getToolColumnDropIntent(rect, event.clientX, event.clientY);
                              if (intent.area === "top" && !canAddMainTopColumn) {
                                setMainToolDrag((current) => current ? {
                                  ...current,
                                  targetArea: null,
                                  targetIndex: null,
                                  targetColumnId: null,
                                } : current);
                                return;
                              }
                              setMainToolDrag((current) => current ? {
                                ...current,
                                targetArea: intent.area,
                                targetIndex: intent.area === "top"
                                  ? (intent.side === "before" ? insertBeforeIndex : insertBeforeIndex + 1)
                                  : (intent.side === "before" ? stackInsertBeforeIndex : stackInsertBeforeIndex + 1),
                                targetColumnId: intent.area === "top-stack" ? item.column.id : null,
                              } : current);
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onCommitDrop();
                            }}
                          >
                            <PanelDockPreview orientation="vertical" label={mainToolLabel ?? undefined} className="min-h-0 flex-1" />
                          </div>
                        ) : (
                          <div
                            className="island flex min-h-0 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                            style={{ flex: `${stackFraction} 1 0%`, minHeight: 0 }}
                            onDragOver={(event) => {
                              if (!mainToolDrag || mainToolDrag.islandId === stackEntry.island.id) return;
                              event.preventDefault();
                              event.stopPropagation();
                              const rect = event.currentTarget.getBoundingClientRect();
                              const intent = getToolColumnDropIntent(rect, event.clientX, event.clientY);
                              if (intent.area === "top" && !canAddMainTopColumn) {
                                setMainToolDrag((current) => current ? {
                                  ...current,
                                  targetArea: null,
                                  targetIndex: null,
                                  targetColumnId: null,
                                } : current);
                                return;
                              }
                              setMainToolDrag((current) => current ? {
                                ...current,
                                targetArea: intent.area,
                                targetIndex: intent.area === "top"
                                  ? (intent.side === "before" ? insertBeforeIndex : insertBeforeIndex + 1)
                                  : (intent.side === "before" ? stackInsertBeforeIndex : stackInsertBeforeIndex + 1),
                                targetColumnId: intent.area === "top-stack" ? item.column.id : null,
                              } : current);
                            }}
                            onDrop={(event) => {
                              if (!mainToolDrag) return;
                              event.preventDefault();
                              event.stopPropagation();
                              onCommitDrop();
                            }}
                          >
                            {renderToolContent(stackEntry.island.toolId, (
                              <PanelDockControls
                                isBottom={false}
                                moveLabel="Move to bottom"
                                onMovePlacement={() => workspace.moveToolIsland(stackEntry.island.id, "bottom")}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData("text/plain", stackEntry.island.id);
                                  event.dataTransfer.effectAllowed = "move";
                                  setMainToolDrag({
                                    toolId: stackEntry.island.toolId,
                                    sourceSessionId: null,
                                    islandId: stackEntry.island.id,
                                    targetArea: null,
                                    targetIndex: null,
                                    targetColumnId: null,
                                  });
                                }}
                                onDragEnd={onResetDrag}
                              />
                            ))}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
                {displayIndex < topEntries.length - 1 && (
                  <SplitHandle
                    isIsland={isIsland}
                    isResizing={topPaneResize.isResizing}
                    onResizeStart={(event) => topPaneResize.handleSplitResizeStart(displayIndex, event)}
                    onDoubleClick={topPaneResize.handleSplitDoubleClick}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
