// ── Background agent types ──

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
  status: "running" | "stopping" | "completed" | "error";
  activity: BackgroundAgentActivity[];
  toolUseId: string;
  result?: string;
  /** SDK task_id -- identifies this agent in the SDK's task lifecycle events */
  taskId?: string;
  /** Live usage metrics from task_progress / task_notification events */
  usage?: BackgroundAgentUsage;
  /** AI-generated progress summary from agentProgressSummaries */
  progressSummary?: string;
  /** Currently executing tool (from tool_progress events) */
  currentTool?: { name: string; elapsedSeconds: number } | null;
  /** True when created from task_started but not yet confirmed as background */
  isPending?: boolean;
}

export interface BackgroundAgentActivity {
  type: "tool_call" | "text" | "error";
  toolName?: string;
  summary: string;
  timestamp: number;
}
