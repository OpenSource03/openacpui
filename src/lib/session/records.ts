import type { SessionMeta as SessionListItem } from "@shared/lib/session-persistence";
import type { ChatSession, ClaudeEffort, ContextUsage, PersistedSession, UIMessage } from "@/types";

const VALID_EFFORTS = new Set<string>(["low", "medium", "high", "max"]);
function toClaudeEffort(value: string | undefined): ClaudeEffort | undefined {
  return value && VALID_EFFORTS.has(value) ? (value as ClaudeEffort) : undefined;
}

export function toChatSession(
  session: SessionListItem,
  isActive: boolean,
): ChatSession {
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    createdAt: session.createdAt,
    lastMessageAt: session.lastMessageAt || session.createdAt,
    model: session.model,
    effort: toClaudeEffort(session.effort),
    permissionMode: session.permissionMode,
    planMode: session.planMode,
    totalCost: session.totalCost ?? 0,
    isActive,
    engine: session.engine,
    codexThreadId: session.codexThreadId,
    folderId: session.folderId,
    pinned: session.pinned,
    branch: session.branch,
    agentId: session.agentId,
  };
}

export function buildPersistedSession(
  session: ChatSession,
  messages: UIMessage[],
  totalCost: number,
  contextUsage: ContextUsage | null,
): PersistedSession {
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    createdAt: session.createdAt,
    messages,
    model: session.model,
    effort: session.effort,
    permissionMode: session.permissionMode,
    planMode: session.planMode,
    totalCost,
    contextUsage,
    engine: session.engine,
    folderId: session.folderId,
    pinned: session.pinned,
    branch: session.branch,
    ...(session.agentId ? { agentId: session.agentId } : {}),
    ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
    ...(session.engine === "codex" && session.codexThreadId ? { codexThreadId: session.codexThreadId } : {}),
  };
}
