import { BrowserWindow, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import { reportError } from "../lib/error-utils";
import {
  appendTerminalHistory,
  EMPTY_TERMINAL_HISTORY,
} from "../lib/terminal-history";
import { terminals } from "./terminal";
import type {
  CliStartOptions,
  CliResumeOptions,
  CliStartResult,
  CliLiveSession,
  CliSessionEvent,
  CliArchiveTarget,
} from "@shared/types/cli-engine";

/**
 * Discover the new session id minted by `claude --fork-session`. Polls
 * the cwd's project dir as the source of truth (catches files created
 * during the gap between snapshot and watch attach, plus survives
 * coalesced fs.watch events) and uses fs.watch only as a wake-up to
 * shorten poll latency. Resolves with the discovered id or null on
 * timeout.
 */
function watchForkSessionId(
  cwd: string,
  preExistingIds: Set<string>,
  timeoutMs = 30_000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const dir = path.join(os.homedir(), ".claude", "projects", cwd.replace(/\//g, "-"));
    let settled = false;
    let watcher: fs.FSWatcher | null = null;
    let pollInterval: NodeJS.Timeout | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const finish = (id: string | null) => {
      if (settled) return;
      settled = true;
      if (pollInterval) clearInterval(pollInterval);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try { watcher?.close(); } catch { /* ignore */ }
      resolve(id);
    };

    const scan = () => {
      if (settled) return;
      try {
        if (!fs.existsSync(dir)) return;
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith(".jsonl")) continue;
          const id = f.slice(0, -6);
          if (preExistingIds.has(id)) continue;
          finish(id);
          return;
        }
      } catch {
        /* permission / transient error — try again next tick */
      }
    };

    // Polling is the source of truth — fires every 500ms, picks up
    // anything fs.watch missed.
    pollInterval = setInterval(scan, 500);
    // fs.watch wakes us up sooner when the dir exists; failure to
    // attach (dir missing, EACCES) is fine because polling still
    // covers it.
    try {
      if (fs.existsSync(dir)) {
        watcher = fs.watch(dir, { persistent: false }, scan);
      }
    } catch { /* polling will handle it */ }
    // Initial scan — covers the race where CLI wrote the file before
    // we even got here.
    scan();
    timeoutHandle = setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * CLI engine — spawns the official `claude` binary in a pty per session and
 * surfaces lifecycle events to the renderer. Bytes flow through the existing
 * `terminal:data` channel by registering each spawned pty into the same
 * `terminals` map used by `terminal:create`. This keeps the renderer's xterm
 * wiring uniform across "user terminal" tabs and CLI-engine chats.
 *
 * State that lives in this module (not in `terminals`):
 *
 *   liveSessions: sessionId → CliLiveSession
 *
 * because the existing terminal map is keyed by terminalId and doesn't carry
 * CLI-specific metadata (sessionId, cwd, startedAt). On window reload the
 * renderer asks `cli:listLive` to recover this mapping.
 */
interface LiveCliSession extends CliLiveSession {
  /** The provisional id (= input id) until session_identified upgrades it. */
  provisionalSessionId: string;
}

const liveSessions = new Map<string, LiveCliSession>();

let ptyModule: { spawn: (file: string, args: string[], options: unknown) => unknown } | null = null;

function getPty() {
  if (!ptyModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyModule = require("node-pty");
  }
  return ptyModule!;
}

/**
 * Resolve the path to the `claude` binary. Honors $CLAUDE_PATH so power users
 * can pin a non-default install (e.g. a beta channel). Otherwise relies on
 * PATH — the spawn will surface a clear error if the binary isn't found.
 */
function resolveClaudeBinary(): string {
  if (process.env.CLAUDE_PATH && process.env.CLAUDE_PATH.trim()) {
    return process.env.CLAUDE_PATH.trim();
  }
  return "claude";
}

/**
 * Build the argv for `claude --session-id <uuid> ...` from a typed option
 * bag. Order matches the documented CLI invocation in
 * docs/plans/cli-engine-api.md.
 */
function buildStartArgs(opts: CliStartOptions): string[] {
  // We pass `--add-dir <cwd>` so CLI gets explicit context-base parity with
  // the contract. The pty `cwd` already sets process working dir, but CLI
  // distinguishes process cwd from "context dirs", so include both.
  const args: string[] = ["--session-id", opts.sessionId, "--add-dir", opts.cwd];
  if (opts.name) args.push("--name", opts.name);
  if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);
  if (opts.model) args.push("--model", opts.model);
  for (const dir of opts.addDirs ?? []) args.push("--add-dir", dir);
  for (const cfg of opts.mcpConfigs ?? []) args.push("--mcp-config", cfg);
  return args;
}

function buildResumeArgs(opts: CliResumeOptions): string[] {
  const args: string[] = ["--resume", opts.sessionId];
  if (opts.fork) args.push("--fork-session");
  if (opts.name) args.push("--name", opts.name);
  if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);
  if (opts.model) args.push("--model", opts.model);
  for (const dir of opts.addDirs ?? []) args.push("--add-dir", dir);
  for (const cfg of opts.mcpConfigs ?? []) args.push("--mcp-config", cfg);
  return args;
}

interface PtySpawnedShape {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void;
  pid?: number;
}

/**
 * Wire a freshly-spawned CLI pty into the existing `terminals` map so the
 * renderer's xterm reconnects through `terminal:data` like any other pty.
 * Caller pre-allocates the terminalId so it can also pre-register it in
 * the liveSessions map ahead of any exit-handler racing.
 */
function adoptCliPty(
  ptyProcess: PtySpawnedShape,
  sessionId: string,
  terminalId: string,
  cols: number,
  rows: number,
  getMainWindow: () => BrowserWindow | null,
  onExit: (code: number | null, signal: string | null) => void,
): void {
  const entry = {
    pty: ptyProcess,
    cols,
    rows,
    sessionId,
    createdAt: Date.now(),
    history: EMPTY_TERMINAL_HISTORY,
    seq: 0,
    exited: false,
    exitCode: null as number | null,
    destroyed: false,
  };
  terminals.set(terminalId, entry);

  ptyProcess.onData((data: string) => {
    if (entry.destroyed) return;
    entry.history = appendTerminalHistory(entry.history, data);
    entry.seq += 1;
    safeSend(getMainWindow, "terminal:data", { terminalId, data, seq: entry.seq });
  });

  ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    if (entry.destroyed) return;
    entry.exited = true;
    entry.exitCode = exitCode;
    const exitNotice = `\r\n\x1b[2m[claude exited code=${exitCode}]\x1b[0m\r\n`;
    entry.history = appendTerminalHistory(entry.history, exitNotice);
    entry.seq += 1;
    safeSend(getMainWindow, "terminal:data", {
      terminalId,
      data: exitNotice,
      seq: entry.seq,
    });
    safeSend(getMainWindow, "terminal:exit", { terminalId, exitCode });
    // Map signal number → Node's canonical signal name (SIGTERM, SIGKILL,
    // …) via os.constants.signals. We can't synthesize "SIG{N}" — that's
    // not a real signal name and the renderer/UI layer might key off
    // standard names. Fall back to null when the number doesn't match a
    // known signal (rare, mostly clean exits with signal=0).
    let signalName: string | null = null;
    if (typeof signal === "number" && signal > 0) {
      const sigConsts = os.constants.signals as Record<string, number>;
      for (const [name, num] of Object.entries(sigConsts)) {
        if (num === signal) { signalName = name; break; }
      }
    }
    onExit(exitCode, signalName);
    setTimeout(() => {
      if (terminals.get(terminalId) === entry) terminals.delete(terminalId);
    }, 30_000);
  });
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("cli:start", async (_event, opts: CliStartOptions): Promise<CliStartResult> => {
    try {
      if (!opts || typeof opts.cwd !== "string" || typeof opts.sessionId !== "string") {
        return { ok: false, sessionId: opts?.sessionId ?? "", error: "cwd and sessionId are required" };
      }
      const pty = getPty();
      const cols = opts.cols ?? 80;
      const rows = opts.rows ?? 24;
      const args = buildStartArgs(opts);
      const claudePath = resolveClaudeBinary();

      let ptyProcess: PtySpawnedShape;
      try {
        ptyProcess = pty.spawn(claudePath, args, {
          name: "xterm-256color",
          cols,
          rows,
          cwd: opts.cwd,
          env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        }) as PtySpawnedShape;
      } catch (err) {
        // Spawn syscall failure (binary missing, EACCES, bad cwd) — return a
        // structured error instead of rejecting so the renderer can surface
        // a single error path for sync + async failures.
        const errMsg = err instanceof Error ? err.message : String(err);
        log("CLI", `cli:start spawn failed: ${errMsg}`);
        return { ok: false, sessionId: opts.sessionId, error: errMsg };
      }

      // Pre-register liveSessions before wiring the exit handler so that an
      // immediate exit (bad flag, auth error, missing model) cannot fire
      // onExit before the entry exists, which would otherwise leak a stale
      // live row when we set it below.
      const pid = ptyProcess.pid ?? -1;
      const terminalId = crypto.randomUUID();
      const live: LiveCliSession = {
        sessionId: opts.sessionId,
        provisionalSessionId: opts.sessionId,
        terminalId,
        pid,
        cwd: opts.cwd,
        startedAt: Date.now(),
      };
      liveSessions.set(opts.sessionId, live);

      adoptCliPty(ptyProcess, opts.sessionId, terminalId, cols, rows, getMainWindow, (code, signal) => {
        const current = liveSessions.get(opts.sessionId);
        if (current && current.terminalId === terminalId) liveSessions.delete(opts.sessionId);
        const evt: CliSessionEvent = {
          type: "exited",
          terminalId,
          sessionId: opts.sessionId,
          code,
          signal,
        };
        safeSend(getMainWindow, "cli:event", evt);
      });

      log("CLI", `cli:start session=${opts.sessionId.slice(0, 8)} pid=${pid} cwd=${opts.cwd}`);
      const evt: CliSessionEvent = { type: "spawned", terminalId, sessionId: opts.sessionId, pid };
      safeSend(getMainWindow, "cli:event", evt);

      return { ok: true, terminalId, sessionId: opts.sessionId, pid };
    } catch (err) {
      const errMsg = reportError("CLI:START_ERR", err);
      return { ok: false, sessionId: opts?.sessionId ?? "", error: errMsg };
    }
  });

  ipcMain.handle("cli:resume", async (_event, opts: CliResumeOptions): Promise<CliStartResult> => {
    try {
      if (!opts || typeof opts.sessionId !== "string") {
        return { ok: false, sessionId: opts?.sessionId ?? "", error: "sessionId is required" };
      }
      // Idempotency: if this sessionId already has a live pty in this
      // Harnss process, reuse it rather than spawning a second
      // `claude --resume` (which would fight over the same JSONL file
      // and orphan the previous pty). Renderer can detect "already
      // attached" by comparing the returned terminalId to its current
      // state.
      const existing = liveSessions.get(opts.sessionId);
      if (existing && terminals.get(existing.terminalId) && !terminals.get(existing.terminalId)?.exited) {
        log("CLI", `cli:resume reusing existing live pty for ${opts.sessionId.slice(0, 8)}`);
        return {
          ok: true,
          terminalId: existing.terminalId,
          sessionId: opts.sessionId,
          pid: existing.pid,
        };
      }
      const pty = getPty();
      const cols = opts.cols ?? 80;
      const rows = opts.rows ?? 24;
      const args = buildResumeArgs(opts);
      const claudePath = resolveClaudeBinary();
      const cwd = opts.cwd ?? process.env.HOME ?? "/";

      let ptyProcess: PtySpawnedShape;
      try {
        ptyProcess = pty.spawn(claudePath, args, {
          name: "xterm-256color",
          cols,
          rows,
          cwd,
          env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        }) as PtySpawnedShape;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return { ok: false, sessionId: opts.sessionId, error: errMsg };
      }

      const pid = ptyProcess.pid ?? -1;
      const terminalId = crypto.randomUUID();
      const live: LiveCliSession = {
        sessionId: opts.sessionId,
        provisionalSessionId: opts.sessionId,
        terminalId,
        pid,
        cwd,
        startedAt: Date.now(),
      };
      liveSessions.set(opts.sessionId, live);

      adoptCliPty(ptyProcess, opts.sessionId, terminalId, cols, rows, getMainWindow, (code, signal) => {
        const current = liveSessions.get(opts.sessionId);
        if (current && current.terminalId === terminalId) liveSessions.delete(opts.sessionId);
        const evt: CliSessionEvent = {
          type: "exited",
          terminalId,
          sessionId: opts.sessionId,
          code,
          signal,
        };
        safeSend(getMainWindow, "cli:event", evt);
      });

      log("CLI", `cli:resume session=${opts.sessionId.slice(0, 8)} pid=${pid} fork=${opts.fork ?? false}`);
      const evt: CliSessionEvent = { type: "resumed", terminalId, sessionId: opts.sessionId, pid };
      safeSend(getMainWindow, "cli:event", evt);

      // For --fork-session, the new session id is minted asynchronously by
      // CLI. We don't try to discover it here — Phase 1 punts on this until
      // we observe how CLI 2.1.x behaves in practice (Phase 0 probe).
      // Renderer treats the returned sessionId as provisional when fork=true.

      return { ok: true, terminalId, sessionId: opts.sessionId, pid };
    } catch (err) {
      const errMsg = reportError("CLI:RESUME_ERR", err);
      return { ok: false, sessionId: opts?.sessionId ?? "", error: errMsg };
    }
  });

  ipcMain.handle("cli:stop", async (_event, sessionId: string) => {
    try {
      const live = liveSessions.get(sessionId);
      if (!live) return { ok: true };
      const entry = terminals.get(live.terminalId);
      if (entry && !entry.exited) {
        try {
          entry.pty.kill();
        } catch {
          /* already dead */
        }
      }
      liveSessions.delete(sessionId);
      return { ok: true };
    } catch (err) {
      reportError("CLI:STOP_ERR", err);
      return { ok: false };
    }
  });

  ipcMain.handle("cli:list-live", async (): Promise<CliLiveSession[]> => {
    const out: CliLiveSession[] = [];
    for (const live of liveSessions.values()) {
      out.push({
        sessionId: live.sessionId,
        terminalId: live.terminalId,
        pid: live.pid,
        cwd: live.cwd,
        startedAt: live.startedAt,
      });
    }
    return out;
  });

  ipcMain.handle("cli:get-live", async (_event, sessionId: string): Promise<CliLiveSession | null> => {
    const live = liveSessions.get(sessionId);
    if (!live) return null;
    return {
      sessionId: live.sessionId,
      terminalId: live.terminalId,
      pid: live.pid,
      cwd: live.cwd,
      startedAt: live.startedAt,
    };
  });

  /**
   * Fork an existing session: spawn `claude --resume <orig> --fork-session`
   * which prompts CLI to clone the transcript under a fresh session id it
   * mints itself. We can't know the new id at spawn time, so the renderer
   * gets a provisional id back; main fs.watches the cwd's project dir for
   * the new .jsonl file and emits `session_identified` once the real id
   * shows up (typically after the first user turn).
   *
   * The original live session (if any) is untouched — fork is non-
   * destructive by design.
   */
  ipcMain.handle("cli:fork", async (_event, opts: { originalSessionId: string; cwd: string; cols?: number; rows?: number }): Promise<CliStartResult> => {
    try {
      if (!opts?.originalSessionId || !opts?.cwd) {
        return { ok: false, sessionId: opts?.originalSessionId ?? "", error: "originalSessionId and cwd required" };
      }
      const pty = getPty();
      const cols = opts.cols ?? 80;
      const rows = opts.rows ?? 24;
      const args = ["--resume", opts.originalSessionId, "--fork-session", "--add-dir", opts.cwd];
      const claudePath = resolveClaudeBinary();

      // Snapshot the current set of session ids in this cwd's project dir
      // so we can spot the new file once CLI writes it.
      const projectDir = path.join(os.homedir(), ".claude", "projects", opts.cwd.replace(/\//g, "-"));
      const preExistingIds = new Set<string>();
      try {
        if (fs.existsSync(projectDir)) {
          for (const f of fs.readdirSync(projectDir)) {
            if (f.endsWith(".jsonl")) preExistingIds.add(f.slice(0, -6));
          }
        }
      } catch { /* fine — empty set means we accept any id we see */ }

      let ptyProcess: PtySpawnedShape;
      try {
        ptyProcess = pty.spawn(claudePath, args, {
          name: "xterm-256color",
          cols,
          rows,
          cwd: opts.cwd,
          env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        }) as PtySpawnedShape;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return { ok: false, sessionId: opts.originalSessionId, error: errMsg };
      }

      // Use a temporary id while we wait for CLI to mint the real one.
      // Renderer keys its CliSessionState off this; session_identified
      // event triggers the rekey to the real id once watcher fires.
      const provisionalId = `fork-pending-${crypto.randomUUID()}`;
      const pid = ptyProcess.pid ?? -1;
      const terminalId = crypto.randomUUID();

      const live: LiveCliSession = {
        sessionId: provisionalId,
        provisionalSessionId: provisionalId,
        terminalId,
        pid,
        cwd: opts.cwd,
        startedAt: Date.now(),
      };
      liveSessions.set(provisionalId, live);

      adoptCliPty(ptyProcess, provisionalId, terminalId, cols, rows, getMainWindow, (code, signal) => {
        // Resolve the *current* sessionId off the mutable live entry.
        // session_identified may have rekey'd the entry from
        // provisionalId → realId between spawn and exit; closing over
        // provisionalId would otherwise emit a dead-letter exit event
        // and leak the live entry under realId.
        const currentId = live.sessionId;
        const current = liveSessions.get(currentId);
        if (current && current.terminalId === terminalId) liveSessions.delete(currentId);
        const evt: CliSessionEvent = {
          type: "exited",
          terminalId,
          sessionId: currentId,
          code,
          signal,
        };
        safeSend(getMainWindow, "cli:event", evt);
      });

      // Kick off the discovery watcher async — don't block the IPC.
      void (async () => {
        const realId = await watchForkSessionId(opts.cwd, preExistingIds);
        if (!realId) {
          log("CLI", `cli:fork: real id discovery timed out for provisional=${provisionalId.slice(0, 12)}`);
          return;
        }
        // Rekey liveSessions: the entry now lives under realId so
        // subsequent IPC (cli:get-live, cli:stop) addressed at realId
        // resolves correctly. Provisional id stays as a dead-letter so
        // any in-flight events for it don't crash.
        const entry = liveSessions.get(provisionalId);
        if (entry && !liveSessions.has(realId)) {
          entry.sessionId = realId;
          liveSessions.delete(provisionalId);
          liveSessions.set(realId, entry);
        }
        const evt: CliSessionEvent = {
          type: "session_identified",
          terminalId,
          provisionalSessionId: provisionalId,
          sessionId: realId,
        };
        safeSend(getMainWindow, "cli:event", evt);
        log("CLI", `cli:fork identified ${realId.slice(0, 8)} from provisional=${provisionalId.slice(0, 12)}`);
      })();

      log("CLI", `cli:fork from=${opts.originalSessionId.slice(0, 8)} provisional=${provisionalId.slice(0, 12)} pid=${pid}`);
      const evt: CliSessionEvent = { type: "resumed", terminalId, sessionId: provisionalId, pid };
      safeSend(getMainWindow, "cli:event", evt);

      return { ok: true, terminalId, sessionId: provisionalId, pid };
    } catch (err) {
      const errMsg = reportError("CLI:FORK_ERR", err);
      return { ok: false, sessionId: opts?.originalSessionId ?? "", error: errMsg };
    }
  });

  ipcMain.handle("cli:archive", async (_event, target: CliArchiveTarget): Promise<{ ok: boolean; error?: string }> => {
    try {
      if (!target?.sessionId || !target?.cwd) {
        return { ok: false, error: "sessionId and cwd required" };
      }
      // Untrusted-input guards before composing any filesystem path:
      //   - cwd must be an absolute path (no relative escapes)
      //   - sessionId must be UUID-shaped (CLI's own format)
      // Main derives the cwdHash itself instead of trusting the renderer
      // — single source of truth for path encoding.
      if (!path.isAbsolute(target.cwd)) {
        return { ok: false, error: "cwd must be absolute" };
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.sessionId)) {
        return { ok: false, error: "Invalid sessionId" };
      }
      const cwdHash = target.cwd.replace(/\/+$/, "").replace(/\//g, "-");
      // Phase 1 ships archive as a rename-only operation pending verification
      // of how CLI 2.1.x rebuilds sessions-index.json. See cli-engine-api.md
      // for the deferred decision.
      const projectsRoot = path.resolve(path.join(os.homedir(), ".claude", "projects"));
      const root = path.join(projectsRoot, cwdHash);
      const src = target.fullPath ?? path.join(root, `${target.sessionId}.jsonl`);
      const archiveDir = path.join(root, ".archived");
      let dst = path.join(archiveDir, `${target.sessionId}.jsonl`);

      // Validate every resolved path is inside ~/.claude/projects/{cwdHash}/.
      // path.relative returns a string starting with "../" when the
      // candidate is outside; checking that is more robust than startsWith.
      const isInside = (candidate: string, parent: string) => {
        const rel = path.relative(parent, path.resolve(candidate));
        return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
      };
      const resolvedRoot = path.resolve(root);
      if (
        !isInside(src, resolvedRoot) ||
        !isInside(dst, resolvedRoot) ||
        !isInside(resolvedRoot, projectsRoot)
      ) {
        return { ok: false, error: "Refusing to archive outside the cwd directory" };
      }

      if (!fs.existsSync(src)) {
        return { ok: false, error: `Source not found: ${src}` };
      }

      await fs.promises.mkdir(archiveDir, { recursive: true });
      // Don't clobber existing archived transcripts on re-archive races —
      // append a numeric suffix until a free name is found. A repeated
      // archive call shouldn't silently destroy a previously archived
      // copy.
      if (fs.existsSync(dst)) {
        let n = 1;
        while (fs.existsSync(path.join(archiveDir, `${target.sessionId}.${n}.jsonl`))) n++;
        dst = path.join(archiveDir, `${target.sessionId}.${n}.jsonl`);
      }
      await fs.promises.rename(src, dst);
      log("CLI", `cli:archive moved ${target.sessionId.slice(0, 8)} → ${path.relative(root, dst)}`);
      return { ok: true };
    } catch (err) {
      const errMsg = reportError("CLI:ARCHIVE_ERR", err);
      return { ok: false, error: errMsg };
    }
  });

  log("CLI", "cli-sessions IPC handlers registered");
}
