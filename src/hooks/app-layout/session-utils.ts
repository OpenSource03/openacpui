import type { ClaudeEffort, EngineId, InstalledAgent } from "@/types";
import type { StartOptions } from "@/hooks/session/types";

/** Build common session-creation options from current settings and agent state. */
export function buildSessionOptions(
  engine: EngineId,
  getModelForEngine: (engine: EngineId) => string | null,
  permissionMode: string,
  planMode: boolean,
  thinking: boolean,
  getClaudeEffortForModel: (model: string | undefined) => ClaudeEffort | undefined,
  agent: InstalledAgent | null,
): StartOptions {
  const model = getModelForEngine(engine) || undefined;
  return {
    model,
    permissionMode,
    planMode,
    thinkingEnabled: thinking,
    effort: engine === "claude" ? getClaudeEffortForModel(model) : undefined,
    engine,
    agentId: agent?.id ?? "claude-code",
    cachedConfigOptions: agent?.cachedConfigOptions,
  };
}

export function getSyncedPlanMode(
  sessionPlanMode: boolean | undefined,
  permissionMode: string | undefined,
): boolean {
  const normalizedPermissionMode = permissionMode?.trim();
  if (normalizedPermissionMode) {
    return normalizedPermissionMode === "plan";
  }
  return !!sessionPlanMode;
}
