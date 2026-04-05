/**
 * Kanban board grid: columns with issue cards, drag-and-drop between columns.
 * Handles column drag events and delegates issue rendering to JiraIssueCard.
 */

import React, { useCallback } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getCategoryTone, getCategoryLabel } from "@/lib/jira-utils";
import { JiraIssueCard } from "./JiraIssueCard";
import type { BoardColumn } from "@/hooks/useJiraBoardData";
import type { JiraIssue } from "@shared/types/jira";

interface KanbanBoardProps {
  projectId: string;
  columns: BoardColumn[];
  loadingIssues: boolean;
  error: string | null;
  issueCount: number;
  dropColumnId: string | null;
  movingIssueKey: string | null;
  onDragStart: (issueKey: string) => void;
  onDragEnd: () => void;
  onDropColumn: (columnId: string | null) => void;
  onIssueDrop: (column: BoardColumn) => void;
  onCreateTask: (projectId: string, issue: JiraIssue) => void;
  onPreview: (issue: JiraIssue, sourceRect: DOMRect) => void;
}

export const KanbanBoard = React.memo(function KanbanBoard({
  projectId,
  columns,
  loadingIssues,
  error,
  issueCount,
  dropColumnId,
  movingIssueKey,
  onDragStart,
  onDragEnd,
  onDropColumn,
  onIssueDrop,
  onCreateTask,
  onPreview,
}: KanbanBoardProps) {
  if (loadingIssues) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-sm text-red-500">{error}</div>;
  }

  if (issueCount === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">No issues found in this board</div>
    );
  }

  return (
    <div className="flex h-full min-w-max gap-4 p-4">
      {columns.map((column) => (
        <KanbanColumn
          key={column.id}
          column={column}
          projectId={projectId}
          isDropTarget={dropColumnId === column.id}
          isDragEnabled={movingIssueKey === null}
          movingIssueKey={movingIssueKey}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDropColumn={onDropColumn}
          onIssueDrop={onIssueDrop}
          onCreateTask={onCreateTask}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
});

// ── Column sub-component ──

interface KanbanColumnProps {
  column: BoardColumn;
  projectId: string;
  isDropTarget: boolean;
  isDragEnabled: boolean;
  movingIssueKey: string | null;
  onDragStart: (issueKey: string) => void;
  onDragEnd: () => void;
  onDropColumn: (columnId: string | null) => void;
  onIssueDrop: (column: BoardColumn) => void;
  onCreateTask: (projectId: string, issue: JiraIssue) => void;
  onPreview: (issue: JiraIssue, sourceRect: DOMRect) => void;
}

const KanbanColumn = React.memo(function KanbanColumn({
  column,
  projectId,
  isDropTarget,
  isDragEnabled,
  movingIssueKey,
  onDragStart,
  onDragEnd,
  onDropColumn,
  onIssueDrop,
  onCreateTask,
  onPreview,
}: KanbanColumnProps) {
  const tone = getCategoryTone(column.category);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      onDropColumn(column.id);
    },
    [column.id, onDropColumn],
  );

  const handleDragLeave = useCallback(() => {
    onDropColumn(null);
  }, [onDropColumn]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      onIssueDrop(column);
    },
    [column, onIssueDrop],
  );

  return (
    <div
      className={`flex h-full w-[300px] shrink-0 flex-col rounded-xl border ${tone.column} transition-colors ${
        isDropTarget ? "ring-2 ring-foreground/20" : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="border-b border-border/60 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.stripe}`} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{column.name}</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                {getCategoryLabel(column.category)}
              </p>
            </div>
          </div>
          <Badge variant="outline" className={`shrink-0 ${tone.pill}`}>
            {column.issues.length}
          </Badge>
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {column.issues.map((issue) => (
          <JiraIssueCard
            key={issue.key}
            issue={issue}
            projectId={projectId}
            isDragEnabled={isDragEnabled}
            isMoving={movingIssueKey === issue.key}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onCreateTask={onCreateTask}
            onPreview={onPreview}
          />
        ))}
      </div>
    </div>
  );
});
