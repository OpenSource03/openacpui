/**
 * Codex engine types — re-exports from generated protocol schema plus our own wrappers.
 *
 * Protocol types are auto-generated via `codex app-server generate-ts --out src/types/codex-protocol/`.
 * This file provides convenience aliases and OpenACP-specific wrappers (e.g. _sessionId tags).
 */

// ── Generated protocol types ──

export type { ServerNotification as CodexServerNotification } from "./codex-protocol/ServerNotification";
export type { ServerRequest as CodexServerRequest } from "./codex-protocol/ServerRequest";
export type { ClientRequest as CodexClientRequest } from "./codex-protocol/ClientRequest";
export type { ClientNotification as CodexClientNotification } from "./codex-protocol/ClientNotification";
export type { InitializeParams as CodexInitializeParams } from "./codex-protocol/InitializeParams";
export type { InitializeResponse as CodexInitializeResponse } from "./codex-protocol/InitializeResponse";
export type { RequestId as CodexRequestId } from "./codex-protocol/RequestId";

// v2 types (the modern API surface)
export type { ThreadItem as CodexThreadItem } from "./codex-protocol/v2/ThreadItem";
export type { ThreadStartParams as CodexThreadStartParams } from "./codex-protocol/v2/ThreadStartParams";
export type { ThreadStartResponse as CodexThreadStartResponse } from "./codex-protocol/v2/ThreadStartResponse";
export type { ThreadResumeParams as CodexThreadResumeParams } from "./codex-protocol/v2/ThreadResumeParams";
export type { ThreadResumeResponse as CodexThreadResumeResponse } from "./codex-protocol/v2/ThreadResumeResponse";
export type { ThreadListParams as CodexThreadListParams } from "./codex-protocol/v2/ThreadListParams";
export type { ThreadListResponse as CodexThreadListResponse } from "./codex-protocol/v2/ThreadListResponse";
export type { TurnStartParams as CodexTurnStartParams } from "./codex-protocol/v2/TurnStartParams";
export type { TurnStartResponse as CodexTurnStartResponse } from "./codex-protocol/v2/TurnStartResponse";
export type { TurnInterruptParams as CodexTurnInterruptParams } from "./codex-protocol/v2/TurnInterruptParams";
export type { TurnStatus as CodexTurnStatus } from "./codex-protocol/v2/TurnStatus";
export type { Turn as CodexTurn } from "./codex-protocol/v2/Turn";
export type { Thread as CodexThread } from "./codex-protocol/v2/Thread";
export type { UserInput as CodexUserInput } from "./codex-protocol/v2/UserInput";
export type { Model as CodexModel } from "./codex-protocol/v2/Model";
export type { ModelListParams as CodexModelListParams } from "./codex-protocol/v2/ModelListParams";
export type { ModelListResponse as CodexModelListResponse } from "./codex-protocol/v2/ModelListResponse";
export type { AskForApproval as CodexApprovalPolicy } from "./codex-protocol/v2/AskForApproval";
export type { SandboxPolicy as CodexSandboxPolicy } from "./codex-protocol/v2/SandboxPolicy";
export type { CodexErrorInfo } from "./codex-protocol/v2/CodexErrorInfo";

// Notification params
export type { ItemStartedNotification as CodexItemStartedNotification } from "./codex-protocol/v2/ItemStartedNotification";
export type { ItemCompletedNotification as CodexItemCompletedNotification } from "./codex-protocol/v2/ItemCompletedNotification";
export type { AgentMessageDeltaNotification as CodexAgentMessageDeltaNotification } from "./codex-protocol/v2/AgentMessageDeltaNotification";
export type { CommandExecutionOutputDeltaNotification as CodexCommandOutputDeltaNotification } from "./codex-protocol/v2/CommandExecutionOutputDeltaNotification";
export type { FileChangeOutputDeltaNotification as CodexFileChangeDeltaNotification } from "./codex-protocol/v2/FileChangeOutputDeltaNotification";
export type { TurnStartedNotification as CodexTurnStartedNotification } from "./codex-protocol/v2/TurnStartedNotification";
export type { TurnCompletedNotification as CodexTurnCompletedNotification } from "./codex-protocol/v2/TurnCompletedNotification";
export type { TurnDiffUpdatedNotification as CodexTurnDiffUpdatedNotification } from "./codex-protocol/v2/TurnDiffUpdatedNotification";
export type { TurnPlanUpdatedNotification as CodexTurnPlanUpdatedNotification } from "./codex-protocol/v2/TurnPlanUpdatedNotification";
export type { ThreadTokenUsageUpdatedNotification as CodexTokenUsageNotification } from "./codex-protocol/v2/ThreadTokenUsageUpdatedNotification";
export type { ErrorNotification as CodexErrorNotification } from "./codex-protocol/v2/ErrorNotification";
export type { ReasoningSummaryTextDeltaNotification as CodexReasoningSummaryDeltaNotification } from "./codex-protocol/v2/ReasoningSummaryTextDeltaNotification";
export type { ReasoningTextDeltaNotification as CodexReasoningTextDeltaNotification } from "./codex-protocol/v2/ReasoningTextDeltaNotification";

// Approval types (server-initiated requests)
export type { CommandExecutionRequestApprovalParams as CodexCommandApprovalParams } from "./codex-protocol/v2/CommandExecutionRequestApprovalParams";
export type { CommandExecutionRequestApprovalResponse as CodexCommandApprovalResponse } from "./codex-protocol/v2/CommandExecutionRequestApprovalResponse";
export type { CommandExecutionApprovalDecision as CodexCommandApprovalDecision } from "./codex-protocol/v2/CommandExecutionApprovalDecision";
export type { FileChangeRequestApprovalParams as CodexFileChangeApprovalParams } from "./codex-protocol/v2/FileChangeRequestApprovalParams";
export type { FileChangeRequestApprovalResponse as CodexFileChangeApprovalResponse } from "./codex-protocol/v2/FileChangeRequestApprovalResponse";
export type { FileChangeApprovalDecision as CodexFileChangeApprovalDecision } from "./codex-protocol/v2/FileChangeApprovalDecision";

// Auth types
export type { LoginAccountParams as CodexLoginParams } from "./codex-protocol/v2/LoginAccountParams";
export type { LoginAccountResponse as CodexLoginResponse } from "./codex-protocol/v2/LoginAccountResponse";
export type { GetAccountResponse as CodexAccountResponse } from "./codex-protocol/v2/GetAccountResponse";
export type { Account as CodexAccount } from "./codex-protocol/v2/Account";

// Item sub-types
export type { FileUpdateChange as CodexFileUpdateChange } from "./codex-protocol/v2/FileUpdateChange";
export type { CommandExecutionStatus as CodexCommandExecutionStatus } from "./codex-protocol/v2/CommandExecutionStatus";
export type { PatchApplyStatus as CodexPatchApplyStatus } from "./codex-protocol/v2/PatchApplyStatus";
export type { McpToolCallStatus as CodexMcpToolCallStatus } from "./codex-protocol/v2/McpToolCallStatus";

// ── OpenACP-specific wrappers ──

/** Codex notification forwarded from main process, tagged with our internal session ID. */
export interface CodexSessionEvent {
  _sessionId: string;
  method: string;
  params: Record<string, unknown>;
}

/** Codex server-initiated approval request forwarded to the renderer. */
export interface CodexApprovalRequest {
  _sessionId: string;
  /** The JSON-RPC request id — we must respond with this id */
  rpcId: number;
  method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval";
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
}

/** Codex process exit event. */
export interface CodexExitEvent {
  _sessionId: string;
  code: number | null;
  signal: string | null;
}
