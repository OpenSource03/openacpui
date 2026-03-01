// Claude CLI stream-json wire format types

export interface SystemInitEvent {
  type: "system";
  subtype: "init";
  session_id: string;
  cwd: string;
  tools: string[];
  model: string;
  permissionMode: string;
  claude_code_version: string;
  agents: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
}

export interface AuthStatusEvent {
  type: "auth_status";
  isAuthenticating: boolean;
  output: string[];
  error?: string;
  session_id: string;
}

export interface StreamEvent {
  type: "stream_event";
  session_id: string;
  parent_tool_use_id?: string | null;
  event:
    | MessageStartEvent
    | ContentBlockStartEvent
    | ContentBlockDeltaEvent
    | ContentBlockStopEvent
    | MessageDeltaEvent
    | MessageStopEvent;
}

export interface MessageStartEvent {
  type: "message_start";
  message: { model: string; id: string; role: string };
}

export interface ContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block:
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "thinking"; thinking: string };
}

export interface ContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "input_json_delta"; partial_json: string }
    | { type: "thinking_delta"; thinking: string };
}

export interface ContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface MessageDeltaEvent {
  type: "message_delta";
  delta: { stop_reason: "end_turn" | "tool_use" | null };
}

export interface MessageStopEvent {
  type: "message_stop";
}

export interface AssistantMessageEvent {
  type: "assistant";
  session_id: string;
  uuid: string;
  parent_tool_use_id?: string | null;
  message: {
    model: string;
    id: string;
    role: "assistant";
    content: ContentBlock[];
  };
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "thinking"; thinking: string };

export interface ToolResultEvent {
  type: "user";
  session_id: string;
  uuid: string;
  parent_tool_use_id?: string | null;
  message: {
    role: "user";
    content:
      | string
      | Array<
          | { tool_use_id: string; type: "tool_result"; content: string | Array<{ type: string; text: string }>; is_error?: boolean }
          | { type: "text"; text: string }
        >;
  };
  tool_use_result?: ToolUseResult;
}

export interface ToolUseResult {
  type?: string;
  file?: { filePath: string; content: string; numLines: number; startLine: number; totalLines: number };
  stdout?: string;
  stderr?: string;
  filePath?: string;
  oldString?: string;
  newString?: string;
  structuredPatch?: unknown[];
  isAsync?: boolean;
  status?: string;
  description?: string;
  agentId?: string;
  outputFile?: string;
  prompt?: string;
  content?: string | Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  totalDurationMs?: number;
  totalTokens?: number;
  totalToolUseCount?: number;
  /** AskUserQuestion answers keyed by question text */
  answers?: Record<string, unknown>;
}

export interface ModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens?: number;
}

export interface ResultEvent {
  type: "result";
  subtype:
    | "success"
    | "error"
    | "error_during_execution"
    | "error_max_turns"
    | "error_max_budget_usd"
    | "error_max_structured_output_retries";
  is_error: boolean;
  duration_ms: number;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  session_id: string;
  modelUsage?: Record<string, ModelUsageEntry>;
  /** Error details from SDK — only present on error result subtypes */
  errors?: string[];
}

export interface SystemStatusEvent {
  type: "system";
  subtype: "status";
  session_id?: string;
}

export interface SystemCompactBoundaryEvent {
  type: "system";
  subtype: "compact_boundary";
  session_id?: string;
  compact_metadata?: {
    trigger?: string;
    pre_tokens?: number;
  };
}

// ── Task lifecycle events (SDK 0.2.51+) ──
// Emitted for background (async) Task subagents on the main event stream.
// tool_use_id links back to the Task tool_use block that spawned the agent.

export interface TaskStartedEvent {
  type: "system";
  subtype: "task_started";
  task_id: string;
  tool_use_id?: string;
  description: string;
  task_type?: string;
  session_id?: string;
}

export interface TaskProgressEvent {
  type: "system";
  subtype: "task_progress";
  task_id: string;
  tool_use_id?: string;
  description: string;
  usage: { total_tokens: number; tool_uses: number; duration_ms: number };
  last_tool_name?: string;
  session_id?: string;
}

export interface TaskNotificationEvent {
  type: "system";
  subtype: "task_notification";
  task_id: string;
  tool_use_id?: string;
  status: "completed" | "failed" | "stopped";
  output_file: string;
  summary: string;
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number };
  session_id?: string;
}

export type ClaudeEvent =
  | SystemInitEvent
  | SystemStatusEvent
  | SystemCompactBoundaryEvent
  | TaskStartedEvent
  | TaskProgressEvent
  | TaskNotificationEvent
  | StreamEvent
  | AssistantMessageEvent
  | ToolResultEvent
  | ResultEvent
  | AuthStatusEvent;
