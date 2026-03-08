import type { ToolUseResult } from "@/types";

interface AskUserQuestion {
  id?: string;
  question: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function formatAnswerValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  const record = asRecord(value);
  if (!record) return null;

  return (
    formatAnswerValue(record.answers) ??
    formatAnswerValue(record.answer) ??
    formatAnswerValue(record.value)
  );
}

export function getAskUserQuestionKey(question: AskUserQuestion, index: number): string {
  const id = typeof question.id === "string" ? question.id.trim() : "";
  return id || `question-${index}`;
}

export function buildAskUserQuestionResult(
  questions: AskUserQuestion[],
  selections: Record<string, Set<string>>,
  freeText: Record<string, string>,
): Pick<ToolUseResult, "answers" | "answersByQuestionId"> {
  const answers: Record<string, string> = {};
  const answersByQuestionId: Record<string, string[]> = {};

  for (const [index, question] of questions.entries()) {
    const questionKey = getAskUserQuestionKey(question, index);
    const custom = freeText[questionKey]?.trim();
    if (custom) {
      answers[question.question] = custom;
      answersByQuestionId[questionKey] = [custom];
      continue;
    }

    const selected = [...(selections[questionKey] ?? [])];
    answers[question.question] = selected.join(", ");
    answersByQuestionId[questionKey] = selected;
  }

  return { answers, answersByQuestionId };
}

export function getAskUserQuestionAnswer(
  question: AskUserQuestion,
  index: number,
  toolResult?: Pick<ToolUseResult, "answers" | "answersByQuestionId">,
): string {
  const answers = asRecord(toolResult?.answers);
  const answersByQuestionId = asRecord(toolResult?.answersByQuestionId);
  const questionKey = getAskUserQuestionKey(question, index);

  const direct =
    formatAnswerValue(answersByQuestionId?.[questionKey]) ??
    formatAnswerValue(answers?.[questionKey]) ??
    formatAnswerValue(answers?.[question.question]);
  if (direct) return direct;

  const orderedAnswersById = answersByQuestionId ? Object.values(answersByQuestionId) : [];
  const orderedAnswers = answers ? Object.values(answers) : [];

  return (
    formatAnswerValue(orderedAnswersById[index]) ??
    formatAnswerValue(orderedAnswers[index]) ??
    "No answer captured"
  );
}
