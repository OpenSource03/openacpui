// ── Re-exports from shared (backward compat -- new code should import from @shared/) ──

export type { PreferredEditor, VoiceDictationMode, ThemeOption, MacBackgroundEffect, CodexBinarySource, ClaudeBinarySource, NotificationTrigger, NotificationEventSettings, NotificationSettings, AppSettings } from "@shared/types/settings";
export type { InstalledAgent } from "@shared/types/registry";
export type { BinaryCheckResult } from "@shared/types/registry";
export type { GitFileStatus, GitFileGroup, GitFileChange, GitBranch, GitRepoInfo, GitStatus, GitLogEntry } from "@shared/types/git";

// ── Re-exports from domain files (backward compat -- new code should import from @/types) ──

export type { ClaudeEffort, TodoItem, SubagentToolStep, UIMessage, SessionInfo, Project, ChatFolder, SessionBase, ChatSession, PersistedSession, CCSessionInfo } from "./session";
export type { SpaceColor, Space } from "./spaces";
export type { SearchMessageResult, SearchSessionResult } from "./search";
export type { ImageAttachment, GrabbedElement } from "./attachments";
export type { PermissionUpdateDestination, PermissionRuleValue, PermissionUpdate, PermissionRequest, AcpPermissionBehavior } from "./permissions";
export type { BackgroundAgentUsage, BackgroundAgent, BackgroundAgentActivity } from "./agents";
export type { ContextUsage, ModelInfo, McpTransport, McpServerConfig, McpServerStatusState, McpServerStatus } from "./mcp";
