import type { EngineId } from "./engine";

export interface AgentSlot {
  id: string;
  label: string;
  engine: EngineId;
  model: string;
  agentId?: string;
  role: "leader" | "member";
  color: string;
}

export interface AgentGroup {
  id: string;
  name: string;
  slots: AgentSlot[];
  turnOrder: "round-robin" | "leader-decides" | "parallel" | "chat";
  createdAt: string;
  updatedAt: string;
}

export interface GroupMessage {
  id: string;
  slotId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  turnIndex: number;
}

export type GroupSessionStatus =
  | "idle"
  | "running"
  | "waiting-leader"
  | "paused"
  | "completed";

export interface GroupSession {
  id: string;
  groupId: string;
  status: GroupSessionStatus;
  messages: GroupMessage[];
  currentTurnIndex: number;
  currentSlotIndex: number;
  prompt: string;
  cwd?: string;
  startedAt: string;
  slotSdkSessionIds?: Record<string, string>;
}

export interface GroupSessionEvent {
  type: "message" | "status" | "turn-advance" | "error" | "complete";
  sessionId: string;
  slotId?: string;
  message?: GroupMessage;
  status?: GroupSessionStatus;
  turnIndex?: number;
  error?: string;
}

export const SLOT_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
] as const;
