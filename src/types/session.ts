import type { ToolUseResult } from "./protocol";
import type { EngineId } from "./engine";
import type { ImageAttachment } from "./attachments";
import type { ContextUsage } from "./mcp";

// ── Effort ──

export type ClaudeEffort = "low" | "medium" | "high" | "max";

// ── Session message types ──

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
  /** SDK checkpoint UUID -- when present, files can be reverted to the state before this message */
  checkpointId?: string;
  /** When true, this user message is waiting in the queue -- not yet sent to the agent */
  isQueued?: boolean;
}

// ── Session metadata ──

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
  iconType?: "emoji" | "lucide" | "simple";
}

/** A user-created folder for organizing chats within a project. */
export interface ChatFolder {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  /** Display order within the project (lower = higher in list). */
  order: number;
  /** Whether this folder is pinned to the top of the sidebar. */
  pinned?: boolean;
}

/** Fields shared between live and persisted session representations. */
export interface SessionBase {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  model?: string;
  effort?: ClaudeEffort;
  permissionMode?: string;
  planMode?: boolean;
  totalCost: number;
  engine?: EngineId;
  agentSessionId?: string;
  agentId?: string;
  codexThreadId?: string;
  /** Which folder this chat belongs to (undefined = root level). */
  folderId?: string;
  /** Whether this chat is pinned to the top of the sidebar. */
  pinned?: boolean;
  /** Git branch at session creation time. */
  branch?: string;
  /**
   * Timestamp when the session was archived. Unset on active (non-archived)
   * sessions. Archived sessions are hidden from the main sidebar list but
   * retain all their data and can be unarchived later.
   */
  archivedAt?: number;
}

export interface ChatSession extends SessionBase {
  /** Timestamp of the most recent message -- used for sidebar sort order */
  lastMessageAt?: number;
  isActive: boolean;
  isProcessing?: boolean;
  /** A background session has a pending permission request (tool approval, etc.) */
  hasPendingPermission?: boolean;
  /** A background session finished while inactive and has not been opened yet. */
  hasUnreadCompletion?: boolean;
  titleGenerating?: boolean;
}

export interface PersistedSession extends SessionBase {
  messages: UIMessage[];
  contextUsage?: ContextUsage | null;
}

export interface CCSessionInfo {
  sessionId: string;
  preview: string;
  model: string;
  timestamp: string;
  fileModified: number;
}
