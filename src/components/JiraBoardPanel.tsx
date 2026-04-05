/**
 * Jira board panel -- orchestrator component.
 * Delegates to JiraBoardSetup (wizard), KanbanBoard (board grid),
 * and useJiraBoardData (all data-fetching state).
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JiraAuthDialog } from "./JiraAuthDialog";
import { JiraIssuePreviewOverlay } from "./JiraIssuePreviewOverlay";
import { JiraBoardSetup } from "./jira/JiraBoardSetup";
import { KanbanBoard } from "./jira/KanbanBoard";
import { useJiraConfig } from "@/hooks/useJiraConfig";
import { useJiraBoardData, SORT_LABELS } from "@/hooks/useJiraBoardData";
import type { SortOption } from "@/hooks/useJiraBoardData";
import type { JiraIssue } from "@shared/types/jira";
import {
  Loader2,
  Settings,
  ChevronDown,
  ArrowUpDown,
  Check,
  ArrowLeft,
  KanbanSquare,
  PanelLeft,
} from "lucide-react";
import { isMac } from "@/lib/utils";

// ── Props ──

interface JiraBoardPanelProps {
  projectId: string | null;
  projectName?: string;
  variant?: "panel" | "main";
  onClose?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onCreateTask: (projectId: string, issue: JiraIssue) => void;
}

// ── Component ──

export const JiraBoardPanel = React.memo(function JiraBoardPanel({
  projectId,
  projectName,
  variant = "panel",
  onClose,
  sidebarOpen = true,
  onToggleSidebar,
  onCreateTask,
}: JiraBoardPanelProps) {
  const { config, loading: configLoading, saveConfig, deleteConfig } = useJiraConfig(projectId);
  const isMainView = variant === "main";
  const headerPaddingClass = isMainView && !sidebarOpen && isMac ? "ps-[78px]" : "";

  const boardData = useJiraBoardData({ config });

  const [showSetup, setShowSetup] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [previewIssue, setPreviewIssue] = useState<{ issue: JiraIssue; sourceRect: DOMRect } | null>(null);

  // Show setup if no config
  useEffect(() => {
    if (!configLoading && !config) {
      setShowSetup(true);
    } else if (config) {
      setShowSetup(false);
    }
  }, [config, configLoading]);

  // Reset setup wizard state when entering setup mode
  useEffect(() => {
    if (showSetup) {
      boardData.resetSetupOptions();
    }
  }, [showSetup, boardData.resetSetupOptions]);

  const handleBoardChange = useCallback(
    (boardId: string) => void boardData.handleBoardChange(boardId, saveConfig),
    [boardData.handleBoardChange, saveConfig],
  );

  const handleDeleteConfig = useCallback(async () => {
    await deleteConfig();
    boardData.resetAll();
    setShowSetup(true);
  }, [deleteConfig, boardData.resetAll]);

  const handleAuthSuccess = useCallback(async () => {
    await boardData.loadSetupOptions(config?.instanceUrl ?? "", config?.projectKey ?? "");
  }, [boardData.loadSetupOptions, config?.instanceUrl, config?.projectKey]);

  const handleDragStart = useCallback(
    (issueKey: string) => boardData.setDraggingIssueKey(issueKey),
    [boardData.setDraggingIssueKey],
  );

  const handleDragEnd = useCallback(() => {
    boardData.setDraggingIssueKey(null);
    boardData.setDropColumnId(null);
  }, [boardData.setDraggingIssueKey, boardData.setDropColumnId]);

  const handlePreview = useCallback((issue: JiraIssue, sourceRect: DOMRect) => {
    setPreviewIssue({ issue, sourceRect });
  }, []);

  // ── Early returns ──

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-full p-4 text-center text-muted-foreground">
        <p>No project selected</p>
      </div>
    );
  }

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (showSetup) {
    return (
      <JiraBoardSetup
        projectName={projectName}
        isMainView={isMainView}
        headerPaddingClass={headerPaddingClass}
        sidebarOpen={sidebarOpen}
        onClose={onClose}
        onToggleSidebar={onToggleSidebar}
        saveConfig={saveConfig}
        boards={boardData.boards}
        loadingBoards={boardData.loadingBoards}
        selectedBoardId={boardData.selectedBoardId}
        setSelectedBoardId={boardData.setSelectedBoardId}
        visibleProjects={boardData.visibleProjects}
        setupOptionsLoaded={boardData.setupOptionsLoaded}
        loadSetupOptions={boardData.loadSetupOptions}
        resetSetupOptions={boardData.resetSetupOptions}
        error={boardData.error}
        setError={boardData.setError}
        initialInstanceUrl={config?.instanceUrl ?? ""}
        initialProjectKey={config?.projectKey ?? ""}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={`flex-shrink-0 border-b border-border px-4 py-3 space-y-3 ${isMainView ? headerPaddingClass : ""}`}>
        <div className={`flex items-center justify-between ${isMainView ? "drag-region" : ""}`}>
          <div className="flex min-w-0 items-start gap-3">
            {onToggleSidebar && !sidebarOpen && (
              <Button
                variant="ghost"
                size="icon"
                className="no-drag mt-0.5 h-7 w-7 shrink-0 text-muted-foreground/60 hover:text-foreground"
                onClick={onToggleSidebar}
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <KanbanSquare className="h-4 w-4 shrink-0" />
                <h3 className="truncate">{projectName ? `${projectName} Jira Board` : "Jira Board"}</h3>
              </div>
              {config && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {config.projectKey ? `${config.projectKey} on ${config.instanceUrl}` : config.instanceUrl}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose} className="no-drag h-8 gap-1.5 px-2">
                <ArrowLeft className="h-4 w-4" />
                Back to Chat
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              className="no-drag h-7 px-2"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Board selector */}
        {boardData.boards.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <span className="truncate">
                  {boardData.boards.find((b) => b.id === boardData.selectedBoardId)?.name || "Select a board"}
                </span>
                <ChevronDown className="w-4 h-4 ms-2 flex-shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
              {boardData.boards.map((board) => (
                <DropdownMenuItem key={board.id} onClick={() => handleBoardChange(board.id)}>
                  {board.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Sprint selector */}
        {boardData.sprints.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-between text-xs">
                <span className="truncate">
                  {boardData.selectedSprintId
                    ? (boardData.sprints.find((s) => s.id === boardData.selectedSprintId)?.name ?? "Select sprint")
                    : "All issues"}
                </span>
                <ChevronDown className="w-3 h-3 ms-2 flex-shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
              <DropdownMenuItem
                onClick={() => boardData.setSelectedSprintId("")}
                className="flex items-center justify-between"
              >
                All issues
                {!boardData.selectedSprintId && <Check className="w-3 h-3 ms-2 text-muted-foreground" />}
              </DropdownMenuItem>
              {boardData.sprints.map((sprint) => (
                <DropdownMenuItem
                  key={sprint.id}
                  onClick={() => boardData.setSelectedSprintId(sprint.id)}
                  className="flex items-center justify-between"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{sprint.name}</span>
                    {sprint.state === "active" && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                        active
                      </Badge>
                    )}
                  </span>
                  {boardData.selectedSprintId === sprint.id && (
                    <Check className="w-3 h-3 ms-2 text-muted-foreground shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Sort dropdown */}
        {boardData.issues.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-full justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <ArrowUpDown className="w-3 h-3" />
                  Sort: {SORT_LABELS[boardData.sortBy]}
                </span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
              {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                <DropdownMenuItem
                  key={option}
                  onClick={() => boardData.setSortBy(option)}
                  className="flex items-center justify-between"
                >
                  {SORT_LABELS[option]}
                  {boardData.sortBy === option && <Check className="w-3 h-3 ms-2 text-muted-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Drag hint */}
      <div className="border-b border-border/50 px-4 py-2 text-[11px] text-muted-foreground">
        Drag cards between columns to transition them in Jira.
      </div>

      {/* Board grid */}
      <div className="flex-1 min-h-0 overflow-auto">
        <KanbanBoard
          projectId={projectId}
          columns={boardData.boardColumns}
          loadingIssues={boardData.loadingIssues}
          error={boardData.error}
          issueCount={boardData.issues.length}
          dropColumnId={boardData.dropColumnId}
          movingIssueKey={boardData.movingIssueKey}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDropColumn={boardData.setDropColumnId}
          onIssueDrop={boardData.handleIssueDrop}
          onCreateTask={onCreateTask}
          onPreview={handlePreview}
        />
      </div>

      {/* Dialogs */}
      <JiraAuthDialog
        open={showAuth}
        onOpenChange={setShowAuth}
        instanceUrl={config?.instanceUrl || ""}
        onSuccess={handleAuthSuccess}
      />

      <JiraIssuePreviewOverlay
        issue={previewIssue?.issue ?? null}
        sourceRect={previewIssue?.sourceRect ?? null}
        instanceUrl={config?.instanceUrl}
        onClose={() => setPreviewIssue(null)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={() => void handleDeleteConfig()}
        title="Remove Jira Configuration"
        description="This will disconnect the Jira board from this project. You can reconnect it later."
        confirmLabel="Remove"
      />
    </div>
  );
});
