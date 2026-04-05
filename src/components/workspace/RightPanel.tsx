import React from "react";
import { TodoPanel } from "@/components/TodoPanel";
import { BackgroundAgentsPanel } from "@/components/BackgroundAgentsPanel";
import type { TodoItem, BackgroundAgent } from "@/types";

interface RightPanelLayoutProps {
  isIsland: boolean;
  isResizing: boolean;
  rightPanelRef: React.RefObject<HTMLDivElement | null>;
  rightPanelWidth: number;
  rightSplitRatio: number;
  splitGap: number;
  handleResizeStart: (e: React.MouseEvent) => void;
  handleRightSplitStart: (e: React.MouseEvent) => void;
}

interface RightPanelContentProps {
  hasTodos: boolean;
  hasAgents: boolean;
  activeTools: ReadonlySet<string>;
  activeTodos: TodoItem[];
  bgAgents: {
    agents: BackgroundAgent[];
    dismissAgent: (id: string) => void;
    stopAgent: (id: string, taskId: string) => void;
  };
  expandEditToolCallsByDefault: boolean;
}

interface RightPanelProps {
  layout: RightPanelLayoutProps;
  content: RightPanelContentProps;
}

export const RightPanel = React.memo(function RightPanel({
  layout,
  content,
}: RightPanelProps) {
  const {
    isIsland,
    isResizing,
    rightPanelRef,
    rightPanelWidth,
    rightSplitRatio,
    splitGap,
    handleResizeStart,
    handleRightSplitStart,
  } = layout;
  const {
    hasTodos,
    hasAgents,
    activeTools,
    activeTodos,
    bgAgents,
    expandEditToolCallsByDefault,
  } = content;
  const showTodos = hasTodos && activeTools.has("tasks");
  const showAgents = hasAgents && activeTools.has("agents");
  const bothVisible = showTodos && showAgents;

  return (
    <>
      {/* Resize handle -- between chat and right panel */}
      <div
        className="resize-col flat-divider-soft group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
        style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
        onMouseDown={handleResizeStart}
      >
        <div
          className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${
            isResizing
              ? "bg-foreground/40"
              : "bg-transparent group-hover:bg-foreground/25"
          }`}
        />
      </div>

      {/* Right panel -- Tasks / Agents with optional draggable vertical split */}
      <div
        ref={rightPanelRef}
        className="flex shrink-0 flex-col overflow-hidden"
        style={{ width: rightPanelWidth }}
      >
        {showTodos && (
          <div
            className="island flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
            style={
              bothVisible
                ? { height: `calc(${rightSplitRatio * 100}% - ${splitGap}px)`, flexShrink: 0 }
                : { flex: "1 1 0%", minHeight: 0 }
            }
          >
            <TodoPanel todos={activeTodos} />
          </div>
        )}
        {bothVisible && (
          <div
            className="resize-row group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
            style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
            onMouseDown={handleRightSplitStart}
          >
            <div
              className={`w-10 h-0.5 rounded-full transition-colors duration-150 ${
                isResizing
                  ? "bg-foreground/40"
                  : "bg-transparent group-hover:bg-foreground/25"
              }`}
            />
          </div>
        )}
        {showAgents && (
          <div
            className="island flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
            style={
              bothVisible
                ? { height: `calc(${(1 - rightSplitRatio) * 100}% - ${splitGap}px)`, flexShrink: 0 }
                : { flex: "1 1 0%", minHeight: 0 }
            }
          >
            <BackgroundAgentsPanel
              agents={bgAgents.agents}
              expandEditToolCallsByDefault={expandEditToolCallsByDefault}
              onDismiss={bgAgents.dismissAgent}
              onStopAgent={bgAgents.stopAgent}
            />
          </div>
        )}
      </div>
    </>
  );
});
