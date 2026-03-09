/**
 * Panel for displaying Jira board and creating tasks from issues
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JiraAuthDialog } from "./JiraAuthDialog";
import { JiraIssuePreviewOverlay } from "./JiraIssuePreviewOverlay";
import { useJiraConfig } from "@/hooks/useJiraConfig";
import type { JiraBoard, JiraIssue, JiraSprint, JiraProjectConfig, JiraTransition, JiraBoardColumn, JiraProjectSummary } from "@shared/types/jira";
import { Loader2, Settings, ExternalLink, Plus, ChevronDown, ArrowUpDown, Check, ArrowLeft, KanbanSquare, PanelLeft } from "lucide-react";
import { isMac } from "@/lib/utils";

type SortOption = "default" | "status" | "priority" | "type" | "assignee" | "key";

const SORT_LABELS: Record<SortOption, string> = {
  default: "Rank",
  status: "Status",
  priority: "Priority",
  type: "Type",
  assignee: "Assignee",
  key: "Key",
};

const PRIORITY_ORDER: Record<string, number> = {
  Highest: 0,
  High: 1,
  Medium: 2,
  Low: 3,
  Lowest: 4,
};

const STATUS_CATEGORY_ORDER: Record<NonNullable<JiraIssue["statusCategory"]>, number> = {
  todo: 0,
  indeterminate: 1,
  done: 2,
};

interface BoardColumn {
  id: string;
  name: string;
  category?: JiraIssue["statusCategory"];
  statusIds: string[];
  issues: JiraIssue[];
  min?: number;
  max?: number;
}

function getCategoryTone(category?: JiraIssue["statusCategory"]) {
  switch (category) {
    case "todo":
      return {
        stripe: "bg-slate-400/80",
        pill: "bg-slate-500/10 text-slate-200 border-slate-400/20",
        column: "border-slate-400/15 bg-slate-500/[0.06]",
      };
    case "done":
      return {
        stripe: "bg-emerald-400/80",
        pill: "bg-emerald-500/10 text-emerald-200 border-emerald-400/20",
        column: "border-emerald-400/15 bg-emerald-500/[0.06]",
      };
    default:
      return {
        stripe: "bg-amber-400/80",
        pill: "bg-amber-500/10 text-amber-200 border-amber-400/20",
        column: "border-amber-400/15 bg-amber-500/[0.06]",
      };
  }
}

function getCategoryLabel(category?: JiraIssue["statusCategory"]) {
  switch (category) {
    case "todo":
      return "To do";
    case "done":
      return "Done";
    default:
      return "In progress";
  }
}

function getStatusCategoryRank(category?: JiraIssue["statusCategory"]) {
  if (!category) return 1;
  return STATUS_CATEGORY_ORDER[category] ?? 1;
}

function getAssigneeInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function deriveColumnCategory(column: JiraBoardColumn, issues: JiraIssue[]): JiraIssue["statusCategory"] {
  const matchingIssue = issues.find((issue) => issue.statusId && column.statusIds.includes(issue.statusId));
  return matchingIssue?.statusCategory;
}

function buildColumns(issues: JiraIssue[], sortBy: SortOption, boardColumns: JiraBoardColumn[]): BoardColumn[] {
  const orderedIssues = sortIssues(issues, sortBy);
  if (boardColumns.length > 0) {
    const configuredColumns: BoardColumn[] = boardColumns
      .filter((column) => column.statusIds.length > 0)
      .map((column) => ({
        id: column.id,
        name: column.name,
        category: deriveColumnCategory(column, issues),
        statusIds: column.statusIds,
        min: column.min,
        max: column.max,
        issues: [],
      }));

    const fallbackColumns = new Map<string, BoardColumn>();

    for (const issue of orderedIssues) {
      const matchedColumn = configuredColumns.find((column) =>
        issue.statusId ? column.statusIds.includes(issue.statusId) : false,
      );
      if (matchedColumn) {
        matchedColumn.issues.push(issue);
        if (!matchedColumn.category) {
          matchedColumn.category = issue.statusCategory;
        }
        continue;
      }

      const fallbackId = issue.statusId ?? issue.status;
      const existing = fallbackColumns.get(fallbackId);
      if (existing) {
        existing.issues.push(issue);
      } else {
        fallbackColumns.set(fallbackId, {
          id: fallbackId,
          name: issue.status,
          category: issue.statusCategory,
          statusIds: issue.statusId ? [issue.statusId] : [],
          issues: [issue],
        });
      }
    }

    return [...configuredColumns, ...fallbackColumns.values()];
  }

  const inferred = new Map<string, BoardColumn>();
  for (const issue of orderedIssues) {
    const id = issue.statusId ?? issue.status;
    const existing = inferred.get(id);
    if (existing) {
      existing.issues.push(issue);
      continue;
    }
    inferred.set(id, {
      id,
      name: issue.status,
      category: issue.statusCategory,
      statusIds: issue.statusId ? [issue.statusId] : [],
      issues: [issue],
    });
  }

  return Array.from(inferred.values()).sort((a, b) => {
    const categoryDiff = getStatusCategoryRank(a.category) - getStatusCategoryRank(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    return a.name.localeCompare(b.name);
  });
}

function sortIssues(issues: JiraIssue[], sortBy: SortOption): JiraIssue[] {
  if (sortBy === "default") return issues;

  return [...issues].sort((a, b) => {
    switch (sortBy) {
      case "status":
        return a.status.localeCompare(b.status);
      case "priority": {
        const pa = a.priority?.name ? (PRIORITY_ORDER[a.priority.name] ?? 99) : 99;
        const pb = b.priority?.name ? (PRIORITY_ORDER[b.priority.name] ?? 99) : 99;
        return pa - pb;
      }
      case "type": {
        const ta = a.issueType?.name ?? "\uffff";
        const tb = b.issueType?.name ?? "\uffff";
        return ta.localeCompare(tb);
      }
      case "assignee": {
        const aa = a.assignee?.displayName ?? "\uffff";
        const ab = b.assignee?.displayName ?? "\uffff";
        return aa.localeCompare(ab);
      }
      case "key": {
        const numA = parseInt(a.key.replace(/^[A-Z]+-/, ""), 10) || 0;
        const numB = parseInt(b.key.replace(/^[A-Z]+-/, ""), 10) || 0;
        return numA - numB;
      }
      default:
        return 0;
    }
  });
}

interface JiraBoardPanelProps {
  projectId: string | null;
  projectName?: string;
  variant?: "panel" | "main";
  onClose?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onCreateTask: (projectId: string, issue: JiraIssue) => void;
}

export function JiraBoardPanel({
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

  const [showSetup, setShowSetup] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [setupForm, setSetupForm] = useState({
    instanceUrl: "",
  });
  const [visibleProjects, setVisibleProjects] = useState<JiraProjectSummary[]>([]);
  const [selectedSetupProjectKey, setSelectedSetupProjectKey] = useState("");
  const [setupOptionsLoaded, setSetupOptionsLoaded] = useState(false);

  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [boardColumnsConfig, setBoardColumnsConfig] = useState<JiraBoardColumn[]>([]);

  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<string>("");

  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("default");
  const [previewIssue, setPreviewIssue] = useState<{ issue: JiraIssue; sourceRect: DOMRect } | null>(null);
  const [draggingIssueKey, setDraggingIssueKey] = useState<string | null>(null);
  const [dropColumnId, setDropColumnId] = useState<string | null>(null);
  const [movingIssueKey, setMovingIssueKey] = useState<string | null>(null);
  const transitionsCacheRef = useRef<Record<string, JiraTransition[]>>({});

  const boardColumns = useMemo(
    () => buildColumns(issues, sortBy, boardColumnsConfig),
    [issues, sortBy, boardColumnsConfig],
  );

  // Show setup if no config or config not complete
  useEffect(() => {
    if (!configLoading && !config) {
      setShowSetup(true);
    } else if (config) {
      setShowSetup(false);
      setSetupForm({
        instanceUrl: config.instanceUrl,
      });
      setSelectedSetupProjectKey(config.projectKey ?? "");
      setSelectedBoardId(config.boardId);
    }
  }, [config, configLoading]);

  useEffect(() => {
    if (!showSetup) return;
    setSetupOptionsLoaded(false);
    setVisibleProjects([]);
    setBoards([]);
    setSelectedBoardId("");
    setSelectedSetupProjectKey("");
    setError(null);
  }, [setupForm.instanceUrl, showSetup]);

  // Load boards when config is available
  useEffect(() => {
    if (config && config.isAuthenticated) {
      loadBoards();
    }
  }, [config]);

  // Load sprints when board is selected
  useEffect(() => {
    if (config && selectedBoardId && config.isAuthenticated) {
      loadSprints();
      loadBoardConfiguration();
    }
  }, [config, selectedBoardId]);

  // Load issues when board or sprint changes
  useEffect(() => {
    if (config && selectedBoardId && config.isAuthenticated) {
      loadIssues();
    }
  }, [config, selectedBoardId, selectedSprintId]);

  useEffect(() => {
    transitionsCacheRef.current = {};
    setDraggingIssueKey(null);
    setDropColumnId(null);
    setMovingIssueKey(null);
  }, [selectedBoardId, selectedSprintId, config?.instanceUrl]);

  const loadBoards = async () => {
    if (!config) return;

    setLoadingBoards(true);
    setError(null);

    try {
      const loadedBoards = await window.claude.jira.getBoards({
        instanceUrl: config.instanceUrl,
        projectKey: config.projectKey || undefined,
      });
      setBoards(loadedBoards);
      setLoadingBoards(false);
    } catch (err) {
      setError(`Failed to load boards: ${err}`);
      setLoadingBoards(false);
    }
  };

  const loadSetupOptions = useCallback(
    async (instanceUrl: string, projectKey?: string) => {
      setLoadingBoards(true);
      setError(null);

      try {
        const [projects, fetchedBoards] = await Promise.all([
          window.claude.jira.getProjects(instanceUrl),
          window.claude.jira.getBoards({
            instanceUrl,
            projectKey: projectKey || undefined,
          }),
        ]);

        setVisibleProjects(projects);
        setBoards(fetchedBoards);
        setSetupOptionsLoaded(true);
        setSelectedBoardId((prev) =>
          fetchedBoards.some((board) => board.id === prev) ? prev : (fetchedBoards[0]?.id ?? ""),
        );

        if (fetchedBoards.length === 0) {
          setError(
            projectKey
              ? `No boards found for Jira project ${projectKey}.`
              : "No boards found for this Jira account.",
          );
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoadingBoards(false);
      }
    },
    [],
  );

  const loadSprints = async () => {
    if (!config || !selectedBoardId) return;

    try {
      const loadedSprints = await window.claude.jira.getSprints({
        instanceUrl: config.instanceUrl,
        boardId: selectedBoardId,
      });
      setSprints(loadedSprints);
      // Auto-select active sprint if available, otherwise clear selection
      const active = loadedSprints.find((s) => s.state === "active");
      setSelectedSprintId(active?.id ?? "");
    } catch {
      // Sprints not available (e.g., kanban board) — silently clear
      setSprints([]);
      setSelectedSprintId("");
    }
  };

  const loadBoardConfiguration = async () => {
    if (!config || !selectedBoardId) return;

    try {
      const boardConfiguration = await window.claude.jira.getBoardConfiguration({
        instanceUrl: config.instanceUrl,
        boardId: selectedBoardId,
      });
      setBoardColumnsConfig(boardConfiguration.columns);
    } catch (err) {
      console.warn("Failed to load Jira board configuration:", err);
      setBoardColumnsConfig([]);
    }
  };

  const loadIssues = async () => {
    if (!config || !selectedBoardId) return;

    setLoadingIssues(true);
    setError(null);

    try {
      const loadedIssues = await window.claude.jira.getIssues({
        instanceUrl: config.instanceUrl,
        boardId: selectedBoardId,
        sprintId: selectedSprintId || undefined,
        maxResults: 50,
      });
      setIssues(loadedIssues);
      setLoadingIssues(false);
    } catch (err) {
      setError(`Failed to load issues: ${err}`);
      setLoadingIssues(false);
    }
  };

  const getTransitions = useCallback(
    async (issueKey: string) => {
      if (!config) return [];
      const cached = transitionsCacheRef.current[issueKey];
      if (cached) return cached;
      const transitions = await window.claude.jira.getTransitions({
        instanceUrl: config.instanceUrl,
        issueKey,
      });
      transitionsCacheRef.current[issueKey] = transitions;
      return transitions;
    },
    [config],
  );

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!projectId || !setupForm.instanceUrl) {
      setError("Please enter your Jira instance URL");
      return;
    }

    // Check if already authenticated
    const authStatus = await window.claude.jira.authStatus(setupForm.instanceUrl);

    if (!authStatus.hasToken) {
      // Need to authenticate first
      setShowAuth(true);
      return;
    }

    if (!setupOptionsLoaded) {
      await loadSetupOptions(setupForm.instanceUrl, selectedSetupProjectKey);
      return;
    }

    await completeSetup(true);
  };

  const completeSetup = async (isAuthenticated: boolean) => {
    if (!projectId) return;

    try {
      setError(null);
      const selectedBoard = boards.find((board) => board.id === selectedBoardId);
      if (!selectedBoard) {
        setError("Please select a Jira board");
        return;
      }

      const newConfig: JiraProjectConfig = {
        instanceUrl: setupForm.instanceUrl,
        projectKey: selectedSetupProjectKey || undefined,
        boardId: selectedBoard.id,
        boardName: selectedBoard.name,
        authMethod: "apitoken",
        isAuthenticated,
        createdAt: Date.now(),
      };

      await saveConfig(newConfig);
      setShowSetup(false);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleAuthSuccess = async () => {
    await loadSetupOptions(setupForm.instanceUrl, selectedSetupProjectKey);
  };

  const handleDeleteConfig = async () => {
    if (confirm("Are you sure you want to remove the Jira configuration?")) {
      await deleteConfig();
      setBoards([]);
      setBoardColumnsConfig([]);
      setVisibleProjects([]);
      setSprints([]);
      setIssues([]);
      setSelectedBoardId("");
      setSelectedSetupProjectKey("");
      setSetupOptionsLoaded(false);
      setSelectedSprintId("");
      setShowSetup(true);
    }
  };

  const handleBoardChange = async (boardId: string) => {
    if (!config || !projectId) return;

    setSelectedBoardId(boardId);
    setBoardColumnsConfig([]);

    const board = boards.find((b) => b.id === boardId);
    if (board) {
      const updatedConfig: JiraProjectConfig = {
        ...config,
        boardId: board.id,
        boardName: board.name,
      };
      await saveConfig(updatedConfig);
    }
  };

  const handleIssueDrop = useCallback(
    async (column: BoardColumn) => {
      if (!config || !draggingIssueKey) return;

      const issue = issues.find((item) => item.key === draggingIssueKey);
      setDropColumnId(null);
      setDraggingIssueKey(null);
      if (!issue) return;
      if ((issue.statusId ?? issue.status) === column.id) return;

      setMovingIssueKey(issue.key);
      try {
        const transitions = await getTransitions(issue.key);
        const transition = transitions.find(
          (item) => column.statusIds.includes(item.toStatus.id) || item.toStatus.name === column.name,
        );

        if (!transition) {
          toast.error(`No Jira transition available to ${column.name}`);
          return;
        }

        await window.claude.jira.transitionIssue({
          instanceUrl: config.instanceUrl,
          issueKey: issue.key,
          transitionId: transition.id,
        });

        delete transitionsCacheRef.current[issue.key];
        setIssues((prev) =>
          prev.map((item) =>
            item.key === issue.key
              ? {
                  ...item,
                  status: transition.toStatus.name,
                  statusId: transition.toStatus.id || column.statusIds[0] || item.statusId,
                  statusCategory: transition.toStatus.category ?? column.category,
                }
              : item,
          ),
        );
        toast.success(`${issue.key} moved to ${transition.toStatus.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to move Jira issue", { description: message });
      } finally {
        setMovingIssueKey(null);
      }
    },
    [config, draggingIssueKey, getTransitions, issues],
  );

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
      <div className="flex flex-col h-full">
        <div className={`flex-shrink-0 border-b border-border px-4 py-3 ${isMainView ? headerPaddingClass : ""}`}>
          <div className={`flex items-center justify-between gap-3 ${isMainView ? "drag-region" : ""}`}>
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
                  <h3 className="truncate">
                    {projectName ? `${projectName} Jira Board` : "Setup Jira Board"}
                  </h3>
                </div>
                {projectName && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Connect this project to a Jira board.
                  </p>
                )}
              </div>
            </div>
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="no-drag h-8 gap-1.5 px-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <form onSubmit={handleSetupSubmit} className="p-4 space-y-4">
            <div className="space-y-2">
              <label htmlFor="instanceUrl" className="text-sm font-medium">
                Jira Instance URL
              </label>
              <Input
                id="instanceUrl"
                placeholder="https://your-domain.atlassian.net"
                value={setupForm.instanceUrl}
                onChange={(e) =>
                  setSetupForm({ instanceUrl: e.target.value })
                }
                required
              />
              <p className="text-xs text-muted-foreground">
                Your Atlassian cloud instance URL
              </p>
            </div>

            {setupOptionsLoaded && visibleProjects.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Jira Project Filter</label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      <span className="truncate">
                        {selectedSetupProjectKey
                          ? visibleProjects.find((project) => project.key === selectedSetupProjectKey)?.name ?? selectedSetupProjectKey
                          : "All projects"}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuItem
                      onClick={() => {
                        setSelectedSetupProjectKey("");
                        void loadSetupOptions(setupForm.instanceUrl, "");
                      }}
                    >
                      All projects
                    </DropdownMenuItem>
                    {visibleProjects.map((project) => (
                      <DropdownMenuItem
                        key={project.id}
                        onClick={() => {
                          setSelectedSetupProjectKey(project.key);
                          void loadSetupOptions(setupForm.instanceUrl, project.key);
                        }}
                      >
                        <span className="truncate">{project.name}</span>
                        <span className="ms-auto text-[10px] text-muted-foreground">{project.key}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <p className="text-xs text-muted-foreground">
                  Optional. Filter visible Jira boards by project before picking one.
                </p>
              </div>
            )}

            {setupOptionsLoaded && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Jira Board</label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between" disabled={boards.length === 0}>
                      <span className="truncate">
                        {boards.find((board) => board.id === selectedBoardId)?.name || "Select a board"}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    {boards.map((board) => (
                      <DropdownMenuItem
                        key={board.id}
                        onClick={() => setSelectedBoardId(board.id)}
                      >
                        <span className="truncate">{board.name}</span>
                        <span className="ms-auto text-[10px] text-muted-foreground uppercase">{board.type}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <p className="text-xs text-muted-foreground">
                  This board will be bound to the current Harnss project.
                </p>
              </div>
            )}

            {error && (
              <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-md p-3">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={loadingBoards || (setupOptionsLoaded && boards.length === 0)}
            >
              {loadingBoards ? (
                <>
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  Loading...
                </>
              ) : setupOptionsLoaded ? (
                "Connect Board"
              ) : (
                "Load Jira Boards"
              )}
            </Button>
          </form>
        </ScrollArea>

        <JiraAuthDialog
          open={showAuth}
          onOpenChange={setShowAuth}
          instanceUrl={setupForm.instanceUrl}
          onSuccess={handleAuthSuccess}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
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
                <h3 className="truncate">
                  {projectName ? `${projectName} Jira Board` : "Jira Board"}
                </h3>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="no-drag h-8 gap-1.5 px-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Chat
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDeleteConfig}
              className="no-drag h-7 px-2"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {boards.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <span className="truncate">
                  {boards.find((b) => b.id === selectedBoardId)?.name || "Select a board"}
                </span>
                <ChevronDown className="w-4 h-4 ms-2 flex-shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
              {boards.map((board) => (
                <DropdownMenuItem
                  key={board.id}
                  onClick={() => handleBoardChange(board.id)}
                >
                  {board.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {sprints.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-between text-xs">
                <span className="truncate">
                  {selectedSprintId
                    ? sprints.find((s) => s.id === selectedSprintId)?.name ?? "Select sprint"
                    : "All issues"}
                </span>
                <ChevronDown className="w-3 h-3 ms-2 flex-shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
              <DropdownMenuItem
                onClick={() => setSelectedSprintId("")}
                className="flex items-center justify-between"
              >
                All issues
                {!selectedSprintId && <Check className="w-3 h-3 ms-2 text-muted-foreground" />}
              </DropdownMenuItem>
              {sprints.map((sprint) => (
                <DropdownMenuItem
                  key={sprint.id}
                  onClick={() => setSelectedSprintId(sprint.id)}
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
                  {selectedSprintId === sprint.id && <Check className="w-3 h-3 ms-2 text-muted-foreground shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {issues.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-full justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <ArrowUpDown className="w-3 h-3" />
                  Sort: {SORT_LABELS[sortBy]}
                </span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
              {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                <DropdownMenuItem
                  key={option}
                  onClick={() => setSortBy(option)}
                  className="flex items-center justify-between"
                >
                  {SORT_LABELS[option]}
                  {sortBy === option && <Check className="w-3 h-3 ms-2 text-muted-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="border-b border-border/50 px-4 py-2 text-[11px] text-muted-foreground">
        Drag cards between columns to transition them in Jira.
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loadingIssues ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-500">{error}</div>
        ) : issues.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            No issues found in this board
          </div>
        ) : (
          <div className="flex h-full min-w-max gap-4 p-4">
            {boardColumns.map((column) => {
              const tone = getCategoryTone(column.category);
              const isDropTarget = dropColumnId === column.id;

              return (
                <div
                  key={column.id}
                  className={`flex h-full w-[300px] shrink-0 flex-col rounded-xl border ${tone.column} transition-colors ${
                    isDropTarget ? "ring-2 ring-foreground/20" : ""
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropColumnId(column.id);
                  }}
                  onDragLeave={() => {
                    setDropColumnId((prev) => (prev === column.id ? null : prev));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    void handleIssueDrop(column);
                  }}
                >
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

                  <div className="flex-1 space-y-3 overflow-y-auto p-3">
                    {column.issues.map((issue) => {
                      const isMoving = movingIssueKey === issue.key;
                      const canCreateTask = issue.statusCategory !== "done";
                      const priorityTone = issue.priority?.name === "Highest" || issue.priority?.name === "High"
                        ? "border-red-500/30 text-red-300 bg-red-500/10"
                        : issue.priority?.name === "Low" || issue.priority?.name === "Lowest"
                          ? "border-sky-500/30 text-sky-300 bg-sky-500/10"
                          : "border-border/70 text-muted-foreground bg-background/40";

                      return (
                        <div
                          key={issue.key}
                          draggable={movingIssueKey === null}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", issue.key);
                            e.dataTransfer.effectAllowed = "move";
                            setDraggingIssueKey(issue.key);
                          }}
                          onDragEnd={() => {
                            setDraggingIssueKey(null);
                            setDropColumnId(null);
                          }}
                          className={`group rounded-xl border border-border/70 bg-background/90 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-all ${
                            movingIssueKey === null ? "cursor-grab active:cursor-grabbing" : "cursor-progress"
                          } ${isMoving ? "opacity-50" : "hover:-translate-y-0.5 hover:border-border hover:bg-background"}`}
                        >
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
                              <h4 className="wrap-break-word text-sm font-semibold leading-5">
                                {issue.summary}
                              </h4>
                            </div>
                            {issue.assignee && (
                              <Avatar size="sm" className="h-8 w-8 shrink-0 ring-1 ring-border/60">
                                {issue.assignee.avatarUrl && (
                                  <AvatarImage
                                    src={issue.assignee.avatarUrl}
                                    alt={issue.assignee.displayName}
                                  />
                                )}
                                <AvatarFallback className="bg-foreground/10 text-[11px] font-semibold text-foreground/80">
                                  {getAssigneeInitials(issue.assignee.displayName)}
                                </AvatarFallback>
                              </Avatar>
                            )}
                          </div>

                          <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span className="truncate">{issue.assignee?.displayName ?? "Unassigned"}</span>
                            <span className="truncate">{issue.status}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            {canCreateTask && (
                              <Button
                                size="sm"
                                onClick={() => onCreateTask(projectId!, issue)}
                                className="h-7 flex-1 text-xs"
                              >
                                <Plus className="w-3 h-3 me-1" />
                                Create Task
                              </Button>
                            )}
                            <Button
                              variant={canCreateTask ? "ghost" : "secondary"}
                              size="sm"
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setPreviewIssue({ issue, sourceRect: rect });
                              }}
                              className={`h-7 px-2 text-xs ${canCreateTask ? "" : "flex-1 justify-center"}`}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
    </div>
  );
}
