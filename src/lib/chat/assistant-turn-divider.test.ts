import { describe, expect, it } from "vitest";
import { computeAssistantTurnDividerLabels, formatAssistantTurnDividerLabel } from "@/lib/chat/assistant-turn-divider";
import type { UIMessage } from "@/types";

function makeUser(id: string, timestamp: number): UIMessage {
  return {
    id,
    role: "user",
    content: "user",
    timestamp,
  };
}

function makeAssistant(id: string, content: string, timestamp: number, thinking?: string): UIMessage {
  return {
    id,
    role: "assistant",
    content,
    thinking,
    timestamp,
  };
}

function makeToolCall(id: string, timestamp: number): UIMessage {
  return {
    id,
    role: "tool_call",
    content: "",
    toolName: "Read",
    toolInput: {},
    timestamp,
  };
}

describe("formatAssistantTurnDividerLabel", () => {
  it("formats seconds, minutes, and hours compactly", () => {
    expect(formatAssistantTurnDividerLabel(900)).toBe("Worked for 1s");
    expect(formatAssistantTurnDividerLabel(65_000)).toBe("Worked for 1m 5s");
    expect(formatAssistantTurnDividerLabel(7_200_000)).toBe("Worked for 2h");
  });
});

describe("computeAssistantTurnDividerLabels", () => {
  it("marks the final assistant text in a tool-using turn", () => {
    const messages: UIMessage[] = [
      makeUser("u1", 0),
      makeAssistant("a1", "I will search", 5_000),
      makeToolCall("t1", 40_000),
      makeAssistant("a2", "I found this file, I will edit", 75_000),
      makeToolCall("t2", 110_000),
      makeAssistant("a3", "I edited, all good", 185_000),
    ];

    const result = computeAssistantTurnDividerLabels(messages, false);

    expect([...result.entries()]).toEqual([["a3", "Worked for 3m"]]);
  });

  it("does not add a divider for single-message assistant turns", () => {
    const messages: UIMessage[] = [
      makeUser("u1", 0),
      makeAssistant("a1", "Direct answer", 10_000),
    ];

    expect(computeAssistantTurnDividerLabels(messages, false).size).toBe(0);
  });

  it("counts thinking-only assistant activity before the final text", () => {
    const messages: UIMessage[] = [
      makeUser("u1", 0),
      makeAssistant("a1", "", 15_000, "Thinking"),
      makeAssistant("a2", "Done", 50_000),
    ];

    const result = computeAssistantTurnDividerLabels(messages, false);

    expect(result.get("a2")).toBe("Worked for 35s");
  });

  it("hides the divider for the current turn while processing is still active", () => {
    const messages: UIMessage[] = [
      makeUser("u1", 0),
      makeAssistant("a1", "I will search", 5_000),
      makeToolCall("t1", 40_000),
      makeAssistant("a2", "I found it", 75_000),
    ];

    expect(computeAssistantTurnDividerLabels(messages, true).size).toBe(0);
  });
});
