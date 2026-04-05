// ── Permission types ──

export type PermissionUpdateDestination = "userSettings" | "projectSettings" | "localSettings" | "session";

export interface PermissionRuleValue {
  toolName: string;
  ruleContent?: string;
}

export interface PermissionUpdate {
  type: string;
  rules?: PermissionRuleValue[];
  behavior?: string;
  destination: PermissionUpdateDestination;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  suggestions?: PermissionUpdate[];
  decisionReason?: string;
  /** Original Codex JSON-RPC request id (preserves number vs string type for responses). */
  codexRpcId?: string | number;
}

/**
 * Client-side permission auto-response behavior for ACP sessions.
 * ACP agents provide their own permission options (allow_once, allow_always, etc.).
 * This setting controls whether the client auto-responds or prompts the user.
 */
export type AcpPermissionBehavior = "ask" | "auto_accept" | "allow_all";
