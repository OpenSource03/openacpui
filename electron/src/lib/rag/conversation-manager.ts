/**
 * Conversation window manager for Ollama sessions.
 *
 * Problem: Small models (4B) have limited context windows (~4-8K tokens).
 * As conversations grow, they overflow the window and the model "forgets"
 * or produces garbage.
 *
 * Solution:
 *   - Keep last MAX_TURNS message pairs in full
 *   - When exceeding, extract key topics from old messages and compress
 *     them into a single summary note — no LLM call needed
 *   - RAG context injected per-turn is NOT counted in conversation history
 *
 * Usage:
 *   const managed = compressConversation(session.messages);
 *   // Use managed instead of session.messages for the API call
 */

export interface ConvMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Keep this many user+assistant pairs in full text.
 *  3 turns = 6 messages — optimized for 4B models with ~4-8K context. */
const MAX_FULL_TURNS = 3;

// ── Summary extraction (no LLM call) ─────────────────────────────────────────

/**
 * Extract meaningful topics from a set of messages to build a compact summary.
 * Template-based — zero latency, zero tokens spent.
 */
function summarizeMessages(messages: ConvMessage[]): string {
  const items: string[] = [];

  for (const msg of messages) {
    if (msg.role !== "user") continue;

    // Strip injected RAG blocks (between ─── lines) to get clean user intent
    const cleanContent = msg.content
      .replace(/File:.*?\n─{40,}[\s\S]*?─{40,}\n?/g, "")  // RAG file blocks
      .replace(/\[ACTUAL FILE CONTENT.*?\]/g, "")
      .replace(/Tool results:[\s\S]*?(?=\n\n|\nContinue|\nAnswer)/g, "") // tool result blocks
      .trim();

    if (!cleanContent) continue;

    // Collect file references
    const fileRefs = cleanContent.match(/[\w./-]+\.(ts|tsx|js|jsx|mjs|py|go|php|json|css|md|yaml)\b/g) ?? [];
    for (const f of fileRefs.slice(0, 2)) items.push(f);

    // Collect the core request (first 80 chars, ignoring Question: prefix)
    const core = cleanContent
      .replace(/^Question:\s*/i, "")
      .replace(/\n.*/s, "")
      .trim()
      .slice(0, 80);
    if (core.length > 10) items.push(`"${core}"`);
  }

  const unique = [...new Set(items)].slice(0, 8);
  if (unique.length === 0) return "Earlier conversation omitted.";
  return `Earlier: ${unique.join("; ")}.`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Return a compressed view of the conversation to keep within context limits.
 *
 * The original `messages` array is NOT mutated.
 * Compression only happens when over the limit.
 */
export function compressConversation(messages: ConvMessage[]): ConvMessage[] {
  const systemMessages = messages.filter((m) => m.role === "system");
  const conversation = messages.filter((m) => m.role !== "system");

  // Count only real user+assistant turns (ignore injected RAG turns)
  const threshold = MAX_FULL_TURNS * 2; // user + assistant per turn

  if (conversation.length <= threshold) {
    return messages; // no compression needed
  }

  const toCompress = conversation.slice(0, -threshold);
  const toKeep = conversation.slice(-threshold);

  const summary = summarizeMessages(toCompress);

  return [
    ...systemMessages,
    { role: "system", content: summary },
    ...toKeep,
  ];
}

/**
 * Estimate token count for a messages array.
 * Rough heuristic: 1 token ≈ 4 characters.
 */
export function estimateTokens(messages: ConvMessage[]): number {
  return Math.ceil(
    messages.reduce((sum, m) => sum + m.content.length, 0) / 4,
  );
}
