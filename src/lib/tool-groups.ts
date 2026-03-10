import type { UIMessage } from "@/types";

// ── Types ──

export interface ToolGroup {
  /** The tool_call messages in this group. */
  tools: UIMessage[];
  /** Ordered grouped messages: tool_call plus in-between thinking-only assistant messages. */
  messages: UIMessage[];
  /** Index of the first grouped message in the messages array. */
  startIndex: number;
  /** Index of the last grouped message in the messages array. */
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
const EDIT_BOUNDARY_TOOL_NAMES = new Set(["edit", "write"]);

function isGroupableToolCall(msg: UIMessage): boolean {
  if (msg.role !== "tool_call") return false;
  const name = (msg.toolName ?? "").toLowerCase();
  return !EXCLUDED_TOOL_NAMES.has(name);
}

function isEditBoundaryToolCall(msg: UIMessage): boolean {
  if (msg.role !== "tool_call") return false;
  return EDIT_BOUNDARY_TOOL_NAMES.has((msg.toolName ?? "").toLowerCase());
}

/** Returns true for assistant messages that contain only thinking text. */
function isAssistantThinkingOnly(msg: UIMessage): boolean {
  return msg.role === "assistant" && !!msg.thinking && !msg.content;
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
 * interleaved with tool_result, system, summary, or thinking-only assistant
 * messages) that falls between two assistant text messages.
 *
 * Groups are "finalized" when a closing assistant text message exists after them.
 * Only finalized groups with 2+ tools are included in the result.
 */
export function computeToolGroups(
  messages: UIMessage[],
  isProcessing: boolean,
  avoidGroupingEdits: boolean,
): ToolGroupInfo {
  const groups = new Map<number, ToolGroup>();
  const groupedIndices = new Set<number>();

  let currentTools: UIMessage[] = [];
  let currentMessages: UIMessage[] = [];
  let currentStartIndex = -1;

  const finalizeGroup = () => {
    // Only create groups with 2+ tools
    if (currentTools.length >= 2) {
      const lastGroupedIndex = findLastGroupedIndex(messages, currentStartIndex, currentMessages);
      const group: ToolGroup = {
        tools: [...currentTools],
        messages: [...currentMessages],
        startIndex: currentStartIndex,
        endIndex: lastGroupedIndex,
        isFinalized: true,
      };
      groups.set(currentStartIndex, group);
      const groupedMessageIds = new Set(currentMessages.map((message) => message.id));
      for (let i = currentStartIndex; i <= lastGroupedIndex; i++) {
        if (groupedMessageIds.has(messages[i].id)) {
          groupedIndices.add(i);
        }
      }
    }
    currentTools = [];
    currentMessages = [];
    currentStartIndex = -1;
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (isGroupableToolCall(msg)) {
      if (avoidGroupingEdits && isEditBoundaryToolCall(msg)) {
        finalizeGroup();
        currentStartIndex = i;
        currentTools.push(msg);
        currentMessages.push(msg);
        finalizeGroup();
        continue;
      }
      if (currentStartIndex === -1) currentStartIndex = i;
      currentTools.push(msg);
      currentMessages.push(msg);
    } else if (isAssistantThinkingOnly(msg)) {
      if (currentStartIndex !== -1) currentMessages.push(msg);
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

/** Find the index of the last grouped message in a group within the messages array. */
function findLastGroupedIndex(
  messages: UIMessage[],
  startIndex: number,
  groupedMessages: UIMessage[],
): number {
  const lastGroupedId = groupedMessages[groupedMessages.length - 1].id;
  for (let i = messages.length - 1; i >= startIndex; i--) {
    if (messages[i].id === lastGroupedId) return i;
  }
  return startIndex;
}
