import { describe, expect, it } from "vitest";
import {
  advanceThinkingAnimationState,
  createThinkingAnimationState,
  renderThinkingAnimationText,
} from "./thinking-animation";

describe("thinking animation state", () => {
  it("renders exactly the latest cumulative thinking text at every step", () => {
    let state = createThinkingAnimationState("");

    const snapshots = [
      "The user wants me to think deeply one more time.",
      "The user wants me to think deeply one more time. Let me explore another fascinating topic.",
      "The user wants me to think deeply one more time. Let me explore another fascinating topic.\n\nLet me think about the simulation hypothesis.",
      "The user wants me to think deeply one more time. Let me explore another fascinating topic.\n\nLet me think about the simulation hypothesis and the nature of reality itself.",
    ];

    for (const snapshot of snapshots) {
      state = advanceThinkingAnimationState(state, snapshot, true);
      expect(renderThinkingAnimationText(state)).toBe(snapshot);
    }
  });

  it("does not duplicate text when the same snapshot is replayed", () => {
    let state = createThinkingAnimationState("");

    state = advanceThinkingAnimationState(state, "Let me think about time.", true);
    state = advanceThinkingAnimationState(
      state,
      "Let me think about time.\n\nWhat is time, really?",
      true,
    );
    state = advanceThinkingAnimationState(
      state,
      "Let me think about time.\n\nWhat is time, really?",
      true,
    );

    expect(renderThinkingAnimationText(state)).toBe(
      "Let me think about time.\n\nWhat is time, really?",
    );
    expect(state.animatedChunks).toEqual([]);
  });

  it("resets cleanly when upstream rewrites existing text instead of appending", () => {
    let state = createThinkingAnimationState("");

    state = advanceThinkingAnimationState(
      state,
      "The simulation hypothesis might actually be unfalsifiable.",
      true,
    );
    state = advanceThinkingAnimationState(
      state,
      "The simulation hypothesis might actually be unfalsifiable. Yet it remains compelling.",
      true,
    );
    state = advanceThinkingAnimationState(
      state,
      "Let me switch topics entirely.",
      true,
    );

    expect(renderThinkingAnimationText(state)).toBe(
      "Let me switch topics entirely.",
    );
    expect(state.baseText).toBe("Let me switch topics entirely.");
    expect(state.animatedChunks).toEqual([]);
  });

  it("collapses to the final text when streaming finishes", () => {
    let state = createThinkingAnimationState("");

    state = advanceThinkingAnimationState(
      state,
      "Nested simulations create another puzzle.",
      true,
    );
    state = advanceThinkingAnimationState(
      state,
      "Nested simulations create another puzzle: if we could build our own simulations, they'd create theirs too.",
      true,
    );
    state = advanceThinkingAnimationState(
      state,
      "Nested simulations create another puzzle: if we could build our own simulations, they'd create theirs too.",
      false,
    );

    expect(renderThinkingAnimationText(state)).toBe(
      "Nested simulations create another puzzle: if we could build our own simulations, they'd create theirs too.",
    );
    expect(state.animatedChunks).toEqual([]);
  });
});
