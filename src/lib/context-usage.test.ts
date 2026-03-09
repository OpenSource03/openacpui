import { describe, expect, it } from "vitest";
import type {
  AssistantMessageEvent,
  ResultEvent,
  ACPSessionEvent,
  CodexSessionEvent,
} from "../types";
import { extractAssistantContextUsage } from "./protocol";
import { handleClaudeEvent } from "./background-claude-handler";
import { handleACPEvent } from "./background-acp-handler";
import { handleCodexEvent } from "./background-codex-handler";
import { BackgroundSessionStore, type InternalState } from "./background-session-store";

function createState(): InternalState {
  return {
    messages: [],
    isProcessing: false,
    isConnected: false,
    isCompacting: false,
    sessionInfo: null,
    totalCost: 0,
    contextUsage: null,
    pendingPermission: null,
    rawAcpPermission: null,
    slashCommands: [],
    parentToolMap: new Map(),
    currentStreamingMsgId: null,
    codexPlanText: "",
    codexPlanTurnCounter: 0,
    activeTask: null,
  };
}

describe("extractAssistantContextUsage", () => {
  it("normalizes Claude assistant usage without casts at the call site", () => {
    const message: AssistantMessageEvent["message"] = {
      model: "claude-sonnet-4-5",
      id: "msg-1",
      role: "assistant",
      content: [],
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
      },
    };

    expect(extractAssistantContextUsage(message, 200_000)).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 80,
      cacheCreationTokens: 20,
      contextWindow: 200_000,
    });
  });

  it("returns null when the assistant snapshot has no usage payload", () => {
    const message: AssistantMessageEvent["message"] = {
      model: "claude-sonnet-4-5",
      id: "msg-1",
      role: "assistant",
      content: [],
    };

    expect(extractAssistantContextUsage(message, 200_000)).toBeNull();
  });
});

describe("background context usage tracking", () => {
  it("updates Claude background state from assistant usage and result context window", () => {
    const state = createState();

    const assistantEvent = {
      type: "assistant",
      session_id: "session-1",
      uuid: "uuid-1",
      message: {
        model: "claude-sonnet-4-5",
        id: "msg-1",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        usage: {
          input_tokens: 1500,
          output_tokens: 250,
          cache_read_input_tokens: 40,
          cache_creation_input_tokens: 10,
        },
      },
      _sessionId: "session-1",
    } satisfies AssistantMessageEvent & { _sessionId: string };

    handleClaudeEvent(state, assistantEvent);

    expect(state.contextUsage).toEqual({
      inputTokens: 1500,
      outputTokens: 250,
      cacheReadTokens: 40,
      cacheCreationTokens: 10,
      contextWindow: 200_000,
    });

    const resultEvent = {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1,
      num_turns: 1,
      result: "ok",
      total_cost_usd: 0.01,
      session_id: "session-1",
      modelUsage: {
        primary: {
          inputTokens: 1500,
          outputTokens: 250,
          cacheReadInputTokens: 40,
          cacheCreationInputTokens: 10,
          webSearchRequests: 0,
          costUSD: 0.01,
          contextWindow: 1_000_000,
        },
      },
      _sessionId: "session-1",
    } satisfies ResultEvent & { _sessionId: string };

    handleClaudeEvent(state, resultEvent);

    expect(state.contextUsage?.contextWindow).toBe(1_000_000);
  });

  it("updates ACP background state from usage_update events", () => {
    const state = createState();
    const event = {
      _sessionId: "session-1",
      sessionId: "agent-session-1",
      update: {
        sessionUpdate: "usage_update",
        used: 4096,
        size: 128_000,
        cost: { amount: 0.02, currency: "USD" },
      },
    } satisfies ACPSessionEvent;

    handleACPEvent(state, event);

    expect(state.contextUsage).toEqual({
      inputTokens: 4096,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      contextWindow: 128_000,
    });
    expect(state.totalCost).toBe(0.02);
  });

  it("updates Codex background state from token usage notifications", () => {
    const state = createState();
    const event = {
      _sessionId: "session-1",
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          total: {
            inputTokens: 5000,
            outputTokens: 500,
            cachedInputTokens: 100,
            totalTokens: 5600,
            reasoningOutputTokens: 0,
          },
          last: {
            inputTokens: 1200,
            outputTokens: 140,
            cachedInputTokens: 25,
            totalTokens: 1365,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 256_000,
        },
      },
    } satisfies CodexSessionEvent;

    handleCodexEvent(state, event);

    expect(state.contextUsage).toEqual({
      inputTokens: 1200,
      outputTokens: 140,
      cacheReadTokens: 25,
      cacheCreationTokens: 0,
      contextWindow: 256_000,
    });
  });

  it("preserves context usage when background state is stored and restored", () => {
    const store = new BackgroundSessionStore();

    store.initFromState("session-1", {
      messages: [],
      isProcessing: true,
      isConnected: true,
      isCompacting: false,
      sessionInfo: null,
      totalCost: 0.5,
      contextUsage: {
        inputTokens: 2500,
        outputTokens: 200,
        cacheReadTokens: 50,
        cacheCreationTokens: 0,
        contextWindow: 200_000,
      },
      pendingPermission: null,
      rawAcpPermission: null,
      slashCommands: [],
    });

    const restored = store.consume("session-1");

    expect(restored?.contextUsage).toEqual({
      inputTokens: 2500,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheCreationTokens: 0,
      contextWindow: 200_000,
    });
  });
});
