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

  ipcMain.handle("cli:archive", async (_event, target: CliArchiveTarget): Promise<{ ok: boolean; error?: string }> => {
    try {
      if (!target?.sessionId || !target?.cwdHash) {
        return { ok: false, error: "sessionId and cwdHash required" };
      }
      // Untrusted-input guards before composing any filesystem path:
      //   - cwdHash must be a single path segment (no separators, no '..')
      //   - sessionId must be UUID-shaped (CLI's own format)
      // Either of these slipping past would let the renderer compose paths
      // outside ~/.claude/projects.
      if (
        target.cwdHash.includes("/") ||
        target.cwdHash.includes("\\") ||
        target.cwdHash === "." ||
        target.cwdHash === ".." ||
        target.cwdHash.startsWith(".")
      ) {
        return { ok: false, error: "Invalid cwdHash" };
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.sessionId)) {
        return { ok: false, error: "Invalid sessionId" };
      }
      // Phase 1 ships archive as a rename-only operation pending verification
      // of how CLI 2.1.x rebuilds sessions-index.json. See cli-engine-api.md
      // for the deferred decision.
      const projectsRoot = path.resolve(path.join(os.homedir(), ".claude", "projects"));
      const root = path.join(projectsRoot, target.cwdHash);
      const src = target.fullPath ?? path.join(root, `${target.sessionId}.jsonl`);
      const archiveDir = path.join(root, ".archived");
      const dst = path.join(archiveDir, `${target.sessionId}.jsonl`);

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
      await fs.promises.rename(src, dst);
      log("CLI", `cli:archive moved ${target.sessionId.slice(0, 8)} → .archived/`);
      return { ok: true };
    } catch (err) {
      const errMsg = reportError("CLI:ARCHIVE_ERR", err);
      return { ok: false, error: errMsg };
    }
  });

  log("CLI", "cli-sessions IPC handlers registered");
}
