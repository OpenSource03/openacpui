export interface ThinkingAnimatedChunk {
  id: number;
  text: string;
}

export interface ThinkingAnimationState {
  prevThinking: string;
  baseText: string;
  animatedChunks: ThinkingAnimatedChunk[];
  nextChunkId: number;
}

export function createThinkingAnimationState(
  initialThinking = "",
): ThinkingAnimationState {
  return {
    prevThinking: initialThinking,
    baseText: initialThinking,
    animatedChunks: [],
    nextChunkId: 0,
  };
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

/**
 * Keeps thinking animation append-only so the rendered text always matches the
 * latest stream value without replaying old regions.
 */
export function advanceThinkingAnimationState(
  state: ThinkingAnimationState,
  thinking: string,
  isThinking: boolean,
): ThinkingAnimationState {
  const prev = state.prevThinking;
  const curr = thinking;

  if (!isThinking) {
    return {
      ...state,
      prevThinking: curr,
      baseText: curr,
      animatedChunks: [],
    };
  }

  if (!prev || !curr) {
    return {
      ...state,
      prevThinking: curr,
      baseText: curr,
      animatedChunks: [],
    };
  }

  const prefixLen = commonPrefixLength(prev, curr);
  const appendedLen = curr.length - prefixLen;
  if (appendedLen <= 0 || prefixLen < prev.length) {
    return {
      ...state,
      prevThinking: curr,
      baseText: curr,
      animatedChunks: [],
    };
  }

  const appended = curr.slice(prev.length);
  if (!appended) {
    return {
      ...state,
      prevThinking: curr,
    };
  }

  return {
    prevThinking: curr,
    baseText: state.baseText,
    animatedChunks: [
      ...state.animatedChunks,
      { id: state.nextChunkId, text: appended },
    ],
    nextChunkId: state.nextChunkId + 1,
  };
}

export function renderThinkingAnimationText(
  state: ThinkingAnimationState,
): string {
  return state.baseText + state.animatedChunks.map((chunk) => chunk.text).join("");
}
