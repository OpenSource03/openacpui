import type { Dispatch, SetStateAction } from "react";
import type { UIMessage, SessionInfo, PermissionRequest, ContextUsage } from "../../src/types/ui";

/** Unified slash command representation — normalized from each engine's native format. */
export interface SlashCommand {
  /** The command string without leading slash (e.g., "compact", "help"). */
  name: string;
  /** Human-readable description shown in the autocomplete popup. */
  description: string;
  /** Placeholder hint for arguments (e.g., "<query>"), shown grayed after the command name. */
  argumentHint?: string;
  /** Engine-specific source type — used for execution routing. */
  source: "claude" | "acp" | "codex-skill" | "codex-app";
  /** For Codex skills: auto-fill text after the prefix. */
  defaultPrompt?: string;
  /** For Codex apps: the app slug for $app-slug prefix. */
  appSlug?: string;
  /** Icon URL for the autocomplete popup (Codex skills/apps may have icons). */
  iconUrl?: string;
}

/** Metadata snapshot for restoring a session from the background store. */
export interface SessionMeta {
  isProcessing: boolean;
  isConnected: boolean;
  sessionInfo: SessionInfo | null;
  totalCost: number;
  isCompacting?: boolean;
}

/** All supported engine identifiers. */
export type EngineId = "claude" | "acp" | "codex";

/**
 * Permission response behaviors.
 * - "allow": accept the tool call once
 * - "deny": reject the tool call
 * - "allowForSession": accept and allow similar calls for the rest of the session (Codex only)
 */
export type AppPermissionBehavior = "allow" | "deny" | "allowForSession";

/**
 * Canonical signature for responding to a tool permission prompt.
 * All engines must implement this — unused params can be ignored.
 */
export type RespondPermissionFn = (
  behavior: AppPermissionBehavior,
  updatedInput?: Record<string, unknown>,
  newPermissionMode?: string,
) => Promise<void>;

/**
 * The contract every engine hook must fulfill.
 * useSessionManager consumes this interface — it never touches engine internals directly.
 */
export interface EngineHookState {
  messages: UIMessage[];
  setMessages: Dispatch<SetStateAction<UIMessage[]>>;
  isProcessing: boolean;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
  isConnected: boolean;
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  sessionInfo: SessionInfo | null;
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>;
  totalCost: number;
  setTotalCost: Dispatch<SetStateAction<number>>;
  contextUsage: ContextUsage | null;
  isCompacting?: boolean;
  pendingPermission: PermissionRequest | null;
  respondPermission: RespondPermissionFn;
}
