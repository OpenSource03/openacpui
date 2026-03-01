import type { UIMessage, ImageAttachment } from "@/types";

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Create a system-role UIMessage (info or error). */
export function createSystemMessage(content: string, isError?: boolean): UIMessage {
  return {
    id: nextId(isError ? "sys-err" : "sys"),
    role: "system",
    content,
    isError: isError || undefined,
    timestamp: Date.now(),
  };
}

/** Create a user-role UIMessage with optional images and display text. */
export function createUserMessage(
  content: string,
  images?: ImageAttachment[],
  displayText?: string,
): UIMessage {
  return {
    id: nextId("user"),
    role: "user",
    content,
    timestamp: Date.now(),
    ...(images?.length ? { images } : {}),
    ...(displayText ? { displayContent: displayText } : {}),
  };
}

/** Convert SDK result error subtypes to user-friendly messages. */
export function formatResultError(subtype: string, detail: string): string {
  switch (subtype) {
    case "error_max_turns":
      return "Session reached the maximum number of turns. Start a new session to continue.";
    case "error_max_budget_usd":
      return "Session exceeded the cost budget limit.";
    case "error_max_structured_output_retries":
      return "Structured output failed after maximum retries.";
    case "error_during_execution":
      return detail || "An error occurred during execution.";
    default:
      return detail || "An unexpected error occurred.";
  }
}
