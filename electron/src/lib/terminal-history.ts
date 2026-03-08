export const MAX_TERMINAL_HISTORY_CHARS = 250_000;

export interface TerminalHistoryState {
  chunks: string[];
  totalChars: number;
}

export const EMPTY_TERMINAL_HISTORY: TerminalHistoryState = {
  chunks: [],
  totalChars: 0,
};

export function appendTerminalHistory(
  history: TerminalHistoryState,
  chunk: string,
  maxChars: number = MAX_TERMINAL_HISTORY_CHARS,
): TerminalHistoryState {
  if (!chunk) return history;

  const chunks = [...history.chunks, chunk];
  let totalChars = history.totalChars + chunk.length;

  while (chunks.length > 1 && totalChars > maxChars) {
    const removed = chunks.shift();
    if (!removed) break;
    totalChars -= removed.length;
  }

  if (chunks.length === 1 && totalChars > maxChars) {
    chunks[0] = chunks[0].slice(-maxChars);
    totalChars = chunks[0].length;
  }

  return { chunks, totalChars };
}

export function readTerminalHistory(history: TerminalHistoryState): string {
  return history.chunks.join("");
}
