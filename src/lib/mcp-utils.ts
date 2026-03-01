import type { McpServerStatusState } from "../types/ui";

/** Validate a raw status string into a safe McpServerStatusState, defaulting to "failed". */
export function toMcpStatusState(raw: string): McpServerStatusState {
  const valid: McpServerStatusState[] = ["connected", "failed", "needs-auth", "pending", "disabled"];
  return valid.includes(raw as McpServerStatusState) ? (raw as McpServerStatusState) : "failed";
}
