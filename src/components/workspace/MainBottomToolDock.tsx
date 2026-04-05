import React, { type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import type { MainToolWorkspaceState } from "@/hooks/useMainToolWorkspace";
import { equalWidthFractions } from "@/lib/layout/constants";
import { getHorizontalInsertSide } from "@/lib/workspace/drag";
import { PanelDockControls } from "@/components/PanelDockControls";
import { PanelDockPreview } from "@/components/PanelDockPreview";
import { SplitHandle } from "@/components/split/SplitHandle";
import type { PanelToolId } from "@/types/tools";
import type { PaneResizeController, ToolDragState, ToolIsland } from "@/types";

interface MainBottomToolDockLayoutProps {
  isIsland: boolean;
  isResizeActive: boolean;
  isBottomHeightResizing: boolean;
  bottomRowRef: RefObject<HTMLDivElement | null>;
  bottomPaneResize: PaneResizeController;
  onBottomResizeStart: (event: React.MouseEvent) => void;
  onMoveBottomToolToTop: (islandId: string) => void;
}

interface MainBottomToolDockDragProps {
  mainToolDrag: ToolDragState | null;
  setMainToolDrag: Dispatch<SetStateAction<ToolDragState | null>>;
  mainDraggedIsland: ToolIsland | null;
  mainToolLabel: string | null;
  onCommitDrop: () => void;
  onResetDrag: () => void;
}

interface MainBottomToolDockProps {
  layout: MainBottomToolDockLayoutProps;
  workspace: MainToolWorkspaceState;
  drag: MainBottomToolDockDragProps;
  renderToolContent: (toolId: PanelToolId, controls: ReactNode) => ReactNode;
}

export function MainBottomToolDock({
  layout,
  workspace,
  drag,
  renderToolContent,
}: MainBottomToolDockProps) {
  const {
    isIsland,
    isResizeActive,
    isBottomHeightResizing,
    bottomRowRef,
    bottomPaneResize,
    onBottomResizeStart,
    onMoveBottomToolToTop,
  } = layout;
  const {
    mainToolDrag,
    setMainToolDrag,
    mainDraggedIsland,
    mainToolLabel,
    onCommitDrop,
    onResetDrag,
  } = drag;
  const bottomRowRenderEntries: Array<
    | { kind: "item"; island: (typeof workspace.bottomToolIslands)[number] }
    | { kind: "preview" }
  > = (() => {
    const draggedIslandId = mainToolDrag?.targetArea !== null
      ? (mainDraggedIsland?.id ?? null)
      : null;
    const baseIslands = draggedIslandId
      ? workspace.bottomToolIslands.filter((island) => island.id !== draggedIslandId)
      : workspace.bottomToolIslands;

    if (mainToolDrag?.targetArea !== "bottom" || mainToolDrag.targetIndex === null) {
      return baseIslands.map((island) => ({ kind: "item" as const, island }));
    }

    const next: Array<
      | { kind: "item"; island: (typeof workspace.bottomToolIslands)[number] }
      | { kind: "preview" }
    > = baseIslands.map((island) => ({ kind: "item" as const, island }));
    const insertIndex = Math.max(0, Math.min(mainToolDrag.targetIndex, next.length));
    next.splice(insertIndex, 0, { kind: "preview" });
    return next;
  })();
  const bottomPreviewAffectsLayout = !!mainToolDrag && (
    mainToolDrag.targetArea === "bottom" || mainDraggedIsland?.dock === "bottom"
  );
  const bottomPreviewFractions = bottomPreviewAffectsLayout
    ? equalWidthFractions(Math.max(bottomRowRenderEntries.length, 1))
    : (workspace.bottomWidthFractions.length === workspace.bottomToolIslands.length
      ? workspace.bottomWidthFractions
      : equalWidthFractions(workspace.bottomToolIslands.length));

  if (bottomRowRenderEntries.length === 0 && mainToolDrag?.targetArea !== "bottom") {
    return null;
  }

  return (
    <>
      <div
        className="resize-row flat-divider-soft group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
        style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
        onMouseDown={workspace.bottomToolIslands.length > 0 ? onBottomResizeStart : undefined}
      >
        <div
          className={`h-0.5 w-10 rounded-full transition-colors duration-150 ${
            isResizeActive || isBottomHeightResizing
              ? "bg-foreground/40"
              : "bg-transparent group-hover:bg-foreground/25"
          }`}
        />
      </div>
      <div
        ref={bottomRowRef}
        className="flex shrink-0 overflow-hidden"
        style={{ height: workspace.bottomToolIslands.length > 0 ? workspace.bottomHeight : 120 }}
      >
        {bottomRowRenderEntries.length === 0 && mainToolDrag?.targetArea === "bottom" && (
          <div
            className="flex min-h-0 flex-1 px-6 pb-1"
            onDragOver={(event) => {
              event.preventDefault();
              setMainToolDrag((current) => current ? {
                ...current,
                targetArea: "bottom",
                targetIndex: 0,
                targetColumnId: null,
              } : current);
            }}
            onDrop={(event) => {
              event.preventDefault();
              onCommitDrop();
            }}
          >
            <PanelDockPreview orientation="horizontal" label={mainToolLabel ?? undefined} className="mx-auto h-16 w-full max-w-[420px]" />
          </div>
        )}
        {bottomRowRenderEntries.map((entry, displayIndex) => {
          const fraction = bottomPreviewFractions[displayIndex] ?? (1 / Math.max(bottomRowRenderEntries.length, 1));
          const insertBeforeIndex = bottomRowRenderEntries
            .slice(0, displayIndex)
            .filter((candidate) => candidate.kind === "item")
            .length;

          return (
            <React.Fragment key={entry.kind === "item" ? entry.island.id : `main-bottom-preview-${displayIndex}`}>
              {entry.kind === "preview" ? (
                <div
                  className="mx-1 flex min-h-0"
                  style={{ flex: `${fraction} 1 0%`, minWidth: 0 }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setMainToolDrag((current) => current ? {
                      ...current,
                      targetArea: "bottom",
                      targetIndex: insertBeforeIndex,
                      targetColumnId: null,
                    } : current);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    onCommitDrop();
                  }}
                >
                  <PanelDockPreview orientation="horizontal" label={mainToolLabel ?? undefined} className="min-h-0 flex-1" />
                </div>
              ) : (
                <div
                  className="island flex min-h-0 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                  style={{ flex: `${fraction} 1 0%`, minWidth: 0 }}
                  onDragOver={(event) => {
                    if (!mainToolDrag || mainToolDrag.islandId === entry.island.id) return;
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    const insertSide = getHorizontalInsertSide(rect, event.clientX);
                    if (!insertSide) return;
                    setMainToolDrag((current) => current ? {
                      ...current,
                      targetArea: "bottom",
                      targetIndex: insertSide === "before" ? insertBeforeIndex : insertBeforeIndex + 1,
                      targetColumnId: null,
                    } : current);
                  }}
                  onDrop={(event) => {
                    if (!mainToolDrag) return;
                    event.preventDefault();
                    onCommitDrop();
                  }}
                >
                  {renderToolContent(entry.island.toolId, (
                    <PanelDockControls
                      isBottom={true}
                      moveLabel="Move to top row"
                      onMovePlacement={() => onMoveBottomToolToTop(entry.island.id)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", entry.island.id);
                        event.dataTransfer.effectAllowed = "move";
                        setMainToolDrag({
                          toolId: entry.island.toolId,
                          sourceSessionId: null,
                          islandId: entry.island.id,
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
              {displayIndex < bottomRowRenderEntries.length - 1 && (
                <SplitHandle
                  isIsland={isIsland}
                  isResizing={bottomPaneResize.isResizing}
                  onResizeStart={(event) => bottomPaneResize.handleSplitResizeStart(displayIndex, event)}
                  onDoubleClick={bottomPaneResize.handleSplitDoubleClick}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}
