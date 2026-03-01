import {
  Circle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import type { UIMessage, TodoItem } from "@/types";

export function TodoWriteContent({ message }: { message: UIMessage }) {
  const todos = (message.toolInput?.todos ?? []) as TodoItem[];

  return (
    <div className="space-y-0.5 text-xs">
      {todos.map((todo, i) => (
        <div key={i} className="flex items-start gap-2 py-0.5">
          <div className="mt-[1px] shrink-0">
            {todo.status === "completed" ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-500/60" />
            ) : todo.status === "in_progress" ? (
              <Loader2 className="h-3 w-3 text-blue-400/60 animate-spin" />
            ) : (
              <Circle className="h-3 w-3 text-foreground/20" />
            )}
          </div>
          <span
            className={
              todo.status === "completed"
                ? "text-foreground/30 line-through"
                : todo.status === "in_progress"
                  ? "text-foreground/60"
                  : "text-foreground/40"
            }
          >
            {todo.content}
          </span>
        </div>
      ))}
    </div>
  );
}
