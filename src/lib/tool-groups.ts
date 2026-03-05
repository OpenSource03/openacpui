import type { UIMessage } from "@/types";

// ── Types ──

export interface ToolGroup {
  /** The tool_call messages in this group. */
  tools: UIMessage[];
  /** Index of the first tool_call in the messages array. */
  startIndex: number;
  /** Index of the last tool_call in the messages array. */
  endIndex: number;
  /** True when a subsequent assistant text message closes the group. */
  isFinalized: boolean;
}

/** Result of tool group computation. */
export interface ToolGroupInfo {
  /** Map from the start index (first tool_call) to its ToolGroup. */
  groups: Map<number, ToolGroup>;
  /** Set of all message indices that belong to any finalized group (for skip logic). */
  groupedIndices: Set<number>;
}

// ── Tool names excluded from grouping ──

const EXCLUDED_TOOL_NAMES = new Set(["task", "agent", "exitplanmode", "askuserquestion"]);

function isGroupableToolCall(msg: UIMessage): boolean {
  if (msg.role !== "tool_call") return false;
  const name = (msg.toolName ?? "").toLowerCase();
  return !EXCLUDED_TOOL_NAMES.has(name);
}

/** Returns true if the message is an assistant message with non-empty text content. */
function isAssistantText(msg: UIMessage): boolean {
  return msg.role === "assistant" && !!msg.content;
}

// ── Main computation ──

/**
 * Compute tool groups from a messages array.
 *
 * A group is a contiguous sequence of groupable tool_call messages (possibly
 * interleaved with tool_result, system, or summary messages) that falls between
 * two assistant text messages.
 *
 * Groups are "finalized" when a closing assistant text message exists after them.
 * Only finalized groups with 2+ tools are included in the result.
 */
export function computeToolGroups(
  messages: UIMessage[],
  isProcessing: boolean,
): ToolGroupInfo {
  const groups = new Map<number, ToolGroup>();
  const groupedIndices = new Set<number>();

  let currentTools: UIMessage[] = [];
  let currentStartIndex = -1;

  const finalizeGroup = () => {
    // Only create groups with 2+ tools
    if (currentTools.length >= 2) {
      const lastToolIndex = findLastToolIndex(messages, currentStartIndex, currentTools);
      const group: ToolGroup = {
        tools: [...currentTools],
        startIndex: currentStartIndex,
        endIndex: lastToolIndex,
        isFinalized: true,
      };
      groups.set(currentStartIndex, group);
      // Mark all tool_call indices in this group
      for (let i = currentStartIndex; i <= lastToolIndex; i++) {
        if (messages[i].role === "tool_call" && isGroupableToolCall(messages[i])) {
          groupedIndices.add(i);
        }
      }
    }
    currentTools = [];
    currentStartIndex = -1;
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (isGroupableToolCall(msg)) {
      if (currentStartIndex === -1) currentStartIndex = i;
      currentTools.push(msg);
    } else if (isAssistantText(msg)) {
      // Assistant text closes the current group
      finalizeGroup();
    } else if (msg.role === "tool_call" && !isGroupableToolCall(msg)) {
      // Excluded tool (Task, Agent, interactive) — acts as a group boundary
      finalizeGroup();
    }
    // tool_result, system, summary — transparent, don't affect grouping
  }

  // Handle trailing group (tools at end of messages)
  if (currentTools.length >= 2 && !isProcessing) {
    finalizeGroup();
  }

  return { groups, groupedIndices };
}

/** Find the index of the last tool_call message in a group within the messages array. */
function findLastToolIndex(
  messages: UIMessage[],
  startIndex: number,
  tools: UIMessage[],
): number {
  const lastToolId = tools[tools.length - 1].id;
  for (let i = messages.length - 1; i >= startIndex; i--) {
    if (messages[i].id === lastToolId) return i;
  }
  return startIndex;
}
