import type { UIMessage } from "@/types";

function isAssistantActivity(message: UIMessage): boolean {
  return message.role === "assistant" && (!!message.content || !!message.thinking);
}

function isRenderableAssistantText(message: UIMessage): boolean {
  return message.role === "assistant" && !!message.content;
}

function isTurnActivity(message: UIMessage): boolean {
  return message.role === "tool_call" || isAssistantActivity(message);
}

export function formatAssistantTurnDividerLabel(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));

  if (totalSeconds < 60) {
    return `Worked for ${totalSeconds}s`;
  }

  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0
      ? `Worked for ${minutes}m`
      : `Worked for ${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return minutes === 0
    ? `Worked for ${hours}h`
    : `Worked for ${hours}h ${minutes}m`;
}

function collectTurnDividerForRange(
  messages: UIMessage[],
  startIndex: number,
  endIndex: number,
  dividers: Map<string, string>,
) {
  let firstActivityTimestamp: number | null = null;
  let lastAssistantTextIndex = -1;

  for (let i = startIndex; i < endIndex; i++) {
    const message = messages[i];
    if (!isTurnActivity(message)) continue;
    if (firstActivityTimestamp == null) firstActivityTimestamp = message.timestamp;
    if (isRenderableAssistantText(message)) lastAssistantTextIndex = i;
  }

  if (firstActivityTimestamp == null || lastAssistantTextIndex === -1) {
    return;
  }

  let hasPriorActivity = false;
  for (let i = startIndex; i < lastAssistantTextIndex; i++) {
    if (isTurnActivity(messages[i])) {
      hasPriorActivity = true;
      break;
    }
  }

  if (!hasPriorActivity) return;

  const lastAssistant = messages[lastAssistantTextIndex];
  dividers.set(
    lastAssistant.id,
    formatAssistantTurnDividerLabel(Math.max(0, lastAssistant.timestamp - firstActivityTimestamp)),
  );
}

export function computeAssistantTurnDividerLabels(
  messages: UIMessage[],
  isProcessing: boolean,
): Map<string, string> {
  const dividers = new Map<string, string>();
  let turnStartIndex = 0;

  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role !== "user") continue;
    collectTurnDividerForRange(messages, turnStartIndex, i, dividers);
    turnStartIndex = i + 1;
  }

  if (!isProcessing) {
    collectTurnDividerForRange(messages, turnStartIndex, messages.length, dividers);
  }
  return dividers;
}
