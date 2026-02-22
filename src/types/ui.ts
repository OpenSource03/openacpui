import type { ToolUseResult } from "./protocol";

export type PreferredEditor = "auto" | "cursor" | "code" | "zed";

/** Main-process app settings (persisted to JSON file in data dir). */
export interface AppSettings {
  /** Include pre-release versions when checking for updates */
  allowPrereleaseUpdates: boolean;
  /** Number of recent chats to show per project in the sidebar (default: 10) */
  defaultChatLimit: number;
  /** Preferred code editor for "Open in Editor" actions (default: "auto") */
  preferredEditor: PreferredEditor;
}

export interface SpaceColor {
  hue: number;           // OKLCh hue 0-360
  chroma: number;        // OKLCh chroma 0-0.4
  gradientHue?: number;  // Optional second hue for gradient
}

export interface Space {
  id: string;
  name: string;
  icon: string;              // Emoji ("🚀") or lucide PascalCase name ("Rocket")
  iconType: "emoji" | "lucide";
  color: SpaceColor;
  createdAt: number;
  order: number;             // Position in bottom bar
}

export interface SearchMessageResult {
  sessionId: string;
  projectId: string;
  sessionTitle: string;
  messageId: string;
  snippet: string;           // ~80 chars around match
  timestamp: number;
}

export interface SearchSessionResult {
  sessionId: string;
  projectId: string;
  title: string;
  createdAt: number;
}

export interface ImageAttachment {
  id: string;
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  fileName?: string;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface SubagentToolStep {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult?: ToolUseResult;
  toolUseId: string;
  toolError?: boolean;
}

export interface UIMessage {
  id: string;
  role: "user" | "assistant" | "tool_call" | "tool_result" | "system" | "summary";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: ToolUseResult;
  thinking?: string;
  thinkingComplete?: boolean;
  isStreaming?: boolean;
  timestamp: number;
  subagentId?: string;
  subagentSteps?: SubagentToolStep[];
  subagentStatus?: "running" | "completed";
  subagentDurationMs?: number;
  subagentTokens?: number;
  toolError?: boolean;
  images?: ImageAttachment[];
  /** User-visible text (with @path refs but without <file> XML blocks). Falls back to regex stripping if absent (old sessions). */
  displayContent?: string;
  compactTrigger?: "manual" | "auto";
  compactPreTokens?: number;
  /** When true, system message is rendered with error styling (red text, alert icon) */
  isError?: boolean;
  /** SDK checkpoint UUID — when present, files can be reverted to the state before this message */
  checkpointId?: string;
}

export interface SessionInfo {
  sessionId: string;
  model: string;
  cwd: string;
  tools: string[];
  version: string;
  permissionMode?: string;
  agentName?: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  spaceId?: string;
}

export interface ChatSession {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  /** Timestamp of the most recent message — used for sidebar sort order */
  lastMessageAt?: number;
  model?: string;
  totalCost: number;
  isActive: boolean;
  isProcessing?: boolean;
  /** A background session has a pending permission request (tool approval, etc.) */
  hasPendingPermission?: boolean;
  titleGenerating?: boolean;
  engine?: "claude" | "acp";
  agentSessionId?: string;
  agentId?: string;
}

export interface PersistedSession {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  messages: UIMessage[];
  model?: string;
  totalCost: number;
  engine?: "claude" | "acp";
  /** ACP-side session ID (from `session/new` response) — needed to call `session/load` on revival */
  agentSessionId?: string;
  /** ACP agent ID — needed to spawn the right binary on revival */
  agentId?: string;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  suggestions?: string[];
  decisionReason?: string;
}

/**
 * Client-side permission auto-response behavior for ACP sessions.
 * ACP agents provide their own permission options (allow_once, allow_always, etc.).
 * This setting controls whether the client auto-responds or prompts the user.
 */
export type AcpPermissionBehavior = "ask" | "auto_accept" | "allow_all";

export interface CCSessionInfo {
  sessionId: string;
  preview: string;
  model: string;
  timestamp: string;
  fileModified: number;
}

export interface BackgroundAgent {
  agentId: string;
  description: string;
  prompt: string;
  outputFile: string;
  launchedAt: number;
  status: "running" | "completed" | "error";
  activity: BackgroundAgentActivity[];
  lastParsedLineCount: number;
  toolUseId: string;
  result?: string;
}

export interface BackgroundAgentActivity {
  type: "tool_call" | "text" | "error";
  toolName?: string;
  summary: string;
  timestamp: number;
}

export interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextWindow: number;
}

export interface AgentDefinition {
  id: string;
  name: string;
  engine: "claude" | "acp";
  binary?: string;
  args?: string[];
  env?: Record<string, string>;
  icon?: string;
  builtIn?: boolean;
  /** Matching id from the ACP registry (for update detection) */
  registryId?: string;
  /** Version from the registry at install time */
  registryVersion?: string;
  /** Description from the registry, shown in agent cards */
  description?: string;
}

// ── Model types ──

export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
}

// ── MCP types ──

export type McpTransport = "stdio" | "sse" | "http";

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse / http
  url?: string;
  headers?: Record<string, string>;
}

// ── MCP runtime status ──

export type McpServerStatusState = "connected" | "failed" | "needs-auth" | "pending" | "disabled";

/** Validate a raw status string into a safe McpServerStatusState, defaulting to "failed". */
export function toMcpStatusState(raw: string): McpServerStatusState {
  const valid: McpServerStatusState[] = ["connected", "failed", "needs-auth", "pending", "disabled"];
  return valid.includes(raw as McpServerStatusState) ? (raw as McpServerStatusState) : "failed";
}

export interface McpServerStatus {
  name: string;
  status: McpServerStatusState;
  error?: string;
  serverInfo?: { name: string; version: string };
  scope?: string;
  tools?: Array<{ name: string; description?: string }>;
}

// ── Git types ──

export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "unmerged";

export type GitFileGroup = "staged" | "unstaged" | "untracked";

export interface GitFileChange {
  path: string;
  oldPath?: string;
  status: GitFileStatus;
  group: GitFileGroup;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export interface GitRepoInfo {
  path: string;
  name: string;
  isSubRepo: boolean;
}

export interface GitStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}
