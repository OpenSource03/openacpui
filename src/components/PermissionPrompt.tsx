import { useState } from "react";
import { ShieldAlert, Check, X, Send, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PermissionRequest, RespondPermissionFn } from "@/types";

const TOOL_LABELS: Record<string, string> = {
  Write: "Create a file",
  Edit: "Edit a file",
  Bash: "Run a command",
  NotebookEdit: "Edit a notebook",
};

function formatToolDetail(req: PermissionRequest): string | null {
  const input = req.toolInput;
  if (req.toolName === "Write" && input.file_path) return String(input.file_path);
  if (req.toolName === "Edit" && input.file_path) return String(input.file_path);
  if (req.toolName === "Bash" && input.command) return String(input.command).slice(0, 120);
  return null;
}

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
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
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
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

        <div className="flex items-center justify-end border-t border-border/40 px-3 py-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRespond("deny")}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Stay in Plan
          </Button>
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
    for (const q of questions) {
      init[q.question] = new Set();
    }
    return init;
  });
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  const toggleOption = (questionText: string, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[questionText] ?? new Set();
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
      return { ...prev, [questionText]: next };
    });
    setFreeText((prev) => ({ ...prev, [questionText]: "" }));
  };

  const handleSubmit = () => {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const custom = freeText[q.question]?.trim();
      if (custom) {
        answers[q.question] = custom;
      } else {
        const selected = selections[q.question];
        answers[q.question] = [...(selected ?? [])].join(", ");
      }
    }
    onRespond("allow", {
      questions: request.toolInput.questions,
      answers,
    });
  };

  const hasAllAnswers = questions.every((q) => {
    const custom = freeText[q.question]?.trim();
    const selected = selections[q.question];
    return custom || (selected && selected.size > 0);
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      <div className="pointer-events-auto rounded-2xl border border-border/60 bg-background/55 shadow-lg backdrop-blur-lg">
        {questions.map((q, qi) => (
          <div
            key={q.question}
            className={`flex flex-col gap-3 px-4 py-3.5 ${qi > 0 ? "border-t border-border/40" : ""}`}
          >
            <p className="text-[13px] text-foreground">{q.question}</p>

            <div className="grid grid-cols-2 gap-1.5">
              {q.options.map((opt) => {
                const isSelected = selections[q.question]?.has(opt.label);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => toggleOption(q.question, opt.label, q.multiSelect)}
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
          </div>
        ))}

        <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2.5">
          <input
            type="text"
            placeholder="Type your own answer..."
            value={freeText[questions[0]?.question] ?? ""}
            onChange={(e) => {
              const key = questions[0]?.question;
              if (!key) return;
              setFreeText((prev) => ({ ...prev, [key]: e.target.value }));
              if (e.target.value.trim()) {
                setSelections((prev) => ({ ...prev, [key]: new Set() }));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hasAllAnswers) handleSubmit();
            }}
            className="min-w-0 flex-1 bg-transparent px-1 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
          />
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
  if (request.toolName === "ExitPlanMode") {
    return <ExitPlanModePrompt request={request} onRespond={onRespond} />;
  }

  if (request.toolName === "AskUserQuestion") {
    return <AskUserQuestionPrompt request={request} onRespond={onRespond} />;
  }

  const label = TOOL_LABELS[request.toolName] ?? `Use tool: ${request.toolName}`;
  const detail = formatToolDetail(request);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border/60 bg-background/55 px-4 py-3 shadow-lg backdrop-blur-lg">
        <ShieldAlert className="h-5 w-5 shrink-0 text-foreground/60" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {detail && (
            <p className="truncate text-xs text-muted-foreground font-mono">{detail}</p>
          )}
          {request.decisionReason && (
            <p className="truncate text-xs text-muted-foreground">{request.decisionReason}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRespond("deny")}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Deny
          </Button>
          {showAcceptForSession && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRespond("allowForSession")}
              className="h-8 gap-1.5 text-xs"
            >
              <Check className="h-3.5 w-3.5" />
              Allow for Session
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => onRespond("allow")}
            className="h-8 gap-1.5 text-xs"
          >
            <Check className="h-3.5 w-3.5" />
            Allow
          </Button>
        </div>
      </div>
    </div>
  );
}
