/**
 * Manages Jira board data fetching: boards, sprints, board configuration, and issues.
 * Extracted from JiraBoardPanel to isolate data-fetching concerns from rendering.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { reportError } from "@/lib/analytics/analytics";
import { PRIORITY_ORDER } from "@/lib/jira-utils";
import type {
  JiraProjectConfig,
  JiraBoard,
  JiraIssue,
  JiraSprint,
  JiraBoardColumn,
  JiraTransition,
  JiraProjectSummary,
} from "@shared/types/jira";

// ── Sort types ──

export type SortOption = "default" | "status" | "priority" | "type" | "assignee" | "key";

export const SORT_LABELS: Record<SortOption, string> = {
  default: "Rank",
  status: "Status",
  priority: "Priority",
  type: "Type",
  assignee: "Assignee",
  key: "Key",
};

// ── Board column type ──

export interface BoardColumn {
  id: string;
  name: string;
  category?: JiraIssue["statusCategory"];
  statusIds: string[];
  issues: JiraIssue[];
  min?: number;
  max?: number;
}

// ── Pure column-building functions ──

const STATUS_CATEGORY_ORDER: Record<NonNullable<JiraIssue["statusCategory"]>, number> = {
  todo: 0,
  indeterminate: 1,
  done: 2,
};

function getStatusCategoryRank(category?: JiraIssue["statusCategory"]): number {
  if (!category) return 1;
  return STATUS_CATEGORY_ORDER[category] ?? 1;
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

  // No board configuration -- infer columns from issue statuses
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

// ── Hook ──

interface UseJiraBoardDataOptions {
  config: JiraProjectConfig | null;
}

export function useJiraBoardData({ config }: UseJiraBoardDataOptions) {
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [boardColumnsConfig, setBoardColumnsConfig] = useState<JiraBoardColumn[]>([]);

  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState("");

  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("default");

  // Drag-and-drop state
  const [draggingIssueKey, setDraggingIssueKey] = useState<string | null>(null);
  const [dropColumnId, setDropColumnId] = useState<string | null>(null);
  const [movingIssueKey, setMovingIssueKey] = useState<string | null>(null);
  const transitionsCacheRef = useRef<Record<string, JiraTransition[]>>({});

  const boardColumns = useMemo(
    () => buildColumns(issues, sortBy, boardColumnsConfig),
    [issues, sortBy, boardColumnsConfig],
  );

  // ── Data fetching (all useCallback-wrapped for stable references) ──

  const loadBoards = useCallback(async () => {
    if (!config) return;

    setLoadingBoards(true);
    setError(null);

    try {
      const result = await window.claude.jira.getBoards({
        instanceUrl: config.instanceUrl,
        projectKey: config.projectKey || undefined,
      });
      if ("error" in result) {
        setError(`Failed to load boards: ${result.error}`);
      } else {
        setBoards(result);
      }
    } catch (err) {
      setError(`Failed to load boards: ${reportError("JIRA_LOAD_BOARDS", err)}`);
    } finally {
      setLoadingBoards(false);
    }
  }, [config]);

  const loadSprints = useCallback(async () => {
    if (!config || !selectedBoardId) return;

    try {
      const result = await window.claude.jira.getSprints({
        instanceUrl: config.instanceUrl,
        boardId: selectedBoardId,
      });
      if ("error" in result) {
        // Sprints not available (e.g., kanban board) -- silently clear
        setSprints([]);
        setSelectedSprintId("");
        return;
      }
      setSprints(result);
      const active = result.find((s) => s.state === "active");
      setSelectedSprintId(active?.id ?? "");
    } catch {
      // Sprints not available (e.g., kanban board) -- silently clear
      setSprints([]);
      setSelectedSprintId("");
    }
  }, [config, selectedBoardId]);

  const loadBoardConfiguration = useCallback(async () => {
    if (!config || !selectedBoardId) return;

    try {
      const result = await window.claude.jira.getBoardConfiguration({
        instanceUrl: config.instanceUrl,
        boardId: selectedBoardId,
      });
      if ("error" in result) {
        reportError("JIRA_BOARD_CONFIG", new Error(result.error));
        setBoardColumnsConfig([]);
      } else {
        setBoardColumnsConfig(result.columns);
      }
    } catch (err) {
      reportError("JIRA_BOARD_CONFIG", err);
      setBoardColumnsConfig([]);
    }
  }, [config, selectedBoardId]);

  const loadIssues = useCallback(async () => {
    if (!config || !selectedBoardId) return;

    setLoadingIssues(true);
    setError(null);

    try {
      const result = await window.claude.jira.getIssues({
        instanceUrl: config.instanceUrl,
        boardId: selectedBoardId,
        sprintId: selectedSprintId || undefined,
        maxResults: 50,
      });
      if ("error" in result) {
        setError(`Failed to load issues: ${result.error}`);
      } else {
        setIssues(result);
      }
    } catch (err) {
      setError(`Failed to load issues: ${reportError("JIRA_LOAD_ISSUES", err)}`);
    } finally {
      setLoadingIssues(false);
    }
  }, [config, selectedBoardId, selectedSprintId]);

  const getTransitions = useCallback(
    async (issueKey: string): Promise<JiraTransition[]> => {
      if (!config) return [];
      const cached = transitionsCacheRef.current[issueKey];
      if (cached) return cached;
      const result = await window.claude.jira.getTransitions({
        instanceUrl: config.instanceUrl,
        issueKey,
      });
      if ("error" in result) return [];
      transitionsCacheRef.current[issueKey] = result;
      return result;
    },
    [config],
  );

  // ── Effects ──

  // Sync selectedBoardId from config
  useEffect(() => {
    if (config) {
      setSelectedBoardId(config.boardId);
    }
  }, [config]);

  // Load boards when config becomes available
  useEffect(() => {
    if (config?.isAuthenticated) {
      void loadBoards();
    }
  }, [config?.isAuthenticated, loadBoards]);

  // Load sprints + board config when board changes
  useEffect(() => {
    if (config?.isAuthenticated && selectedBoardId) {
      void loadSprints();
      void loadBoardConfiguration();
    }
  }, [config?.isAuthenticated, selectedBoardId, loadSprints, loadBoardConfiguration]);

  // Load issues when board or sprint changes
  useEffect(() => {
    if (config?.isAuthenticated && selectedBoardId) {
      void loadIssues();
    }
  }, [config?.isAuthenticated, selectedBoardId, selectedSprintId, loadIssues]);

  // Clear drag state and transition cache on board/sprint/instance change
  useEffect(() => {
    transitionsCacheRef.current = {};
    setDraggingIssueKey(null);
    setDropColumnId(null);
    setMovingIssueKey(null);
  }, [selectedBoardId, selectedSprintId, config?.instanceUrl]);

  // ── Board change handler (persists to config) ──

  const handleBoardChange = useCallback(
    async (boardId: string, saveConfig: (config: JiraProjectConfig) => Promise<void>) => {
      if (!config) return;

      setSelectedBoardId(boardId);
      setBoardColumnsConfig([]);

      const board = boards.find((b) => b.id === boardId);
      if (board) {
        await saveConfig({ ...config, boardId: board.id, boardName: board.name });
      }
    },
    [config, boards],
  );

  // ── Drag-and-drop transition handler ──

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

        const transitionResult = await window.claude.jira.transitionIssue({
          instanceUrl: config.instanceUrl,
          issueKey: issue.key,
          transitionId: transition.id,
        });

        if (transitionResult.error) {
          toast.error("Failed to move Jira issue", { description: transitionResult.error });
          return;
        }

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

  // ── Setup wizard helpers ──

  const [visibleProjects, setVisibleProjects] = useState<JiraProjectSummary[]>([]);
  const [setupOptionsLoaded, setSetupOptionsLoaded] = useState(false);

  const loadSetupOptions = useCallback(async (instanceUrl: string, projectKey?: string) => {
    setLoadingBoards(true);
    setError(null);

    try {
      const [projectsResult, boardsResult] = await Promise.all([
        window.claude.jira.getProjects(instanceUrl),
        window.claude.jira.getBoards({ instanceUrl, projectKey: projectKey || undefined }),
      ]);

      if ("error" in projectsResult) {
        setError(projectsResult.error);
        return;
      }
      if ("error" in boardsResult) {
        setError(boardsResult.error);
        return;
      }

      setVisibleProjects(projectsResult);
      setBoards(boardsResult);
      setSetupOptionsLoaded(true);
      setSelectedBoardId((prev) =>
        boardsResult.some((board) => board.id === prev) ? prev : (boardsResult[0]?.id ?? ""),
      );

      if (boardsResult.length === 0) {
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
  }, []);

  /** Reset setup wizard state (called when instanceUrl changes or setup opens). */
  const resetSetupOptions = useCallback(() => {
    setSetupOptionsLoaded(false);
    setVisibleProjects([]);
    setBoards([]);
    setSelectedBoardId("");
    setError(null);
  }, []);

  /** Full state reset for when config is deleted. */
  const resetAll = useCallback(() => {
    setBoards([]);
    setBoardColumnsConfig([]);
    setVisibleProjects([]);
    setSprints([]);
    setIssues([]);
    setSelectedBoardId("");
    setSetupOptionsLoaded(false);
    setSelectedSprintId("");
  }, []);

  return {
    // Board state
    boards,
    loadingBoards,
    selectedBoardId,
    setSelectedBoardId,
    boardColumns,

    // Sprint state
    sprints,
    selectedSprintId,
    setSelectedSprintId,

    // Issue state
    issues,
    loadingIssues,
    error,
    setError,
    sortBy,
    setSortBy,

    // Drag-and-drop state
    draggingIssueKey,
    setDraggingIssueKey,
    dropColumnId,
    setDropColumnId,
    movingIssueKey,

    // Callbacks
    handleBoardChange,
    handleIssueDrop,

    // Setup wizard state
    visibleProjects,
    setupOptionsLoaded,
    loadSetupOptions,
    resetSetupOptions,
    resetAll,
  };
}
