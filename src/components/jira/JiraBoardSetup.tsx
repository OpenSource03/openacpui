/**
 * Setup wizard for connecting a Harnss project to a Jira board.
 * Handles URL input, authentication trigger, project filtering, and board selection.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JiraAuthDialog } from "../JiraAuthDialog";
import { Loader2, ChevronDown, ArrowLeft, KanbanSquare, PanelLeft } from "lucide-react";
import type { JiraBoard, JiraProjectConfig, JiraProjectSummary } from "@shared/types/jira";

interface JiraBoardSetupProps {
  projectName?: string;
  isMainView: boolean;
  headerPaddingClass: string;
  sidebarOpen: boolean;
  onClose?: () => void;
  onToggleSidebar?: () => void;
  saveConfig: (config: JiraProjectConfig) => Promise<void>;

  // Data from useJiraBoardData
  boards: JiraBoard[];
  loadingBoards: boolean;
  selectedBoardId: string;
  setSelectedBoardId: (id: string) => void;
  visibleProjects: JiraProjectSummary[];
  setupOptionsLoaded: boolean;
  loadSetupOptions: (instanceUrl: string, projectKey?: string) => Promise<void>;
  resetSetupOptions: () => void;
  error: string | null;
  setError: (error: string | null) => void;

  /** Initial instance URL from existing config (if re-entering setup). */
  initialInstanceUrl: string;
  /** Initial project key from existing config. */
  initialProjectKey: string;
}

export const JiraBoardSetup = React.memo(function JiraBoardSetup({
  projectName,
  isMainView,
  headerPaddingClass,
  sidebarOpen,
  onClose,
  onToggleSidebar,
  saveConfig,
  boards,
  loadingBoards,
  selectedBoardId,
  setSelectedBoardId,
  visibleProjects,
  setupOptionsLoaded,
  loadSetupOptions,
  resetSetupOptions,
  error,
  setError,
  initialInstanceUrl,
  initialProjectKey,
}: JiraBoardSetupProps) {
  const [instanceUrl, setInstanceUrl] = useState(initialInstanceUrl);
  const [selectedProjectKey, setSelectedProjectKey] = useState(initialProjectKey);
  const [showAuth, setShowAuth] = useState(false);

  // Reset setup options when URL changes
  useEffect(() => {
    resetSetupOptions();
    setSelectedProjectKey("");
  }, [instanceUrl, resetSetupOptions]);

  const handleProjectKeyChange = useCallback(
    (key: string) => {
      setSelectedProjectKey(key);
      void loadSetupOptions(instanceUrl, key);
    },
    [instanceUrl, loadSetupOptions],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!instanceUrl) {
        setError("Please enter your Jira instance URL");
        return;
      }

      // Check authentication
      const authStatus = await window.claude.jira.authStatus(instanceUrl);

      if (!authStatus.hasToken) {
        setShowAuth(true);
        return;
      }

      if (!setupOptionsLoaded) {
        await loadSetupOptions(instanceUrl, selectedProjectKey);
        return;
      }

      // Complete setup
      const selectedBoard = boards.find((board) => board.id === selectedBoardId);
      if (!selectedBoard) {
        setError("Please select a Jira board");
        return;
      }

      try {
        setError(null);
        await saveConfig({
          instanceUrl,
          projectKey: selectedProjectKey || undefined,
          boardId: selectedBoard.id,
          boardName: selectedBoard.name,
          authMethod: "apitoken",
          isAuthenticated: true,
          createdAt: Date.now(),
        });
      } catch (err) {
        setError(String(err));
      }
    },
    [instanceUrl, selectedProjectKey, setupOptionsLoaded, loadSetupOptions, boards, selectedBoardId, saveConfig, setError],
  );

  const handleAuthSuccess = useCallback(async () => {
    await loadSetupOptions(instanceUrl, selectedProjectKey);
  }, [instanceUrl, selectedProjectKey, loadSetupOptions]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
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
                <h3 className="truncate">{projectName ? `${projectName} Jira Board` : "Setup Jira Board"}</h3>
              </div>
              {projectName && (
                <p className="mt-1 text-xs text-muted-foreground">Connect this project to a Jira board.</p>
              )}
            </div>
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="no-drag h-8 gap-1.5 px-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          )}
        </div>
      </div>

      {/* Form */}
      <ScrollArea className="flex-1 min-h-0">
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Instance URL */}
          <div className="space-y-2">
            <label htmlFor="instanceUrl" className="text-sm font-medium">
              Jira Instance URL
            </label>
            <Input
              id="instanceUrl"
              placeholder="https://your-domain.atlassian.net"
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">Your Atlassian cloud instance URL</p>
          </div>

          {/* Project filter */}
          {setupOptionsLoaded && visibleProjects.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Jira Project Filter</label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="truncate">
                      {selectedProjectKey
                        ? (visibleProjects.find((p) => p.key === selectedProjectKey)?.name ?? selectedProjectKey)
                        : "All projects"}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  <DropdownMenuItem onClick={() => handleProjectKeyChange("")}>All projects</DropdownMenuItem>
                  {visibleProjects.map((project) => (
                    <DropdownMenuItem key={project.id} onClick={() => handleProjectKeyChange(project.key)}>
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

          {/* Board selector */}
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
                    <DropdownMenuItem key={board.id} onClick={() => setSelectedBoardId(board.id)}>
                      <span className="truncate">{board.name}</span>
                      <span className="ms-auto text-[10px] text-muted-foreground uppercase">{board.type}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="text-xs text-muted-foreground">This board will be bound to the current Harnss project.</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-md p-3">{error}</div>
          )}

          {/* Submit */}
          <Button type="submit" className="w-full" disabled={loadingBoards || (setupOptionsLoaded && boards.length === 0)}>
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

      <JiraAuthDialog open={showAuth} onOpenChange={setShowAuth} instanceUrl={instanceUrl} onSuccess={handleAuthSuccess} />
    </div>
  );
});
