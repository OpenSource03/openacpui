/**
 * Unified tool island content renderer.
 *
 * Maps a `toolId` to the correct panel component (ToolsPanel, BrowserPanel, etc.)
 * with the provided context. Replaces three copies of the same switch/record:
 * - `renderMainWorkspaceToolContent` (main single-chat)
 * - inline `toolNode` in `renderSplitTopRowItem` (split-view top row)
 * - inline `toolNode` in `renderSplitBottomToolIsland` (split-view bottom dock)
 */

import type { ReactNode } from "react";
import { ToolsPanel } from "@/components/ToolsPanel";
import { BrowserPanel } from "@/components/BrowserPanel";
import { GitPanel } from "@/components/git/GitPanel";
import { FilesPanel } from "@/components/FilesPanel";
import { ProjectFilesPanel } from "@/components/ProjectFilesPanel";
import { McpPanel } from "@/components/McpPanel";
import type { PanelToolId, EngineId, McpServerConfig, McpServerStatus, UIMessage, GrabbedElement } from "@/types";
import type { TerminalTab } from "@/lib/terminal-tabs";
import type { ResolvedTheme } from "@/hooks/useTheme";

// ── Props ──

export interface ToolIslandContentProps {
  toolId: PanelToolId;
  persistKey: string;
  headerControls: ReactNode;

  // Session / project context
  projectPath: string | undefined;
  projectRoot: string | undefined;
  projectId: string | null;
  sessionId: string | null;
  messages: UIMessage[];
  activeEngine: EngineId | undefined;
  isActiveSessionPane: boolean;
  hasLiveSession: boolean;

  // Space / terminal context
  spaceId: string;
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;
  terminalsReady: boolean;
  onSetActiveTab: (tabId: string | null) => void;
  onCreateTerminal: () => Promise<void>;
  onEnsureTerminal: () => Promise<void>;
  onCloseTerminal: (tabId: string) => Promise<void>;
  resolvedTheme: ResolvedTheme;

  // Panel-specific callbacks
  onElementGrab?: (element: GrabbedElement) => void;
  onScrollToToolCall?: (messageId: string) => void;
  onPreviewFile?: (path: string, rect: DOMRect) => void;
  collapsedRepos: Set<string>;
  onToggleRepoCollapsed: (path: string) => void;
  // MCP panel
  mcpServerStatuses: McpServerStatus[];
  mcpStatusPreliminary: boolean;
  onRefreshMcpStatus: () => void;
  onReconnectMcpServer: (name: string) => Promise<void> | void;
  onRestartWithMcpServers: (servers: McpServerConfig[]) => Promise<void> | void;
}

export function ToolIslandContent({
  toolId,
  persistKey,
  headerControls,
  projectPath,
  projectRoot,
  projectId,
  sessionId,
  messages,
  activeEngine,
  isActiveSessionPane,
  hasLiveSession,
  spaceId,
  terminalTabs,
  activeTerminalTabId,
  terminalsReady,
  onSetActiveTab,
  onCreateTerminal,
  onEnsureTerminal,
  onCloseTerminal,
  resolvedTheme,
  onElementGrab,
  onScrollToToolCall,
  onPreviewFile,
  collapsedRepos,
  onToggleRepoCollapsed,
  mcpServerStatuses,
  mcpStatusPreliminary,
  onRefreshMcpStatus,
  onReconnectMcpServer,
  onRestartWithMcpServers,
}: ToolIslandContentProps): ReactNode {
  switch (toolId) {
    case "terminal":
      return (
        <ToolsPanel
          spaceId={spaceId}
          tabs={terminalTabs}
          activeTabId={activeTerminalTabId}
          terminalsReady={terminalsReady}
          onSetActiveTab={onSetActiveTab}
          onCreateTerminal={onCreateTerminal}
          onEnsureTerminal={onEnsureTerminal}
          onCloseTerminal={onCloseTerminal}
          resolvedTheme={resolvedTheme}
          headerControls={headerControls}
        />
      );
    case "browser":
      return (
        <BrowserPanel
          persistKey={persistKey}
          onElementGrab={isActiveSessionPane ? onElementGrab : undefined}
          headerControls={headerControls}
        />
      );
    case "git":
      return (
        <GitPanel
          cwd={projectRoot}
          collapsedRepos={collapsedRepos}
          onToggleRepoCollapsed={onToggleRepoCollapsed}
          activeEngine={activeEngine}
          activeSessionId={sessionId}
          headerControls={headerControls}
        />
      );
    case "files":
      return (
        <FilesPanel
          sessionId={sessionId}
          messages={messages}
          cwd={projectPath}
          activeEngine={activeEngine}
          onScrollToToolCall={onScrollToToolCall}
          enabled={true}
          headerControls={headerControls}
        />
      );
    case "project-files":
      return (
        <ProjectFilesPanel
          cwd={projectPath}
          enabled={true}
          onPreviewFile={onPreviewFile}
          headerControls={headerControls}
        />
      );
    case "mcp":
      return (
        <McpPanel
          projectId={projectId}
          runtimeStatuses={mcpServerStatuses}
          isPreliminary={isActiveSessionPane ? mcpStatusPreliminary : false}
          hasLiveSession={hasLiveSession}
          onRefreshStatus={onRefreshMcpStatus}
          onReconnect={onReconnectMcpServer}
          onRestartWithServers={onRestartWithMcpServers}
          headerControls={headerControls}
        />
      );
  }
}
