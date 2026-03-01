import { Loader2 } from "lucide-react";
import type { UIMessage } from "@/types";

interface AskQuestionOption {
  label: string;
  description: string;
}

interface AskQuestionItem {
  question: string;
  header: string;
  options: AskQuestionOption[];
  multiSelect: boolean;
}

export function AskUserQuestionContent({ message }: { message: UIMessage }) {
  const questions = (message.toolInput?.questions ?? []) as AskQuestionItem[];
  const hasResult = !!message.toolResult;
  const answers = (() => {
    const raw = message.toolResult?.answers;
    if (!raw || typeof raw !== "object") return null;
    return raw as Record<string, unknown>;
  })();
  const orderedAnswers = answers ? Object.values(answers) : [];

  return (
    <div className="space-y-2 text-xs">
      {questions.map((q, qi) => (
        <div
          key={q.question}
          className={qi > 0 ? "border-t border-border/40 pt-2" : ""}
        >
          <span className="text-[13px] text-foreground/80 leading-snug">
            {q.question}
          </span>

          {/* Waiting state when tool hasn't returned yet */}
          {!hasResult && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-foreground/30 italic">
              <Loader2 className="h-3 w-3 animate-spin" />
              Waiting for answer…
            </div>
          )}

          {/* Result state after user answered AskUserQuestion */}
          {hasResult && (
            <div className="mt-1.5">
              <span className="text-[11px] text-foreground/40">Answer: </span>
              <span className="text-[12px] text-foreground/80">
                {(() => {
                  const direct = answers?.[q.question];
                  if (typeof direct === "string" && direct.trim()) return direct;
                  // Fallback for edge cases where question text keys differ
                  const indexed = orderedAnswers[qi];
                  if (typeof indexed === "string" && indexed.trim()) return indexed;
                  return "No answer captured";
                })()}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
