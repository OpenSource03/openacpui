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

  it("concatenates text deltas without overlap detection", () => {
    const buffer = new StreamingBuffer();

    buffer.startBlock(0, { type: "text", text: "" });
    buffer.appendDelta(0, { type: "text_delta", text: "Time is " });
    buffer.appendDelta(0, { type: "text_delta", text: "is strange." });

    // Text deltas are pure incremental — no overlap detection, simple concat.
    expect(buffer.getAllText()).toBe("Time is is strange.");
  });

  it("preserves markdown pipe characters at token boundaries", () => {
    const buffer = new StreamingBuffer();

    buffer.startBlock(0, { type: "text", text: "" });
    buffer.appendDelta(0, { type: "text_delta", text: "| Name | Age |\n|------|-----|\n| Alice | 25 |" });
    buffer.appendDelta(0, { type: "text_delta", text: "\n| Bob | 30 |" });

    expect(buffer.getAllText()).toBe(
      "| Name | Age |\n|------|-----|\n| Alice | 25 |\n| Bob | 30 |",
    );
  });

  it("preserves backtick characters at token boundaries", () => {
    const buffer = new StreamingBuffer();

    buffer.startBlock(0, { type: "text", text: "" });
    buffer.appendDelta(0, { type: "text_delta", text: "Use `" });
    buffer.appendDelta(0, { type: "text_delta", text: "`code``" });

    expect(buffer.getAllText()).toBe("Use ``code``");
  });

  it("preserves double newlines (paragraph breaks) at token boundaries", () => {
    const buffer = new StreamingBuffer();

    buffer.startBlock(0, { type: "text", text: "" });
    buffer.appendDelta(0, { type: "text_delta", text: "Paragraph one.\n" });
    buffer.appendDelta(0, { type: "text_delta", text: "\nParagraph two." });

    expect(buffer.getAllText()).toBe("Paragraph one.\n\nParagraph two.");
  });

  it("preserves single-character pipe deltas", () => {
    const buffer = new StreamingBuffer();

    buffer.startBlock(0, { type: "text", text: "" });
    buffer.appendDelta(0, { type: "text_delta", text: "|" });
    buffer.appendDelta(0, { type: "text_delta", text: "|" });

    expect(buffer.getAllText()).toBe("||");
  });
});
