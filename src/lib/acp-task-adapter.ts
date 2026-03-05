import type { SubagentToolStep } from "@/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTaskToolName(toolName: string | undefined): boolean {
  const name = String(toolName ?? "").trim().toLowerCase();
  return name === "task" || name === "agent";
}

export function getTaskStatus(status: string | undefined): "running" | "completed" {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "completed" || normalized === "failed" || normalized === "cancelled") {
    return "completed";
  }
  return "running";
}

export function extractTaskSubagentSteps(
  result: Record<string, unknown> | undefined,
): SubagentToolStep[] | undefined {
  if (!result) return undefined;
  const metadata = isRecord(result.metadata) ? result.metadata : undefined;
  const summary = Array.isArray(metadata?.summary) ? metadata.summary : undefined;
  if (!summary || summary.length === 0) return undefined;

  const steps: SubagentToolStep[] = [];
  for (let i = 0; i < summary.length; i++) {
    const item = summary[i];
    if (!isRecord(item)) continue;
    const state = isRecord(item.state) ? item.state : undefined;
    const status = typeof state?.status === "string" ? state.status : undefined;
    const title = typeof state?.title === "string" ? state.title : undefined;
    const rawTool = typeof item.tool === "string" ? item.tool : "Task";
    steps.push({
      toolName: rawTool.charAt(0).toUpperCase() + rawTool.slice(1),
      toolUseId: typeof item.id === "string" ? item.id : `acp-task-step-${i + 1}`,
      toolInput: title ? { description: title } : {},
      // Set toolResult when we have any completion info (status or title)
      ...(status
        ? {
            toolResult: {
              status,
              ...(title ? { content: title } : {}),
            },
          }
        : title
          ? { toolResult: { content: title } }
          : {}),
    });
  }

  return steps.length > 0 ? steps : undefined;
}
