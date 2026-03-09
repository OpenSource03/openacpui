import type { BackgroundAgent } from "@/types";
import type { TaskProgressEvent, TaskNotificationEvent } from "@/types";
import { capture } from "./analytics";

type Listener = (sessionId: string) => void;

interface AsyncAgentInfo {
  toolUseId: string;
  agentId: string;
  description: string;
  outputFile: string;
}

/**
 * Shared store for event-driven background agent tracking.
 *
 * Only tracks BACKGROUND (async) agents — foreground agents use the
 * existing parentToolMap/subagentSteps system in useClaude.
 *
 * Registration: from tool_result with isAsync: true (definitive async signal).
 * Updates: from task_progress events (live metrics) and task-notification XML
 * in user messages (completion).
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

  /**
   * Register a background agent from tool_result with isAsync: true.
   * This is the only entry point — task_started fires for ALL agents
   * (foreground + background), so we don't use it.
   */
  registerAsyncAgent(sessionId: string, info: AsyncAgentInfo): void {
    let map = this.agents.get(sessionId);
    if (!map) {
      map = new Map();
      this.agents.set(sessionId, map);
    }
    if (map.has(info.toolUseId)) return;

    map.set(info.toolUseId, {
      agentId: info.agentId,
      description: info.description,
      prompt: "",
      outputFile: info.outputFile,
      launchedAt: Date.now(),
      status: "running",
      activity: [],
      toolUseId: info.toolUseId,
      taskId: info.agentId,
    });
    capture("background_agent_created");
    this.notify(sessionId);
  }

  handleTaskProgress(sessionId: string, event: TaskProgressEvent): void {
    if (!event.tool_use_id) return;
    const agent = this.agents.get(sessionId)?.get(event.tool_use_id);
    // Only update agents we've registered (i.e. background agents)
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
    capture("background_agent_completed", {
      status: agent.status,
      duration_ms: event.usage?.duration_ms,
    });

    this.notify(sessionId);
  }

  /**
   * Parse task completion from user text messages containing <task-notification> XML.
   * The SDK delivers task completion as a user text message, NOT as a system event.
   */
  handleUserMessage(sessionId: string, content: string): void {
    if (!content.includes("<task-notification>")) return;

    const toolUseId = extractXmlTag(content, "tool-use-id");
    if (!toolUseId) return;

    const agent = this.agents.get(sessionId)?.get(toolUseId);
    if (!agent) return;

    const status = extractXmlTag(content, "status");
    agent.status = status === "completed" ? "completed" : "error";
    agent.result = extractXmlTag(content, "summary") || undefined;

    const tokens = extractXmlTag(content, "total_tokens");
    const tools = extractXmlTag(content, "tool_uses");
    const duration = extractXmlTag(content, "duration_ms");
    if (tokens) {
      agent.usage = {
        totalTokens: parseInt(tokens, 10) || 0,
        toolUses: parseInt(tools ?? "0", 10) || 0,
        durationMs: parseInt(duration ?? "0", 10) || 0,
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

/** Extract text content of an XML-like tag from a string. */
function extractXmlTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const match = re.exec(text);
  return match ? match[1].trim() : null;
}

export const bgAgentStore = new BackgroundAgentStore();
