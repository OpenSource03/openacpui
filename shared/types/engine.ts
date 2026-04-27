/** Unified slash command representation — normalized from each engine's native format. */
export interface SlashCommand {
  /** The command string without leading slash (e.g., "compact", "help"). */
  name: string;
  /** Human-readable description shown in the autocomplete popup. */
  description: string;
  /** Placeholder hint for arguments (e.g., "<query>"), shown grayed after the command name. */
  argumentHint?: string;
  /** Engine-specific source type — used for execution routing. */
  source: "claude" | "acp" | "codex-skill" | "codex-app" | "local";
  /** For Codex skills: auto-fill text after the prefix. */
  defaultPrompt?: string;
  /** For Codex apps: the app slug for $app-slug prefix. */
  appSlug?: string;
  /** Icon URL for the autocomplete popup (Codex skills/apps may have icons). */
  iconUrl?: string;
}

/** All supported engine identifiers. */
export type EngineId = "claude" | "acp" | "codex" | "cli";

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
 *
 * `updatedPermissions` is forwarded to the SDK to persist allow rules
 * to the chosen settings file (session / local / project / user).
 */
export type RespondPermissionFn = (
  behavior: AppPermissionBehavior,
  updatedInput?: Record<string, unknown>,
  newPermissionMode?: string,
  updatedPermissions?: unknown[],
) => Promise<void>;
