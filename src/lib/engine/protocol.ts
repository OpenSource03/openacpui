import type {
  ContentBlock,
  ToolUseResult,
  ClaudeEvent,
  ImageAttachment,
  AssistantMessageEvent,
  ContextUsage,
} from "../../types";

/**
 * Normalize tool_use_result which may be an object, a string, or missing.
 * When missing, the actual result text lives in the raw message content.
 */
export function normalizeToolResult(
  toolUseResult: ToolUseResult | string | undefined,
  rawContent: string | Array<{ type: string; text: string }>,
): ToolUseResult {
  // Return structured result if it has actual fields (skip empty {} from SDK)
  if (toolUseResult && typeof toolUseResult !== "string" && Object.keys(toolUseResult).length > 0) return toolUseResult;
  const contentStr = typeof rawContent === "string"
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map((c) => c.text).join("\n")
      : (typeof rawContent === "object" && rawContent !== null)
        ? JSON.stringify(rawContent)
        : String(rawContent ?? "");
  return { type: "text", stdout: contentStr };
}

/** Join all text blocks from an assistant message. */
export function extractTextContent(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Join all thinking blocks from an assistant message. */
export function extractThinkingContent(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is ContentBlock & { type: "thinking" } => b.type === "thinking")
    .map((b) => b.thinking)
    .join("");
}

/** Normalize Claude assistant message usage into the shared context meter shape. */
export function extractAssistantContextUsage(
  message: AssistantMessageEvent["message"],
  previousContextWindow?: number | null,
): ContextUsage | null {
  const usage = message.usage;
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    contextWindow: previousContextWindow ?? 0,
  };
}

/**
 * Build SDK-compatible content: plain string when text-only,
 * or an array of content blocks when images are attached.
 */
export function buildSdkContent(
  text: string,
  images?: ImageAttachment[],
): string | Array<{ type: string; [key: string]: unknown }> {
  if (!images || images.length === 0) return text;

  const blocks: Array<{ type: string; [key: string]: unknown }> = [];

  for (const img of images) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.data,
      },
    });
  }

  if (text) {
    blocks.push({ type: "text", text });
  }

  return blocks;
}

/** Extract parent_tool_use_id from any event type. */
export function getParentId(event: ClaudeEvent): string | null {
  if ("parent_tool_use_id" in event && event.parent_tool_use_id) {
    return event.parent_tool_use_id;
  }
  return null;
}
