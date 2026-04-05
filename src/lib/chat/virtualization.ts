import type { RowDescriptor } from "@/components/ChatView";

// ── Constants ──

export const UNVIRTUALIZED_TAIL_IDLE = 8;
const UNVIRTUALIZED_TAIL_BUFFER = 6;
export const VIRTUALIZER_OVERSCAN = 12;

// ── Measured height cache ──
// Persists across virtualizer unmount/remount so re-entering items use actual measured
// heights instead of estimates. Keyed by row key (message ID, group key, etc.).
const MEASURED_HEIGHT_CACHE_LIMIT = 512;
const measuredHeightCache = new Map<string, number>();

export function getCachedMeasuredHeight(key: string): number | undefined {
  return measuredHeightCache.get(key);
}

export function setCachedMeasuredHeight(key: string, height: number): void {
  if (measuredHeightCache.has(key)) {
    measuredHeightCache.delete(key);
  }
  measuredHeightCache.set(key, height);
  if (measuredHeightCache.size > MEASURED_HEIGHT_CACHE_LIMIT) {
    const oldest = measuredHeightCache.keys().next().value;
    if (oldest !== undefined) measuredHeightCache.delete(oldest);
  }
}

// ── Height estimation ──
// These estimates are the virtualizer's initial guess before ResizeObserver measures.
// Closer estimates = less visual jump when measurements arrive.

// Line height ~19px for code, ~22px for prose. Avg chars per line ~80.
const LINE_HEIGHT_PX = 20;
const CHARS_PER_LINE = 80;

function estimateLineCount(text: string): number {
  if (!text) return 0;
  let lines = 0;
  let lineLen = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines += Math.max(1, Math.ceil(lineLen / CHARS_PER_LINE));
      lineLen = 0;
    } else {
      lineLen++;
    }
  }
  if (lineLen > 0) lines += Math.ceil(lineLen / CHARS_PER_LINE);
  return lines;
}

export function estimateRowHeight(row: RowDescriptor): number {
  if (row.kind === "processing") return 32;

  if (row.kind === "turn_summary") return 48;

  if (row.kind === "tool_group") {
    // Collapsed group header ~44px
    return 44;
  }

  // row.kind === "message"
  const msg = row.msg;

  if (msg.role === "system") return msg.isError ? 48 : 36;
  if (msg.role === "summary") return 48;

  if (msg.role === "tool_call") {
    // Collapsed tool: header only ~36px.
    // Expanded edit/write: header + diff/content, but most tools are collapsed in history.
    return 36;
  }

  if (msg.role === "user") {
    const text = msg.displayContent ?? msg.content;
    const lines = estimateLineCount(text);
    const imageRows = msg.images ? Math.ceil(msg.images.length / 3) : 0;
    // Base padding (48px) + text lines + image rows (200px each)
    return Math.min(400, 48 + lines * LINE_HEIGHT_PX + imageRows * 200);
  }

  // assistant — most complex: prose + optional thinking + code blocks
  const content = msg.content;
  if (!content) {
    // Thinking-only message
    return msg.thinking ? Math.min(320, 40 + estimateLineCount(msg.thinking) * LINE_HEIGHT_PX) : 40;
  }

  const lines = estimateLineCount(content);
  // Count code fences for additional padding per code block (~32px header each)
  let codeBlockCount = 0;
  let idx = 0;
  while ((idx = content.indexOf("```", idx)) !== -1) {
    codeBlockCount++;
    idx += 3;
  }
  const codeBlockPadding = Math.floor(codeBlockCount / 2) * 32;

  // Base padding (40px) + lines + thinking collapse header + code block headers
  const thinkingHeight = msg.thinking ? 32 : 0;
  return Math.min(1200, 40 + lines * LINE_HEIGHT_PX + thinkingHeight + codeBlockPadding);
}

// ── Tail boundary ──

/**
 * Compute the index where the unvirtualized tail begins.
 * Rows at and after this index are rendered in normal document flow.
 * Rows before this index are rendered by the virtualizer.
 */
export function computeTailStartIndex(
  rows: RowDescriptor[],
  isProcessing: boolean,
): number {
  if (rows.length === 0) return 0;

  let tailStart: number;

  if (isProcessing) {
    // Find last user message — the current turn starts after it.
    // Keep the entire current turn + BUFFER rows above it unvirtualized.
    let lastUserIndex = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row.kind === "message" && row.msg.role === "user") {
        lastUserIndex = i;
        break;
      }
    }

    tailStart = lastUserIndex >= 0
      ? lastUserIndex - UNVIRTUALIZED_TAIL_BUFFER
      : 0;
  } else {
    tailStart = rows.length - UNVIRTUALIZED_TAIL_IDLE;
  }

  // Clamp to valid range
  tailStart = Math.max(0, Math.min(tailStart, rows.length));

  // Never split a tool_group across the boundary — snap earlier
  while (tailStart > 0 && rows[tailStart].kind === "tool_group") {
    tailStart--;
  }

  return tailStart;
}
