/**
 * Type stubs for the CLI engine (Track A of `docs/plans/cli-mode.md`).
 *
 * The CLI engine drives Claude sessions by spawning the official `claude`
 * binary in a pty and rendering its TUI directly via xterm.js — fundamentally
 * different from the SDK / ACP / Codex engines which consume structured JSON
 * event streams.
 *
 * Nothing in this file is wired up yet. It's a contract document checked in
 * ahead of implementation so Phase 1 has a clear API target and we can review
 * the surface before code lands.
 *
 * Ownership boundary:
 *
 *   electron/src/ipc/cli-sessions.ts  ←─ IPC handlers, pty lifecycle, fs reads
 *   src/hooks/useCliSession.ts        ←─ React state mirror per active session
 *   src/components/cli/CliChatPanel.tsx ─ full-screen xterm chat surface
 */

/**
 * Spawn options for `cli:start`. All fields except `cwd` are optional and map
 * directly onto `claude` CLI flags so we can stay forward-compatible with
 * future flag additions without adding new IPC verbs.
 */
export interface CliStartOptions {
  /** Working directory the CLI will see — drives prompt context, git, MCP discovery. */
  cwd: string;
  /**
   * UUID to pass via `--session-id`. Use a fresh uuid for new sessions; pass
   * the same id again later via `cli:resume` to continue the conversation.
   */
  sessionId: string;
  /** Display name shown in the CLI prompt and `/resume` picker (`--name`). */
  name?: string;
  /** Initial pty geometry. Defaults to 80x24 on the main side if omitted. */
  cols?: number;
  rows?: number;
  /**
   * Permission mode forwarded as `--permission-mode <mode>`. CLI accepts
   * "default" | "acceptEdits" | "auto" | "bypassPermissions" | "dontAsk" |
   * "plan" — keep this `string` so we don't lock ourselves to a particular
   * CLI version's vocabulary.
   */
  permissionMode?: string;
  /** Forwarded as `--model`. */
  model?: string;
  /** Forwarded as `--add-dir <path>` (one per entry). */
  addDirs?: string[];
  /** Forwarded as `--mcp-config <file>` (one per entry). */
  mcpConfigs?: string[];
}

/**
 * Resume an existing CLI session by uuid. Mirrors `CliStartOptions` for the
 * settings-bearing fields so the renderer can re-apply the user's current
 * model / permission / mcp choices when reopening an old session — CLI
 * accepts these flags with `--resume` and we'd otherwise lose user intent
 * across resumes.
 */
export interface CliResumeOptions {
  /** UUID of the session to resume — must already exist on disk. */
  sessionId: string;
  /** New cwd for the resumed session. Defaults to the original on the CLI side. */
  cwd?: string;
  /**
   * If true, spawn with `--fork-session` so a new id is allocated and the
   * original transcript is preserved unchanged. Use this when the user wants
   * to "branch" off an old conversation without polluting it.
   *
   * The forked sessionId is **not known at spawn time** — CLI mints it,
   * writes it to its session log, and the main process discovers it via the
   * `session_identified` event below. Renderer should treat the value
   * returned by `cli:resume` as provisional when `fork=true`.
   */
  fork?: boolean;
  /** Re-apply current settings on resume (CLI accepts these with --resume). */
  name?: string;
  permissionMode?: string;
  model?: string;
  addDirs?: string[];
  mcpConfigs?: string[];
  cols?: number;
  rows?: number;
}

/**
 * Return shape of `cli:start` and `cli:resume`.
 *
 * `cli:start`/`cli:resume` **resolve** rather than reject on spawn failure
 * (e.g. missing `claude` binary, EACCES, invalid cwd) so the renderer can
 * route the error into the same UI as runtime exits without separate
 * try/catch + event handling. On success, `terminalId` and `pid` are both
 * present. On failure, both are absent and `error` is populated.
 *
 * IPC reject is reserved for genuinely exceptional conditions like
 * preload-bridge tear-down — anything user-visible flows through `error`.
 */
export type CliStartResult =
  | {
      ok: true;
      /** PTY identifier — same id space as the existing terminal handlers. */
      terminalId: string;
      /**
       * Provisional session id reported at spawn. For `cli:start`, equals
       * the requested `sessionId`. For `cli:resume({ fork: true })`, this
       * is the **input** id; the real forked id arrives later via the
       * `session_identified` event. UI should listen for that event
       * before routing further IPC at the new id.
       */
      sessionId: string;
      /** PID of the spawned `claude` process — for diagnostics + force-kill. */
      pid: number;
    }
  | {
      ok: false;
      /** Same input sessionId so the UI can locate the row that failed. */
      sessionId: string;
      /** Why spawn / resume failed. */
      error: string;
    };

/**
 * Resolved entry shape passed to `cli:archive`. Required fields drive the
 * file move; `fullPath` is preferred (no hash guessing) but a (sessionId,
 * cwd) pair lets main derive the canonical project dir via its own
 * normalization rules — keeps renderer and main from drifting on hash
 * encoding details.
 */
export interface CliArchiveTarget {
  sessionId: string;
  /** Absolute path of the working directory the session was started in. */
  cwd: string;
  fullPath?: string;
}

/**
 * Live-session lookup. Lets the renderer recover `sessionId -> terminalId/pid`
 * mappings on session switch / window reload without spawning a duplicate.
 *
 * Existing `terminal:list` covers byte-buffer reattach but doesn't carry the
 * CLI sessionId mapping — `cli:listLive` is the authoritative source for
 * "which CLI sessions are alive in this Harnss instance right now."
 */
export interface CliLiveSession {
  sessionId: string;
  terminalId: string;
  pid: number;
  cwd: string;
  startedAt: number;
}

/**
 * Lifecycle event the renderer subscribes to via `cli:event`. Keep this
 * minimal — the rich data flows through the pty as raw bytes; this channel
 * is just for state transitions xterm can't observe on its own.
 */
export type CliSessionEvent =
  | { type: "spawned"; terminalId: string; sessionId: string; pid: number }
  | { type: "resumed"; terminalId: string; sessionId: string; pid: number }
  /**
   * Fired once main has discovered the **real** sessionId after a
   * `--fork-session` resume. The renderer should rekey its CliSessionState
   * map from the provisional id to `sessionId` and update any derived
   * structures (sidebar entry, draft state, etc.).
   */
  | { type: "session_identified"; terminalId: string; provisionalSessionId: string; sessionId: string }
  /**
   * Spawn / resume failure detected after the start IPC already returned
   * (e.g. CLI immediately exited with auth error). For failures detected
   * synchronously during the syscall, `cli:start` resolves with
   * `{ ok: false, error }` instead — events here are for **post-spawn**
   * problems. `terminalId` and `pid` may be absent if the pty never came
   * up cleanly.
   */
  | { type: "spawn_failed"; terminalId?: string; pid?: number; sessionId: string; error: string }
  | { type: "resume_failed"; terminalId?: string; pid?: number; sessionId: string; error: string }
  /**
   * CLI process exited normally. The renderer should mark the session as
   * ended, keep the xterm scrollback for review, and offer "Restart" /
   * "Fork" / "Close tab" actions. `signal` is a string ("SIGTERM", etc.)
   * to avoid leaking Node's `NodeJS.Signals` type into the renderer.
   */
  | { type: "exited"; terminalId: string; sessionId: string; code: number | null; signal: string | null };

/**
 * Renderer-side mirror of a live CLI session. One per active sessionId.
 * Mostly thin since the actual content lives in the pty + xterm buffer.
 */
export interface CliSessionState {
  sessionId: string;
  terminalId: string;
  pid: number | null;
  status: "starting" | "running" | "exited" | "error";
  exitCode: number | null;
  /** Populated when status="error" so the UI can show what went wrong. */
  errorMessage: string | null;
  /**
   * Whether the CLI has finished its first prompt — set on first non-empty
   * stdout chunk after spawn. Drives the "still loading" affordance in the
   * chat surface.
   */
  ready: boolean;
}
