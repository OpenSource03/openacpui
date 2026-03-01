import { Circle, CheckCircle2, Loader2, ListChecks } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PanelHeader } from "@/components/PanelHeader";
import type { TodoItem } from "@/types";

interface TodoPanelProps {
  todos: TodoItem[];
}

export function TodoPanel({ todos }: TodoPanelProps) {
  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;
  const allDone = completed === total;

  return (
    <div className="flex h-full flex-col">
      {/* Header with progress bar */}
      <div className="px-4 pt-4 pb-3">
        <PanelHeader
          icon={ListChecks}
          label="Tasks"
          separator={false}
          className=""
          iconClass="text-foreground/50"
        >
          <span className="text-xs tabular-nums text-foreground/50">
            {completed}/{total}
          </span>
        </PanelHeader>
        <div className="mt-3 h-1.5 rounded-full bg-foreground/[0.08] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              allDone ? "bg-emerald-500/60" : "bg-blue-500/50"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Separator */}
      <div className="border-t border-foreground/[0.08]" />

      {/* Scrollable todo list */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 py-2 space-y-0.5">
          {todos.map((todo, i) => (
            <div
              key={i}
              className={`flex items-start gap-2.5 rounded-md px-2 py-1.5 ${
                todo.status === "in_progress" ? "bg-foreground/[0.03]" : ""
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {todo.status === "completed" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500/60" />
                ) : todo.status === "in_progress" ? (
                  <Loader2 className="h-4 w-4 text-blue-400/70 animate-spin" />
                ) : (
                  <Circle className="h-4 w-4 text-foreground/20" />
                )}
              </div>
              <span
                className={`text-[13px] leading-snug ${
                  todo.status === "completed"
                    ? "text-foreground/30 line-through"
                    : todo.status === "in_progress"
                      ? "text-foreground/90"
                      : "text-foreground/50"
                }`}
              >
                {todo.status === "in_progress" && todo.activeForm
                  ? todo.activeForm
                  : todo.content}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
