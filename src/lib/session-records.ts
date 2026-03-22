import type { SessionMeta as SessionListItem } from "@shared/lib/session-persistence";
import type { ChatSession, ContextUsage, PersistedSession, UIMessage } from "@/types";

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
    planMode: session.planMode,
    totalCost: session.totalCost ?? 0,
    isActive,
    engine: session.engine,
    codexThreadId: session.codexThreadId,
    folderId: session.folderId,
    pinned: session.pinned,
    branch: session.branch,
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
