import { Loader2 } from "lucide-react";
import { getAskUserQuestionAnswer, getAskUserQuestionKey } from "@/lib/ask-user-question";
import type { UIMessage } from "@/types";

interface AskQuestionOption {
  label: string;
  description: string;
}

interface AskQuestionItem {
  id?: string;
  question: string;
  header: string;
  options: AskQuestionOption[];
  multiSelect: boolean;
}

export function AskUserQuestionContent({ message }: { message: UIMessage }) {
  const questions = (message.toolInput?.questions ?? []) as AskQuestionItem[];
  const hasResult = !!message.toolResult;

  return (
    <div className="space-y-1.5 text-xs">
      {questions.map((q, qi) => {
        const answer = hasResult ? getAskUserQuestionAnswer(q, qi, message.toolResult) : null;

        return (
          <div
            key={getAskUserQuestionKey(q, qi)}
            className={qi > 0 ? "border-t border-border/30 pt-1.5" : ""}
          >
            <span className="text-[12px] text-foreground/70 leading-snug">
              {q.question}
            </span>

            {!hasResult && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-foreground/25 italic">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                Waiting for answer…
              </div>
            )}

            {answer && (
              <div className="mt-0.5">
                <span className="text-[11px] text-foreground/35">Answer: </span>
                <span className="text-[12px] text-foreground/75">{answer}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
