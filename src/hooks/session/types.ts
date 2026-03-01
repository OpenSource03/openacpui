import type { ChatSession, UIMessage, SessionInfo, PermissionRequest, ImageAttachment, McpServerStatus, ModelInfo, AcpPermissionBehavior, EngineId, Project } from "../../types";
import type { ACPConfigOption, ACPPermissionEvent } from "../../types/acp";
import type { BackgroundSessionStore } from "../../lib/background-session-store";
import { permissionModeToCodexPolicy } from "../../lib/codex-adapter";
import type { CollaborationMode } from "../../types/codex-protocol/CollaborationMode";

export const DRAFT_ID = "__draft__";
export const DEFAULT_PERMISSION_MODE = "default";

export interface StartOptions {
  model?: string;
  permissionMode?: string;
  planMode?: boolean;
  thinkingEnabled?: boolean;
  engine?: EngineId;
  agentId?: string;
  /** Cached config options from previous sessions — shown before session starts */
  cachedConfigOptions?: ACPConfigOption[];
}

export interface CodexModelSummary {
  id: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort: string;
  isDefault?: boolean;
}

export interface InitialMeta {
  isProcessing: boolean;
  isConnected: boolean;
  sessionInfo: SessionInfo | null;
  totalCost: number;
}

export interface QueuedMessage {
  text: string;
  images?: ImageAttachment[];
  displayText?: string;
  /** ID of the UIMessage already shown in chat with isQueued: true */
  messageId: string;
}

/** Shared refs that multiple sub-hooks need to read/write */
export interface SharedSessionRefs {
  activeSessionIdRef: React.MutableRefObject<string | null>;
  sessionsRef: React.MutableRefObject<ChatSession[]>;
  projectsRef: React.MutableRefObject<Project[]>;
  draftProjectIdRef: React.MutableRefObject<string | null>;
  startOptionsRef: React.MutableRefObject<StartOptions>;
  messagesRef: React.MutableRefObject<UIMessage[]>;
  totalCostRef: React.MutableRefObject<number>;
  isProcessingRef: React.MutableRefObject<boolean>;
  isConnectedRef: React.MutableRefObject<boolean>;
  sessionInfoRef: React.MutableRefObject<SessionInfo | null>;
  pendingPermissionRef: React.MutableRefObject<PermissionRequest | null>;
  liveSessionIdsRef: React.MutableRefObject<Set<string>>;
  backgroundStoreRef: React.MutableRefObject<BackgroundSessionStore>;
  preStartedSessionIdRef: React.MutableRefObject<string | null>;
  draftMcpStatusesRef: React.MutableRefObject<McpServerStatus[]>;
  materializingRef: React.MutableRefObject<boolean>;
  saveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  messageQueueRef: React.MutableRefObject<QueuedMessage[]>;
  acpAgentIdRef: React.MutableRefObject<string | null>;
  acpAgentSessionIdRef: React.MutableRefObject<string | null>;
  codexRawModelsRef: React.MutableRefObject<CodexModelSummary[]>;
  codexEffortRef: React.MutableRefObject<string>;
  codexEffortManualOverrideRef: React.MutableRefObject<boolean>;
  lastMessageSyncSessionRef: React.MutableRefObject<string | null>;
  switchSessionRef: React.MutableRefObject<((id: string) => Promise<void>) | undefined>;
  onSpaceChangeRef: React.MutableRefObject<((spaceId: string) => void) | undefined>;
  acpPermissionBehaviorRef: React.MutableRefObject<AcpPermissionBehavior>;
}

/** State setters from the orchestrator that sub-hooks need */
export interface SharedSessionSetters {
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setInitialMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  setInitialMeta: React.Dispatch<React.SetStateAction<InitialMeta | null>>;
  setInitialConfigOptions: React.Dispatch<React.SetStateAction<ACPConfigOption[]>>;
  setInitialPermission: React.Dispatch<React.SetStateAction<PermissionRequest | null>>;
  setInitialRawAcpPermission: React.Dispatch<React.SetStateAction<ACPPermissionEvent | null>>;
  setStartOptions: React.Dispatch<React.SetStateAction<StartOptions>>;
  setDraftProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  setPreStartedSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftMcpStatuses: React.Dispatch<React.SetStateAction<McpServerStatus[]>>;
  setAcpMcpStatuses: React.Dispatch<React.SetStateAction<McpServerStatus[]>>;
  setQueuedCount: React.Dispatch<React.SetStateAction<number>>;
  setCachedModels: React.Dispatch<React.SetStateAction<ModelInfo[]>>;
  setCodexRawModels: React.Dispatch<React.SetStateAction<CodexModelSummary[]>>;
}

// Engine hook types — use ReturnType of the actual hooks for perfect alignment.
// Imported via type-only to avoid circular dependency (hooks import types, not vice versa).
import type { useClaude } from "../useClaude";
import type { useACP } from "../useACP";
import type { useCodex } from "../useCodex";

/** The engine hook return types that sub-hooks need to call */
export interface EngineHooks {
  claude: ReturnType<typeof useClaude>;
  acp: ReturnType<typeof useACP>;
  codex: ReturnType<typeof useCodex>;
  /** The currently-active engine — one of claude/acp/codex */
  engine: ReturnType<typeof useClaude> | ReturnType<typeof useACP> | ReturnType<typeof useCodex>;
}

// ── Utility functions shared across sub-hooks ──

export function getSelectedPermissionMode(options: StartOptions): string {
  const mode = options.permissionMode?.trim();
  return mode && mode !== "plan" ? mode : DEFAULT_PERMISSION_MODE;
}

export function getEffectiveClaudePermissionMode(options: StartOptions): string {
  return options.planMode ? "plan" : getSelectedPermissionMode(options);
}

export function normalizeCodexModels(rawModels: unknown[]): CodexModelSummary[] {
  const models: CodexModelSummary[] = [];
  for (const raw of rawModels) {
    const model = raw as Record<string, unknown>;
    if (typeof model.id !== "string") continue;
    const supportedReasoningEfforts = Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts
        .map((entry) => entry as Record<string, unknown>)
        .filter((entry): entry is { reasoningEffort: string; description: string } =>
          typeof entry.reasoningEffort === "string" && typeof entry.description === "string",
        )
      : [];
    models.push({
      id: model.id,
      displayName: typeof model.displayName === "string" ? model.displayName : model.id,
      description: typeof model.description === "string" ? model.description : "",
      supportedReasoningEfforts,
      defaultReasoningEffort:
        typeof model.defaultReasoningEffort === "string"
          ? model.defaultReasoningEffort
          : "medium",
      isDefault: model.isDefault === true,
    });
  }
  return models;
}

export function pickCodexModel(
  requestedModel: string | undefined,
  models: CodexModelSummary[],
): string | undefined {
  const requested = typeof requestedModel === "string" ? requestedModel.trim() : "";
  if (requested.length > 0 && models.some((m) => m.id === requested)) {
    return requested;
  }
  return models.find((m) => m.isDefault)?.id ?? models[0]?.id;
}

/** Build a CollaborationMode for plan mode, including the required model in settings. */
export function buildCodexCollabMode(planMode: boolean | undefined, model: string | undefined): CollaborationMode | undefined {
  if (!planMode) return undefined;
  const normalizedModel = model?.trim();
  if (!normalizedModel) {
    throw new Error("Codex plan mode is enabled, but no model is selected. Select a Codex model and try again.");
  }
  return {
    mode: "plan" as const,
    settings: {
      // The server requires model in settings; it takes precedence when collaborationMode is set
      model: normalizedModel,
      reasoning_effort: null,
      developer_instructions: null,
    },
  };
}

export function getCodexApprovalPolicy(options: StartOptions): string | undefined {
  return permissionModeToCodexPolicy(getSelectedPermissionMode(options));
}
