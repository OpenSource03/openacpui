import type { BackgroundAgent } from "@/types";
import type { TaskStartedEvent, TaskProgressEvent, TaskNotificationEvent } from "@/types";

type Listener = (sessionId: string) => void;

/**
 * Shared store for event-driven background agent tracking.
 *
 * Both useClaude (active session) and BackgroundSessionStore (backgrounded
 * sessions) push SDK task lifecycle events here. The useBackgroundAgents
 * hook subscribes via useSyncExternalStore.
 */
class BackgroundAgentStore {
  private agents = new Map<string, Map<string, BackgroundAgent>>();
  private listeners = new Set<Listener>();
  /** Cached arrays per session — only recreated when agents change */
  private snapshotCache = new Map<string, BackgroundAgent[]>();

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(sessionId: string): void {
    // Invalidate cached snapshot so useSyncExternalStore sees a new reference
    this.snapshotCache.delete(sessionId);
    for (const cb of this.listeners) cb(sessionId);
  }

  /** Returns a referentially stable array (same ref if unchanged). */
  getAgents(sessionId: string): BackgroundAgent[] {
    const cached = this.snapshotCache.get(sessionId);
    if (cached) return cached;
    const map = this.agents.get(sessionId);
    const arr = map ? Array.from(map.values()) : [];
    this.snapshotCache.set(sessionId, arr);
    return arr;
  }

  clearSession(sessionId: string): void {
    if (!this.agents.has(sessionId)) return;
    this.agents.delete(sessionId);
    this.notify(sessionId);
  }

  handleTaskStarted(sessionId: string, event: TaskStartedEvent): void {
    if (!event.tool_use_id) return;
    let map = this.agents.get(sessionId);
    if (!map) {
      map = new Map();
      this.agents.set(sessionId, map);
    }
    // Don't overwrite if already exists (e.g. duplicate event)
    if (map.has(event.tool_use_id)) return;

    map.set(event.tool_use_id, {
      agentId: event.task_id,
      description: event.description,
      prompt: "",
      outputFile: "",
      launchedAt: Date.now(),
      status: "running",
      activity: [],
      toolUseId: event.tool_use_id,
      taskId: event.task_id,
    });
    this.notify(sessionId);
  }

  handleTaskProgress(sessionId: string, event: TaskProgressEvent): void {
    if (!event.tool_use_id) return;
    const agent = this.agents.get(sessionId)?.get(event.tool_use_id);
    if (!agent) return;

    agent.usage = {
      totalTokens: event.usage.total_tokens,
      toolUses: event.usage.tool_uses,
      durationMs: event.usage.duration_ms,
    };

    if (event.last_tool_name) {
      agent.activity.push({
        type: "tool_call",
        toolName: event.last_tool_name,
        summary: event.description,
        timestamp: Date.now(),
      });
    }

    this.notify(sessionId);
  }

  handleTaskNotification(sessionId: string, event: TaskNotificationEvent): void {
    if (!event.tool_use_id) return;
    const agent = this.agents.get(sessionId)?.get(event.tool_use_id);
    if (!agent) return;

    agent.status = event.status === "completed" ? "completed" : "error";
    agent.result = event.summary || undefined;
    agent.outputFile = event.output_file;
    if (event.usage) {
      agent.usage = {
        totalTokens: event.usage.total_tokens,
        toolUses: event.usage.tool_uses,
        durationMs: event.usage.duration_ms,
      };
    }

    this.notify(sessionId);
  }

  dismissAgent(sessionId: string, agentId: string): void {
    const map = this.agents.get(sessionId);
    if (!map) return;
    for (const [key, agent] of map) {
      if (agent.agentId === agentId) {
        map.delete(key);
        break;
      }
    }
    this.notify(sessionId);
  }
}

export const bgAgentStore = new BackgroundAgentStore();
