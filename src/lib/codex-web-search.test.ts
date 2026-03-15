import { describe, expect, it } from "vitest";
import type { CodexSessionEvent } from "@/types/codex";
import { codexItemToToolInput, codexItemToToolResult } from "./codex-adapter";
import { handleCodexEvent } from "./background-codex-handler";
import type { InternalState } from "./background-session-store";

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

describe("codex web search mapping", () => {
  it("maps completed web searches to structured tool data", () => {
    const item = {
      type: "webSearch",
      id: "ws_123",
      query: "Anthropic Claude Agent SDK docs",
      action: {
        type: "search",
        query: "Anthropic Claude Agent SDK docs official",
        queries: [
          "Anthropic Claude Agent SDK docs official",
          "site:docs.anthropic.com Claude Agent SDK docs",
        ],
      },
    } as const;

    expect(codexItemToToolInput(item)).toEqual({
      query: "Anthropic Claude Agent SDK docs",
      actionType: "search",
      actionQuery: "Anthropic Claude Agent SDK docs official",
      queries: [
        "Anthropic Claude Agent SDK docs official",
        "site:docs.anthropic.com Claude Agent SDK docs",
      ],
    });

    expect(codexItemToToolResult(item)).toEqual({
      type: "web_search",
      status: "completed",
      content: "Searched web with 2 queries",
      structuredContent: {
        query: "Anthropic Claude Agent SDK docs",
        actionType: "search",
        actionQuery: "Anthropic Claude Agent SDK docs official",
        queries: [
          "Anthropic Claude Agent SDK docs official",
          "site:docs.anthropic.com Claude Agent SDK docs",
        ],
      },
    });
  });

  it("finalizes background web search cards with the completed query payload", () => {
    const state = createState();

    handleCodexEvent(state, {
      _sessionId: "session-1",
      method: "item/started",
      params: {
        item: {
          type: "webSearch",
          id: "ws_123",
          query: "",
          action: { type: "other" },
        },
      },
    } satisfies CodexSessionEvent);

    handleCodexEvent(state, {
      _sessionId: "session-1",
      method: "item/completed",
      params: {
        item: {
          type: "webSearch",
          id: "ws_123",
          query: "Anthropic Claude Agent SDK docs",
          action: {
            type: "search",
            query: "Anthropic Claude Agent SDK docs official",
            queries: [
              "Anthropic Claude Agent SDK docs official",
              "site:docs.anthropic.com Claude Agent SDK docs",
            ],
          },
        },
      },
    } satisfies CodexSessionEvent);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: "codex-tool-ws_123",
      role: "tool_call",
      toolName: "WebSearch",
      toolInput: {
        query: "Anthropic Claude Agent SDK docs",
        actionType: "search",
        actionQuery: "Anthropic Claude Agent SDK docs official",
        queries: [
          "Anthropic Claude Agent SDK docs official",
          "site:docs.anthropic.com Claude Agent SDK docs",
        ],
      },
      toolResult: {
        type: "web_search",
        status: "completed",
        content: "Searched web with 2 queries",
      },
    });
  });
});
