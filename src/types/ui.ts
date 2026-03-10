import type { ToolUseResult } from "./protocol";
import type { ACPConfigOption } from "./acp";
import type { EngineId } from "./engine";

export type PreferredEditor = "auto" | "cursor" | "code" | "zed";
export type VoiceDictationMode = "native" | "whisper";
export type ThemeOption = "light" | "dark" | "system";
export type CodexBinarySource = "auto" | "managed" | "custom";
export type ClaudeBinarySource = "auto" | "managed" | "custom";
export type ClaudeEffort = "low" | "medium" | "high" | "max";

// ── Notification settings ──

export type NotificationTrigger = "always" | "unfocused" | "never";

export interface NotificationEventSettings {
  osNotification: NotificationTrigger;
  sound: NotificationTrigger;
}

export interface NotificationSettings {
  exitPlanMode: NotificationEventSettings;
  permissions: NotificationEventSettings;
  askUserQuestion: NotificationEventSettings;
  sessionComplete: NotificationEventSettings;
}

/** Main-process app settings (persisted to JSON file in data dir). */
export interface AppSettings {
  /** Include pre-release versions when checking for updates */
  allowPrereleaseUpdates: boolean;
  /** Number of recent chats to show per project in the sidebar (default: 10) */
  defaultChatLimit: number;
  /** Preferred code editor for "Open in Editor" actions (default: "auto") */
  preferredEditor: PreferredEditor;
  /** Voice dictation mode: "native" uses OS dictation, "whisper" uses local AI model (default: "native") */
  voiceDictation: VoiceDictationMode;
  /** Per-event notification and sound configuration */
  notifications: NotificationSettings;
  /** Custom client name sent to Codex servers during handshake (default: "Harnss") */
  codexClientName: string;
  /** Which Codex binary source to use */
  codexBinarySource: CodexBinarySource;
  /** Absolute path used when codexBinarySource is custom */
  codexCustomBinaryPath: string;
  /** Which Claude binary source to use */
  claudeBinarySource: ClaudeBinarySource;
  /** Absolute path used when claudeBinarySource is custom */
  claudeCustomBinaryPath: string;
  /** Show developer-only "Dev Fill" button in chat title bar (local dev builds only) */
  showDevFillInChatTitleBar: boolean;
  /** Show the Jira board UI in the sidebar and main panel (developer preview) */
  showJiraBoard: boolean;
  /** Enable anonymous analytics to help improve the app (default: true) */
  analyticsEnabled: boolean;
  /** Anonymous user ID for analytics (auto-generated) */
  analyticsUserId?: string;
  /** Last date (YYYY-MM-DD) when daily_active_user was sent */
  analyticsLastDailyActiveDate?: string;
}

export interface SpaceColor {
  hue: number;           // OKLCh hue 0-360
  chroma: number;        // OKLCh chroma 0-0.4
  gradientHue?: number;  // Optional second hue for gradient
  opacity?: number;      // Island background opacity 0.2-1, defaults to 1.0
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

/** Element data captured by the browser inspector (Element Grab feature). */
export interface GrabbedElement {
  id: string;
  /** Page URL where the element was captured */
  url: string;
  tag: string;
  /** Best-effort unique CSS selector path */
  selector: string;
  classes: string[];
  /** Whitelisted attributes (id, href, src, alt, role, aria-label, data-testid, etc.) */
  attributes: Record<string, string>;
  /** innerText truncated to 500 chars */
  textContent: string;
  /** outerHTML truncated to 2000 chars */
  outerHTML: string;
  /** Key computed styles (display, position, color, font-size, etc.) */
  computedStyles: Record<string, string>;
  boundingRect: { x: number; y: number; width: number; height: number };
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
  /** When true, this user message is waiting in the queue — not yet sent to the agent */
  isQueued?: boolean;
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
  icon?: string;
  iconType?: "emoji" | "lucide";
}

/** Fields shared between live and persisted session representations. */
export interface SessionBase {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  model?: string;
  planMode?: boolean;
  totalCost: number;
  engine?: EngineId;
  agentSessionId?: string;
  agentId?: string;
  codexThreadId?: string;
}

export interface ChatSession extends SessionBase {
  /** Timestamp of the most recent message — used for sidebar sort order */
  lastMessageAt?: number;
  isActive: boolean;
  isProcessing?: boolean;
  /** A background session has a pending permission request (tool approval, etc.) */
  hasPendingPermission?: boolean;
  titleGenerating?: boolean;
}

export interface PersistedSession extends SessionBase {
  messages: UIMessage[];
  contextUsage?: ContextUsage | null;
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

export interface BackgroundAgentUsage {
  totalTokens: number;
  toolUses: number;
  durationMs: number;
}

export interface BackgroundAgent {
  agentId: string;
  description: string;
  prompt: string;
  outputFile: string;
  launchedAt: number;
  status: "running" | "completed" | "error";
  activity: BackgroundAgentActivity[];
  toolUseId: string;
  result?: string;
  /** SDK task_id — identifies this agent in the SDK's task lifecycle events */
  taskId?: string;
  /** Live usage metrics from task_progress / task_notification events */
  usage?: BackgroundAgentUsage;
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

export interface InstalledAgent {
  id: string;
  name: string;
  engine: EngineId;
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
  /** Cached config options from the last ACP session — shown before session starts */
  cachedConfigOptions?: ACPConfigOption[];
}

// ── Model types ──

export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: ClaudeEffort[];
  supportsAdaptiveThinking?: boolean;
  supportsFastMode?: boolean;
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
  isWorktree: boolean;
  isPrimaryWorktree: boolean;
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
