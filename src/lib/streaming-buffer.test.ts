import { describe, expect, it } from "vitest";
import { StreamingBuffer, mergeStreamingChunk } from "./streaming-buffer";

describe("mergeStreamingChunk", () => {
  it("appends ordinary delta chunks", () => {
    expect(mergeStreamingChunk("Hello", " world")).toBe("Hello world");
  });

  it("tolerates cumulative snapshots without duplicating prior content", () => {
    expect(mergeStreamingChunk("Hello", "Hello world")).toBe("Hello world");
  });

  it("tolerates overlapping chunks without repeating the overlap", () => {
    expect(mergeStreamingChunk("Hello wor", "world")).toBe("Hello world");
  });

  it("ignores exact duplicate suffix replays", () => {
    expect(mergeStreamingChunk("Hello world", "world")).toBe("Hello world");
  });
});

describe("StreamingBuffer", () => {
  it("keeps thinking content stable when the SDK resends the full thought so far", () => {
    const buffer = new StreamingBuffer();

    buffer.startBlock(0, { type: "thinking", thinking: "" });
    buffer.appendDelta(0, {
      type: "thinking_delta",
      thinking: "The user wants me to think deeply again",
    });
    buffer.appendDelta(0, {
      type: "thinking_delta",
      thinking: "The user wants me to think deeply again so they can see the thinking block UI.",
    });

    expect(buffer.getAllThinking()).toBe(
      "The user wants me to think deeply again so they can see the thinking block UI.",
    );
  });

  it("merges overlapping text deltas without repeating the shared prefix", () => {
    const buffer = new StreamingBuffer();

    buffer.startBlock(0, { type: "text", text: "" });
    buffer.appendDelta(0, { type: "text_delta", text: "Time is " });
    buffer.appendDelta(0, { type: "text_delta", text: "is strange." });

    expect(buffer.getAllText()).toBe("Time is strange.");
  });
});
