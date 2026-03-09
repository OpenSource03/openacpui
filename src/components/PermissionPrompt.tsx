import { useEffect, useRef, useState } from "react";
import { ShieldAlert, Check, X, Send, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BOTTOM_CHAT_MAX_WIDTH_CLASS } from "@/lib/layout-constants";
import { buildAskUserQuestionResult, getAskUserQuestionKey } from "@/lib/ask-user-question";
import type { PermissionRequest, RespondPermissionFn } from "@/types";

const TOOL_LABELS: Record<string, string> = {
  Read: "Read a file",
  Write: "Create a file",
  Edit: "Edit a file",
  Bash: "Run a command",
  NotebookEdit: "Edit a notebook",
};

interface ToolDetail {
  label: string;
  value: string;
  meta?: string;
}

function formatToolDetail(req: PermissionRequest): ToolDetail | null {
  const input = req.toolInput;
  if (req.toolName === "Bash" && typeof input.command === "string") {
    const description = typeof input.description === "string" ? input.description.trim() : "";
    return {
      label: "Command",
      value: input.command,
      ...(description ? { meta: description } : {}),
    };
  }
  if (req.toolName === "Read" && typeof input.file_path === "string") {
    const pages = typeof input.pages === "string" ? input.pages.trim() : "";
    return {
      label: "File",
      value: input.file_path,
      ...(pages ? { meta: `Pages: ${pages}` } : {}),
    };
  }
  if (req.toolName === "Write" && typeof input.file_path === "string") {
    return { label: "File", value: input.file_path };
  }
  if (req.toolName === "Edit" && typeof input.file_path === "string") {
    return { label: "File", value: input.file_path };
  }
  if (req.toolName === "NotebookEdit" && typeof input.file_path === "string") {
    return { label: "Notebook", value: input.file_path };
  }
  if (typeof input.file_path === "string") {
    return { label: "Target", value: input.file_path };
  }
  if (typeof input.command === "string") {
    return { label: "Command", value: input.command };
  }
  return null;
}

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  id?: string;
  question: string;
  header: string;
  isOther?: boolean;
  isSecret?: boolean;
  options?: QuestionOption[];
  multiSelect: boolean;
}

interface PermissionPromptProps {
  request: PermissionRequest;
  onRespond: RespondPermissionFn;
  /** When true, show a third "Allow for Session" button (Codex engine) */
  showAcceptForSession?: boolean;
}

// --- ExitPlanMode: let user choose which permission mode to switch to ---

const EXIT_PLAN_MODES = [
  { id: "acceptEdits", label: "Accept Edits", description: "Auto-approve file edits" },
  { id: "default", label: "Ask First", description: "Prompt before each tool" },
  { id: "bypassPermissions", label: "Allow All", description: "No permission prompts" },
] as const;

function ExitPlanModePrompt({ request, onRespond }: PermissionPromptProps) {
  const [feedback, setFeedback] = useState("");
  const hasFeedback = feedback.trim().length > 0;

  const submitFeedback = () => {
    if (!hasFeedback) return;
    onRespond("deny", { denyMessage: feedback.trim() });
  };

  return (
    <div className={`mx-auto w-full px-4 pb-4 ${BOTTOM_CHAT_MAX_WIDTH_CLASS}`}>
      <div className="pointer-events-auto rounded-2xl border border-border/60 bg-background/55 shadow-lg backdrop-blur-lg">
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <p className="text-[13px] text-foreground">
            Ready to implement. How should permissions work?
          </p>

          <div className="flex flex-wrap gap-1.5">
            {EXIT_PLAN_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => onRespond("allow", request.toolInput, mode.id)}
                className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2 text-start text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground"
              >
                <Play className="h-3 w-3 shrink-0" />
                <div className="flex flex-col items-start">
                  <span className="text-xs font-medium leading-snug">{mode.label}</span>
                  <span className="text-[11px] leading-snug text-muted-foreground/60">{mode.description}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border/40 px-3 py-2.5">
          <input
            type="text"
            placeholder="Give feedback to refine the plan..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitFeedback();
              if (e.key === "Escape") setFeedback("");
            }}
            className="w-full rounded-md border border-border/40 bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus-visible:border-border"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRespond("deny")}
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Stay in Plan
            </Button>
            {hasFeedback && (
              <Button
                size="sm"
                onClick={submitFeedback}
                className="h-8 gap-1.5 text-xs"
              >
                <Send className="h-3.5 w-3.5" />
                Send Feedback
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- AskUserQuestion: render questions with selectable options ---

function AskUserQuestionPrompt({ request, onRespond }: PermissionPromptProps) {
  const questions = (request.toolInput.questions ?? []) as Question[];
  const [selections, setSelections] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {};
    for (const [index, q] of questions.entries()) {
      init[getAskUserQuestionKey(q, index)] = new Set();
    }
    return init;
  });
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  const toggleOption = (questionKey: string, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[questionKey] ?? new Set();
      const next = new Set(current);
      if (multiSelect) {
        if (next.has(label)) next.delete(label);
        else next.add(label);
      } else {
        if (next.has(label)) next.clear();
        else {
          next.clear();
          next.add(label);
        }
      }
      return { ...prev, [questionKey]: next };
    });
    setFreeText((prev) => ({ ...prev, [questionKey]: "" }));
  };

  const handleSubmit = () => {
    const { answers, answersByQuestionId } = buildAskUserQuestionResult(questions, selections, freeText);
    onRespond("allow", {
      questions: request.toolInput.questions,
      answers,
      answersByQuestionId,
    });
  };

  const hasAllAnswers = questions.every((q, index) => {
    const questionKey = getAskUserQuestionKey(q, index);
    const custom = freeText[questionKey]?.trim();
    const selected = selections[questionKey];
    return custom || (selected && selected.size > 0);
  });

  return (
    <div className={`mx-auto w-full px-4 pb-4 ${BOTTOM_CHAT_MAX_WIDTH_CLASS}`}>
      <div className="pointer-events-auto rounded-2xl border border-border/60 bg-background/55 shadow-lg backdrop-blur-lg">
        {questions.map((q, qi) => (
          <div
            key={q.id ?? `${qi}-${q.question}`}
            className={`flex flex-col gap-3 px-4 py-3.5 ${qi > 0 ? "border-t border-border/40" : ""}`}
          >
            <p className="text-[13px] text-foreground">{q.question}</p>

            <div className="grid grid-cols-2 gap-1.5">
              {(q.options ?? []).map((opt) => {
                const questionKey = getAskUserQuestionKey(q, qi);
                const isSelected = selections[questionKey]?.has(opt.label);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => toggleOption(questionKey, opt.label, q.multiSelect)}
                    className={`flex flex-col items-start rounded-lg border px-3 py-2 text-start transition-colors ${
                      isSelected
                        ? "border-border bg-accent text-foreground"
                        : "border-border/40 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground"
                    }`}
                  >
                    <span className="text-xs font-medium leading-snug">{opt.label}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground/60">{opt.description}</span>
                  </button>
                );
              })}
            </div>

            <input
              type={q.isSecret ? "password" : "text"}
              placeholder="Or type your own answer..."
              value={freeText[getAskUserQuestionKey(q, qi)] ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                const questionKey = getAskUserQuestionKey(q, qi);
                setFreeText((prev) => ({ ...prev, [questionKey]: value }));
                if (value.trim()) {
                  setSelections((prev) => ({ ...prev, [questionKey]: new Set() }));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hasAllAnswers) handleSubmit();
              }}
              className="w-full rounded-md border border-border/40 bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus-visible:border-border"
            />
          </div>
        ))}

        <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRespond("deny")}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Skip
          </Button>
          <Button
            size="sm"
            disabled={!hasAllAnswers}
            onClick={handleSubmit}
            className="h-8 gap-1.5 text-xs"
          >
            <Send className="h-3.5 w-3.5" />
            Answer
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Default tool permission prompt ---

export function PermissionPrompt({ request, onRespond, showAcceptForSession }: PermissionPromptProps) {
  const [submittingAction, setSubmittingAction] = useState<"allow" | "deny" | "allowForSession" | null>(null);
  const submittingRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    submittingRequestIdRef.current = null;
    setSubmittingAction(null);
  }, [request.requestId]);

  if (request.toolName === "ExitPlanMode") {
    return <ExitPlanModePrompt request={request} onRespond={onRespond} />;
  }

  if (request.toolName === "AskUserQuestion") {
    return <AskUserQuestionPrompt request={request} onRespond={onRespond} />;
  }

  const label = TOOL_LABELS[request.toolName] ?? `Use tool: ${request.toolName}`;
  const detail = formatToolDetail(request);
  const isSubmitting = submittingAction !== null;

  const submit = async (
    behavior: "allow" | "deny" | "allowForSession",
  ) => {
    if (isSubmitting) return;
    if (submittingRequestIdRef.current === request.requestId) return;
    submittingRequestIdRef.current = request.requestId;
    const submittedRequestId = request.requestId;
    setSubmittingAction(behavior);
    try {
      await onRespond(behavior);
    } catch {
      if (submittingRequestIdRef.current === submittedRequestId) {
        submittingRequestIdRef.current = null;
        setSubmittingAction(null);
      }
    }
  };

  return (
    <div className={`mx-auto w-full px-4 pb-4 ${BOTTOM_CHAT_MAX_WIDTH_CLASS}`}>
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border/60 bg-background/55 px-4 py-3 shadow-lg backdrop-blur-lg">
        <ShieldAlert className="h-5 w-5 shrink-0 text-foreground/60" />

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {detail && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                {detail.label}
              </p>
              <div className="max-h-28 overflow-auto rounded-md bg-foreground/[0.04] px-3 py-2 font-mono text-[11px] text-foreground/75 whitespace-pre-wrap wrap-break-word">
                {detail.value}
              </div>
              {detail.meta && (
                <p className="text-[11px] text-muted-foreground/80">{detail.meta}</p>
              )}
            </div>
          )}
          {request.decisionReason && (
            <p className="text-xs text-muted-foreground wrap-break-word">{request.decisionReason}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={isSubmitting}
            onClick={() => void submit("deny")}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            {submittingAction === "deny" ? "Denying..." : "Deny"}
          </Button>
          {showAcceptForSession && (
            <Button
              size="sm"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => void submit("allowForSession")}
              className="h-8 gap-1.5 text-xs"
            >
              <Check className="h-3.5 w-3.5" />
              {submittingAction === "allowForSession" ? "Allowing..." : "Allow for Session"}
            </Button>
          )}
          <Button
            size="sm"
            disabled={isSubmitting}
            onClick={() => void submit("allow")}
            className="h-8 gap-1.5 text-xs"
          >
            <Check className="h-3.5 w-3.5" />
            {submittingAction === "allow" ? "Allowing..." : "Allow"}
          </Button>
        </div>
      </div>
    </div>
  );
}
