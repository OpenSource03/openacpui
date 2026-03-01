import type {
  ClaudeEvent,
  UIMessage,
  SessionInfo,
  PermissionRequest,
} from "../types";
import type { ACPSessionEvent, ACPPermissionEvent } from "../types/acp";
import type { CodexSessionEvent } from "../types/codex";
import { handleClaudeEvent } from "./background-claude-handler";
import { handleACPEvent as acpHandler, handleACPTurnComplete as acpTurnComplete } from "./background-acp-handler";
import { handleCodexEvent as codexHandler } from "./background-codex-handler";

export interface BackgroundSessionState {
  messages: UIMessage[];
  isProcessing: boolean;
  isConnected: boolean;
  sessionInfo: SessionInfo | null;
  totalCost: number;
  pendingPermission: PermissionRequest | null;
  /** Raw ACP permission event — needed for optionId lookup when responding */
  rawAcpPermission: ACPPermissionEvent | null;
}

export interface InternalState extends BackgroundSessionState {
  parentToolMap: Map<string, string>;
  currentStreamingMsgId: string | null;
  /** Accumulated plan text from item/plan/delta events (Codex only). */
  codexPlanText: string;
  /** Per-turn counter for unique plan card message IDs (Codex only). */
  codexPlanTurnCounter: number;
}

/** Callback fired when a background session receives a permission request */
type PermissionRequestCallback = (sessionId: string, permission: PermissionRequest) => void;

/**
 * Accumulates UIMessages for sessions not currently active in useClaude.
 * Prevents event loss when switching between sessions with ongoing responses.
 */
export class BackgroundSessionStore {
  private sessions = new Map<string, InternalState>();
  onProcessingChange?: (sessionId: string, isProcessing: boolean) => void;
  onPermissionRequest?: PermissionRequestCallback;

  private getOrCreate(sessionId: string): InternalState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        messages: [],
        isProcessing: false,
        isConnected: false,
        sessionInfo: null,
        totalCost: 0,
        pendingPermission: null,
        rawAcpPermission: null,
        parentToolMap: new Map(),
        currentStreamingMsgId: null,
        codexPlanText: "",
        codexPlanTurnCounter: 0,
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  handleEvent(event: ClaudeEvent & { _sessionId?: string }): void {
    const sessionId = event._sessionId;
    if (!sessionId) return;

    const state = this.getOrCreate(sessionId);
    const result = handleClaudeEvent(state, event);
    if (result?.processingChanged) {
      this.onProcessingChange?.(sessionId, result.isProcessing);
    }
  }

  handleACPEvent(event: ACPSessionEvent): void {
    const sessionId = event._sessionId;
    if (!sessionId) return;

    const state = this.getOrCreate(sessionId);
    acpHandler(state, event);
  }

  /** Handle ACP turn completion — finalize streaming, close tools, reset processing. */
  handleACPTurnComplete(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    acpTurnComplete(state);
    this.onProcessingChange?.(sessionId, false);
  }

  /** Handle a Codex notification for a background (non-active) session. */
  handleCodexEvent(event: CodexSessionEvent): void {
    const sessionId = event._sessionId;
    if (!sessionId) return;

    const state = this.getOrCreate(sessionId);
    const result = codexHandler(state, event);
    if (result?.processingChanged) {
      this.onProcessingChange?.(sessionId, result.isProcessing!);
    }
    if (result?.permissionRequest) {
      this.onPermissionRequest?.(sessionId, result.permissionRequest);
    }
  }

  /** Store a pending permission for a background session and fire the callback. */
  setPermission(sessionId: string, permission: PermissionRequest, rawAcpPermission?: ACPPermissionEvent | null): void {
    const state = this.getOrCreate(sessionId);
    state.pendingPermission = permission;
    state.rawAcpPermission = rawAcpPermission ?? null;
    this.onPermissionRequest?.(sessionId, permission);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get(sessionId: string): BackgroundSessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    // Clone messages to prevent external mutation of internal state
    return {
      messages: state.messages.map(m => ({ ...m })),
      isProcessing: state.isProcessing,
      isConnected: state.isConnected,
      sessionInfo: state.sessionInfo ? { ...state.sessionInfo } : null,
      totalCost: state.totalCost,
      pendingPermission: state.pendingPermission ? { ...state.pendingPermission } : null,
      rawAcpPermission: state.rawAcpPermission,
    };
  }

  consume(sessionId: string): BackgroundSessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    // Transfer ownership — no clone needed since we delete the store entry
    this.sessions.delete(sessionId);
    return {
      messages: state.messages,
      isProcessing: state.isProcessing,
      isConnected: state.isConnected,
      sessionInfo: state.sessionInfo,
      totalCost: state.totalCost,
      pendingPermission: state.pendingPermission,
      rawAcpPermission: state.rawAcpPermission,
    };
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Seed store with current state when switching away from a live session. */
  initFromState(sessionId: string, state: BackgroundSessionState): void {
    const parentToolMap = new Map<string, string>();
    // Clone messages to prevent external mutation from leaking in
    const messages = state.messages.map(m => ({ ...m }));
    for (const msg of messages) {
      if (msg.role === "tool_call" && msg.subagentSteps !== undefined) {
        const toolUseId = msg.id.replace(/^tool-/, "");
        parentToolMap.set(toolUseId, msg.id);
      }
      // Reconstruct Codex in-flight tool mappings from deterministic IDs
      if (msg.role === "tool_call" && msg.id.startsWith("codex-tool-") && !msg.toolResult && !msg.toolError) {
        const itemId = msg.id.replace("codex-tool-", "");
        parentToolMap.set(itemId, msg.id);
      }
    }

    // Reconstruct Codex plan text from existing plan-stream message
    const planStreamMsg = messages.find(m => m.id === "codex-plan-stream");
    const planInput = planStreamMsg?.toolInput as { plan?: string } | undefined;
    const codexPlanText = planInput?.plan ?? "";

    // Reconstruct plan turn counter from existing plan-update messages
    let codexPlanTurnCounter = 0;
    for (const msg of messages) {
      if (msg.id.startsWith("codex-plan-update-")) {
        const num = parseInt(msg.id.replace("codex-plan-update-", ""), 10);
        if (!isNaN(num) && num >= codexPlanTurnCounter) codexPlanTurnCounter = num;
      }
    }

    // Detect a mid-stream message so we can continue accumulating deltas
    const streamingMsg = messages.findLast(
      (m) => m.role === "assistant" && m.isStreaming,
    );

    this.sessions.set(sessionId, {
      messages,
      isProcessing: state.isProcessing,
      isConnected: state.isConnected,
      sessionInfo: state.sessionInfo ? { ...state.sessionInfo } : null,
      totalCost: state.totalCost,
      pendingPermission: state.pendingPermission ? { ...state.pendingPermission } : null,
      rawAcpPermission: state.rawAcpPermission ?? null,
      parentToolMap,
      currentStreamingMsgId: streamingMsg?.id ?? null,
      codexPlanText,
      codexPlanTurnCounter,
    });
  }

  /** Mark a session as disconnected (process exited). */
  markDisconnected(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.isConnected = false;
    // Dead process = dead permission — clear both
    state.pendingPermission = null;
    state.rawAcpPermission = null;
    if (state.isProcessing) {
      state.isProcessing = false;
      this.onProcessingChange?.(sessionId, false);
    }
    for (const msg of state.messages) {
      if (msg.isStreaming) {
        msg.isStreaming = false;
      }
    }
  }
}
