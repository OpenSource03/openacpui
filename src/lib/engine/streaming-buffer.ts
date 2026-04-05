import type { ContentBlockStartEvent, ContentBlockDeltaEvent } from "../../types";

/**
 * Merge a streamed chunk into the current buffer while tolerating
 * overlapping or cumulative snapshots from upstream.
 */
export function mergeStreamingChunk(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;

  // Some SDK paths resend the full accumulated value instead of a pure delta.
  if (incoming.startsWith(current)) return incoming;
  if (current.endsWith(incoming)) return current;

  // Cap at 200 chars — SDK thinking deltas are small incremental chunks, so a
  // 200-char window is more than sufficient for overlap detection. Without the
  // cap, this O(n*m) scan grows with accumulated thinking text length.
  const maxOverlap = Math.min(200, current.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (current.endsWith(incoming.slice(0, overlap))) {
      return current + incoming.slice(overlap);
    }
  }

  return current + incoming;
}

/**
 * Lightweight streaming buffer for engines that don't use SDK content block events
 * (ACP and Codex). Accumulates text and thinking chunks with a simple append API.
 */
export class SimpleStreamingBuffer {
  messageId: string | null = null;
  private textChunks: string[] = [];
  private thinkingChunks: string[] = [];
  thinkingComplete = false;

  appendText(text: string): void {
    // Text deltas are pure incremental chunks — simple concatenation avoids
    // false-positive overlap detection eating markdown chars.
    this.textChunks.push(text);
  }

  appendThinking(text: string): void {
    // Thinking may arrive as cumulative snapshots, so overlap detection is needed.
    const current = this.thinkingChunks.join("");
    this.thinkingChunks = [mergeStreamingChunk(current, text)];
  }

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
      // SDK text deltas are always pure incremental chunks — simple concatenation
      // is correct and avoids false-positive overlap detection that can eat
      // markdown-significant characters (|, `, \n, -) at token boundaries.
      const current = this.text.get(index) ?? "";
      this.text.set(index, current + delta.text);
      return true;
    } else if (delta.type === "input_json_delta") {
      const current = this.toolInput.get(index) ?? "";
      this.toolInput.set(index, current + delta.partial_json);
      return false;
    } else if (delta.type === "thinking_delta") {
      // Thinking deltas may arrive as cumulative snapshots from the SDK,
      // so overlap detection is still needed here.
      const current = this.thinking.get(index) ?? "";
      this.thinking.set(index, mergeStreamingChunk(current, delta.thinking));
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
