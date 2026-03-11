import { CheckCircle2, Loader2, ListChecks } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PanelHeader } from "@/components/PanelHeader";
import type { TodoItem } from "@/types";
import { getTodoItems } from "@/lib/todo-utils";

interface TodoPanelProps {
  todos: TodoItem[];
}

/** Circular progress ring rendered as SVG. */
function ProgressRing({ completed, total }: { completed: number; total: number }) {
  const progress = total > 0 ? completed / total : 0;
  const allDone = completed === total && total > 0;
  const radius = 18;
  const stroke = 3;
  const center = radius + stroke / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <div className="relative flex items-center justify-center">
      <svg
        width={center * 2}
        height={center * 2}
        viewBox={`0 0 ${center * 2} ${center * 2}`}
        className="-rotate-90"
      >
        {/* Track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-foreground/[0.06]"
        />
        {/* Progress arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="url(#progress-gradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
        <defs>
          <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            {allDone ? (
              <>
                <stop offset="0%" stopColor="rgb(52, 211, 153)" stopOpacity="0.9" />
                <stop offset="100%" stopColor="rgb(16, 185, 129)" stopOpacity="0.9" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="rgb(96, 165, 250)" stopOpacity="0.8" />
                <stop offset="100%" stopColor="rgb(147, 197, 253)" stopOpacity="0.6" />
              </>
            )}
          </linearGradient>
        </defs>
      </svg>
      {/* Center label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-[11px] font-semibold tabular-nums leading-none ${
          allDone ? "text-emerald-400" : "text-foreground/70"
        }`}>
          {completed}/{total}
        </span>
      </div>
    </div>
  );
}

/** Step number badge for each task item. */
function StepBadge({ index, status }: { index: number; status: TodoItem["status"] }) {
  if (status === "completed") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      </div>
    );
  }
  if (status === "in_progress") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/15">
        <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />
      </div>
    );
  }
  return (
    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/[0.05]">
      <span className="text-[10px] font-medium tabular-nums text-foreground/25">{index}</span>
    </div>
  );
}

export function TodoPanel({ todos }: TodoPanelProps) {
  const items = getTodoItems(todos);
  const completed = items.filter((t) => t.status === "completed").length;
  const total = items.length;
  const allDone = completed === total && total > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header area with ring + label */}
      <div className="px-4 pt-3.5 pb-3">
        <PanelHeader
          icon={ListChecks}
          label="Tasks"
          separator={false}
          className=""
          iconClass="text-blue-600/70 dark:text-blue-200/50"
        >
          {/* Progress ring in the header right side */}
          <ProgressRing completed={completed} total={total} />
        </PanelHeader>

        {/* Thin progress bar below header — provides an at-a-glance indicator */}
        <div className="mt-2.5 h-[3px] rounded-full bg-foreground/[0.05] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              allDone
                ? "bg-gradient-to-r from-emerald-400/70 to-emerald-300/50"
                : "bg-gradient-to-r from-blue-400/60 to-blue-300/40"
            }`}
            style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Gradient separator */}
      <div className="mx-3">
        <div className="h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
      </div>

      {/* Scrollable task list */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2.5 py-2 space-y-px">
          {items.map((todo, i) => {
            const isActive = todo.status === "in_progress";
            const isDone = todo.status === "completed";

            return (
              <div
                key={i}
                className={`group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-150 ${
                  isActive
                    ? "bg-blue-500/[0.04]"
                    : "hover:bg-foreground/[0.02]"
                }`}
              >
                {/* Step indicator */}
                <div className={`shrink-0 ${isActive ? "self-start mt-0.5" : ""}`}>
                  <StepBadge index={i + 1} status={todo.status} />
                </div>

                {/* Task content */}
                <div className="min-w-0 flex-1">
                  <span
                    className={`text-[12.5px] leading-snug ${
                      isDone
                        ? "text-foreground/25 line-through decoration-foreground/10"
                        : isActive
                          ? "text-foreground/90 font-medium"
                          : "text-foreground/50"
                    }`}
                  >
                    {isActive && todo.activeForm
                      ? todo.activeForm
                      : todo.content}
                  </span>

                  {/* Active task label */}
                  {isActive && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="h-1 w-1 rounded-full bg-blue-400/70 animate-pulse" />
                      <span className="text-[10px] font-medium text-blue-400/50 uppercase tracking-wider">
                        In progress
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
