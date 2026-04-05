/**
 * Individual Jira issue card for the kanban board.
 * Wrapped in React.memo to skip re-renders when issue data hasn't changed.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, ExternalLink } from "lucide-react";
import { getInitials, getPriorityTone } from "@/lib/jira-utils";
import type { JiraIssue } from "@shared/types/jira";

interface JiraIssueCardProps {
  issue: JiraIssue;
  projectId: string;
  isDragEnabled: boolean;
  isMoving: boolean;
  onDragStart: (issueKey: string) => void;
  onDragEnd: () => void;
  onCreateTask: (projectId: string, issue: JiraIssue) => void;
  onPreview: (issue: JiraIssue, sourceRect: DOMRect) => void;
}

export const JiraIssueCard = React.memo(function JiraIssueCard({
  issue,
  projectId,
  isDragEnabled,
  isMoving,
  onDragStart,
  onDragEnd,
  onCreateTask,
  onPreview,
}: JiraIssueCardProps) {
  const canCreateTask = issue.statusCategory !== "done";
  const priorityTone = getPriorityTone(issue.priority?.name);

  return (
    <div
      draggable={isDragEnabled}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", issue.key);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(issue.key);
      }}
      onDragEnd={onDragEnd}
      className={`group rounded-xl border border-border/70 bg-background/90 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-all ${
        isDragEnabled ? "cursor-grab active:cursor-grabbing" : "cursor-progress"
      } ${isMoving ? "opacity-50" : "hover:-translate-y-0.5 hover:border-border hover:bg-background"}`}
    >
      {/* Header: key, type, priority + avatar */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {issue.key}
            </span>
            {issue.issueType && (
              <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {issue.issueType.name}
              </span>
            )}
            {issue.priority && (
              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${priorityTone}`}>
                {issue.priority.name}
              </span>
            )}
          </div>
          <h4 className="wrap-break-word text-sm font-semibold leading-5">{issue.summary}</h4>
        </div>
        {issue.assignee && (
          <Avatar size="sm" className="h-8 w-8 shrink-0 ring-1 ring-border/60">
            {issue.assignee.avatarUrl && (
              <AvatarImage src={issue.assignee.avatarUrl} alt={issue.assignee.displayName} />
            )}
            <AvatarFallback className="bg-foreground/10 text-[11px] font-semibold text-foreground/80">
              {getInitials(issue.assignee.displayName)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      {/* Meta row */}
      <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{issue.assignee?.displayName ?? "Unassigned"}</span>
        <span className="truncate">{issue.status}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {canCreateTask && (
          <Button size="sm" onClick={() => onCreateTask(projectId, issue)} className="h-7 flex-1 text-xs">
            <Plus className="w-3 h-3 me-1" />
            Create Task
          </Button>
        )}
        <Button
          variant={canCreateTask ? "ghost" : "secondary"}
          size="sm"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onPreview(issue, rect);
          }}
          className={`h-7 px-2 text-xs ${canCreateTask ? "" : "flex-1 justify-center"}`}
        >
          <ExternalLink className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
});
