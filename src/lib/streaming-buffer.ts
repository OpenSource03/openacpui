import type { ContentBlockStartEvent, ContentBlockDeltaEvent } from "../types";

/**
 * Lightweight streaming buffer for engines that don't use SDK content block events
 * (ACP and Codex). Accumulates text and thinking chunks with a simple append API.
 */
export class SimpleStreamingBuffer {
  messageId: string | null = null;
  private textChunks: string[] = [];
  private thinkingChunks: string[] = [];
  thinkingComplete = false;

  appendText(text: string): void { this.textChunks.push(text); }
  appendThinking(text: string): void { this.thinkingChunks.push(text); }

  getText(): string { return this.textChunks.join(""); }
  getThinking(): string { return this.thinkingChunks.join(""); }

  reset(): void {
    this.messageId = null;
    this.textChunks = [];
    this.thinkingChunks = [];
    this.thinkingComplete = false;
  }
}

/**
 * Manages streaming content block state for a single assistant message turn.
 * Pure data — no React dependency, easily testable.
 */
export class StreamingBuffer {
  messageId: string | null = null;
  thinkingComplete = false;

  private text = new Map<number, string>();
  private toolInput = new Map<number, string>();
  private toolMeta = new Map<number, { id: string; name: string }>();
  private thinking = new Map<number, string>();
  private thinkingIndices = new Set<number>();

  /** Pre-existing content from a restored mid-stream session. Prepended to getAllText(). */
  private restoredText = "";
  private restoredThinking = "";

  /** Initialize a block from a content_block_start event. */
  startBlock(index: number, block: ContentBlockStartEvent["content_block"]): void {
    if (block.type === "text") {
      this.text.set(index, block.text);
    } else if (block.type === "tool_use") {
      this.toolMeta.set(index, { id: block.id, name: block.name });
      this.toolInput.set(index, "");
    } else if (block.type === "thinking") {
      this.thinking.set(index, block.thinking);
      this.thinkingIndices.add(index);
    }
  }

  /** Called on content_block_stop. Returns true if a thinking block completed (needs flush). */
  stopBlock(index: number): boolean {
    if (this.thinkingIndices.has(index)) {
      this.thinkingComplete = true;
      return true;
    }
    return false;
  }

  /** Append a delta to the appropriate block buffer. Returns true if text/thinking changed (flush needed). */
  appendDelta(index: number, delta: ContentBlockDeltaEvent["delta"]): boolean {
    if (delta.type === "text_delta") {
      const current = this.text.get(index) ?? "";
      this.text.set(index, current + delta.text);
      return true;
    } else if (delta.type === "input_json_delta") {
      const current = this.toolInput.get(index) ?? "";
      this.toolInput.set(index, current + delta.partial_json);
      return false;
    } else if (delta.type === "thinking_delta") {
      const current = this.thinking.get(index) ?? "";
      this.thinking.set(index, current + delta.thinking);
      return true;
    }
    return false;
  }

  /** Seed buffer with content from a restored mid-stream message. */
  seedFromRestore(text: string, thinking?: string): void {
    this.restoredText = text;
    this.restoredThinking = thinking ?? "";
    if (thinking) this.thinkingComplete = true;
  }

  getAllText(): string {
    return this.restoredText + Array.from(this.text.values()).join("");
  }

  getAllThinking(): string {
    return this.restoredThinking + Array.from(this.thinking.values()).join("");
  }

  getToolMeta(index: number): { id: string; name: string } | undefined {
    return this.toolMeta.get(index);
  }

  getRawToolInput(index: number): string {
    return this.toolInput.get(index) ?? "{}";
  }

  reset(): void {
    this.messageId = null;
    this.thinkingComplete = false;
    this.restoredText = "";
    this.restoredThinking = "";
    this.text.clear();
    this.toolInput.clear();
    this.toolMeta.clear();
    this.thinking.clear();
    this.thinkingIndices.clear();
  }
}
