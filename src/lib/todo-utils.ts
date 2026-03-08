import type { TodoItem } from "@/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTodoStatus(value: unknown): value is TodoItem["status"] {
  return value === "pending" || value === "in_progress" || value === "completed";
}

function normalizeTodoArray(value: unknown[]): TodoItem[] {
  const todos: TodoItem[] = [];

  for (const item of value) {
    if (!isRecord(item) || typeof item.content !== "string" || !isTodoStatus(item.status)) {
      continue;
    }

    const todo: TodoItem = {
      content: item.content,
      status: item.status,
    };

    if (typeof item.activeForm === "string" && item.activeForm) {
      todo.activeForm = item.activeForm;
    }

    todos.push(todo);
  }

  return todos;
}

function parseMarkdownTodos(value: string): TodoItem[] | null {
  const todos: TodoItem[] = [];

  for (const line of value.split("\n")) {
    const match = line.match(/^\s*-\s*\[(x|X| )\]\s+(.+)$/);
    if (!match) continue;

    todos.push({
      content: match[2].trim(),
      status: match[1].toLowerCase() === "x" ? "completed" : "pending",
    });
  }

  return todos.length > 0 ? todos : null;
}

function parseTodoItems(value: unknown): TodoItem[] | null {
  if (Array.isArray(value)) {
    return normalizeTodoArray(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeTodoArray(parsed);
    }
  } catch {
    // Fall through to the markdown checklist parser.
  }

  return parseMarkdownTodos(trimmed);
}

export function getTodoItems(value: unknown): TodoItem[] {
  return parseTodoItems(value) ?? [];
}

export function normalizeTodoToolInput(toolName: string, input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    return {};
  }

  if (toolName !== "TodoWrite") {
    return input;
  }

  const todos = parseTodoItems(input.todos);
  if (todos === null) {
    return input;
  }

  return {
    ...input,
    todos,
  };
}
