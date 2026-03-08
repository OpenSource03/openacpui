import { describe, expect, it } from "vitest";
import { buildAskUserQuestionResult, getAskUserQuestionAnswer, getAskUserQuestionKey } from "./ask-user-question";

describe("getAskUserQuestionKey", () => {
  it("uses a fallback key when Claude questions do not provide ids", () => {
    expect(getAskUserQuestionKey({ question: "First question?" }, 0)).toBe("question-0");
    expect(getAskUserQuestionKey({ question: "Second question?" }, 1)).toBe("question-1");
  });

  it("prefers the provided question id when available", () => {
    expect(getAskUserQuestionKey({ id: "q-1", question: "First question?" }, 0)).toBe("q-1");
  });
});

describe("getAskUserQuestionAnswer", () => {
  it("reads answers keyed by fallback question ids when Claude questions have no ids", () => {
    const answer = getAskUserQuestionAnswer(
      { question: "Second question?" },
      1,
      {
        answersByQuestionId: {
          "question-0": ["Alpha"],
          "question-1": ["Beta"],
        },
      },
    );

    expect(answer).toBe("Beta");
  });

  it("reads answers keyed by question id", () => {
    const answer = getAskUserQuestionAnswer(
      { id: "q-1", question: "Pick one" },
      0,
      {
        answersByQuestionId: {
          "q-1": ["Option A"],
        },
      },
    );

    expect(answer).toBe("Option A");
  });

  it("falls back to answers keyed by question text for Claude", () => {
    const answer = getAskUserQuestionAnswer(
      { question: "Second question?" },
      1,
      {
        answers: {
          "First question?": "Alpha",
          "Second question?": "Beta",
        },
      },
    );

    expect(answer).toBe("Beta");
  });

  it("falls back to indexed answers when keys do not match", () => {
    const answer = getAskUserQuestionAnswer(
      { question: "Second question?" },
      1,
      {
        answers: {
          first: "Alpha",
          second: "Beta",
        },
      },
    );

    expect(answer).toBe("Beta");
  });

  it("supports Codex-style structured answers", () => {
    const answer = getAskUserQuestionAnswer(
      { id: "q-2", question: "Choose many" },
      0,
      {
        answersByQuestionId: {
          "q-2": { answers: ["One", "Two"] },
        },
      },
    );

    expect(answer).toBe("One, Two");
  });
});

describe("buildAskUserQuestionResult", () => {
  it("keeps answers separate for multiple Claude questions without ids", () => {
    const result = buildAskUserQuestionResult(
      [
        { question: "First question?" },
        { question: "Second question?" },
      ],
      {
        "question-0": new Set(["Alpha"]),
        "question-1": new Set(["Beta"]),
      },
      {},
    );

    expect(result).toEqual({
      answers: {
        "First question?": "Alpha",
        "Second question?": "Beta",
      },
      answersByQuestionId: {
        "question-0": ["Alpha"],
        "question-1": ["Beta"],
      },
    });
  });

  it("prefers free text over selected options for the matching question only", () => {
    const result = buildAskUserQuestionResult(
      [
        { question: "First question?" },
        { question: "Second question?" },
      ],
      {
        "question-0": new Set(["Alpha"]),
        "question-1": new Set(["Beta"]),
      },
      {
        "question-1": "Custom answer",
      },
    );

    expect(result).toEqual({
      answers: {
        "First question?": "Alpha",
        "Second question?": "Custom answer",
      },
      answersByQuestionId: {
        "question-0": ["Alpha"],
        "question-1": ["Custom answer"],
      },
    });
  });
});
