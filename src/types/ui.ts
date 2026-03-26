import type { ToolUseResult } from "./protocol";
import type { ACPConfigOption } from "./acp";
import type { EngineId } from "./engine";

export type PreferredEditor = "auto" | "cursor" | "code" | "zed";
export type VoiceDictationMode = "native" | "whisper";
export type ThemeOption = "light" | "dark" | "system";
export type CodexBinarySource = "auto" | "managed" | "custom";
export type ClaudeBinarySource = "auto" | "managed" | "custom";
export type ClaudeEffort = "low" | "medium" | "high" | "max";

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

export interface AppSettings {
    allowPrereleaseUpdates: boolean;
    defaultChatLimit: number;
    preferredEditor: PreferredEditor;
    voiceDictation: VoiceDictationMode;
    notifications: NotificationSettings;
    codexClientName: string;
    codexBinarySource: CodexBinarySource;
    codexCustomBinaryPath: string;
    claudeBinarySource: ClaudeBinarySource;
    claudeCustomBinaryPath: string;
    showDevFillInChatTitleBar: boolean;
    showJiraBoard: boolean;
    analyticsEnabled: boolean;
    analyticsUserId?: string;
    analyticsLastDailyActiveDate?: string;
    openclawGatewayUrl: string;
    openclawDefaultModel: string;
    openclawDefaultSkills: string[];
    openclawGatewayToken: string;
    openclawDeviceToken: string;
    openclawDeviceId: string;
    openclawDefaultAgent: string;
    ollamaBaseUrl: string;
    ollamaDefaultModel: string;
}

export interface SpaceColor {
  hue: number;
  chroma: number;
  gradientHue?: number;
  opacity?: number;
}

export interface Space {
  id: string;
  name: string;
  icon: string;
  iconType: "emoji" | "lucide";
  color: SpaceColor;
  createdAt: number;
  order: number;
}

export interface SearchMessageResult {
  sessionId: string;
  projectId: string;
  sessionTitle: string;
  messageId: string;
  snippet: string;
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

export interface GrabbedElement {
  id: string;
    url: string;
  tag: string;
    selector: string;
  classes: string[];
    attributes: Record<string, string>;
    textContent: string;
    outerHTML: string;
    computedStyles: Record<string, string>;
  boundingRect: { x: number; y: number; width: number; height: number };
}

export interface CodeSnippet {
  id: string;
  code: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  language: string;
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
    displayContent?: string;
  compactTrigger?: "manual" | "auto";
  compactPreTokens?: number;
    isError?: boolean;
    checkpointId?: string;
    isQueued?: boolean;
    codeSnippets?: CodeSnippet[];
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
    lastMessageAt?: number;
  isActive: boolean;
  isProcessing?: boolean;
    hasPendingPermission?: boolean;
  titleGenerating?: boolean;
}

export interface PersistedSession extends SessionBase {
  messages: UIMessage[];
  contextUsage?: ContextUsage | null;
}

export type PermissionUpdateDestination = "userSettings" | "projectSettings" | "localSettings" | "session";

export interface PermissionRuleValue {
  toolName: string;
  ruleContent?: string;
}

export interface PermissionUpdate {
  type: string;
  rules?: PermissionRuleValue[];
  behavior?: string;
  destination: PermissionUpdateDestination;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  suggestions?: PermissionUpdate[];
  decisionReason?: string;
}

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
    taskId?: string;
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
    registryId?: string;
    registryVersion?: string;
    description?: string;
    cachedConfigOptions?: ACPConfigOption[];
}

export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: ClaudeEffort[];
  supportsAdaptiveThinking?: boolean;
  supportsFastMode?: boolean;
}

export type McpTransport = "stdio" | "sse" | "http";

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export type McpServerStatusState = "connected" | "failed" | "needs-auth" | "pending" | "disabled";

export interface McpServerStatus {
  name: string;
  status: McpServerStatusState;
  error?: string;
  serverInfo?: { name: string; version: string };
  scope?: string;
  tools?: Array<{ name: string; description?: string }>;
}

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
