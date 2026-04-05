/**
 * Builds the shared ToolIslandContent prop bundle from workspace context.
 *
 * Eliminates the 3x duplication of terminal/MCP/git/file props across
 * renderMainWorkspaceToolContent, renderSplitTopRowItem, and
 * renderSplitBottomToolIsland in AppLayout.
 */

import { useMemo } from "react";
import type { ToolIslandContextProps, GrabbedElement, McpServerStatus, McpServerConfig } from "@/types";
import type { TerminalTab } from "@/lib/terminal-tabs";
import type { ResolvedTheme } from "@/hooks/useTheme";

interface UseToolIslandContextInput {
  spaceId: string;
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;
  terminalsReady: boolean;
  onSetActiveTab: (tabId: string | null) => void;
  onCreateTerminal: () => Promise<void>;
  onEnsureTerminal: () => Promise<void>;
  onCloseTerminal: (tabId: string) => Promise<void>;
  resolvedTheme: ResolvedTheme;
  onElementGrab: (element: GrabbedElement) => void;
  onScrollToToolCall: (messageId: string) => void;
  onPreviewFile: (path: string, rect: DOMRect) => void;
  collapsedRepos: Set<string>;
  onToggleRepoCollapsed: (path: string) => void;
  mcpServerStatuses: McpServerStatus[];
  mcpStatusPreliminary: boolean;
  onRefreshMcpStatus: () => void;
  onReconnectMcpServer: (name: string) => Promise<void> | void;
  onRestartWithMcpServers: (servers: McpServerConfig[]) => Promise<void> | void;
}

export function useToolIslandContext(input: UseToolIslandContextInput): ToolIslandContextProps {
  return useMemo<ToolIslandContextProps>(
    () => ({
      spaceId: input.spaceId,
      terminalTabs: input.terminalTabs,
      activeTerminalTabId: input.activeTerminalTabId,
      terminalsReady: input.terminalsReady,
      onSetActiveTab: input.onSetActiveTab,
      onCreateTerminal: input.onCreateTerminal,
      onEnsureTerminal: input.onEnsureTerminal,
      onCloseTerminal: input.onCloseTerminal,
      resolvedTheme: input.resolvedTheme,
      onElementGrab: input.onElementGrab,
      onScrollToToolCall: input.onScrollToToolCall,
      onPreviewFile: input.onPreviewFile,
      collapsedRepos: input.collapsedRepos,
      onToggleRepoCollapsed: input.onToggleRepoCollapsed,
      mcpServerStatuses: input.mcpServerStatuses,
      mcpStatusPreliminary: input.mcpStatusPreliminary,
      onRefreshMcpStatus: input.onRefreshMcpStatus,
      onReconnectMcpServer: input.onReconnectMcpServer,
      onRestartWithMcpServers: input.onRestartWithMcpServers,
    }),
    [
      input.spaceId,
      input.terminalTabs,
      input.activeTerminalTabId,
      input.terminalsReady,
      input.onSetActiveTab,
      input.onCreateTerminal,
      input.onEnsureTerminal,
      input.onCloseTerminal,
      input.resolvedTheme,
      input.onElementGrab,
      input.onScrollToToolCall,
      input.onPreviewFile,
      input.collapsedRepos,
      input.onToggleRepoCollapsed,
      input.mcpServerStatuses,
      input.mcpStatusPreliminary,
      input.onRefreshMcpStatus,
      input.onReconnectMcpServer,
      input.onRestartWithMcpServers,
    ],
  );
}
