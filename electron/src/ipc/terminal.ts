import { BrowserWindow, ipcMain } from "electron";
import crypto from "crypto";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import { captureEvent } from "../lib/posthog";
import { reportError } from "../lib/error-utils";
import {
  appendTerminalHistory,
  EMPTY_TERMINAL_HISTORY,
  readTerminalHistory,
} from "../lib/terminal-history";
import type { TerminalHistoryState } from "../lib/terminal-history";

interface TerminalEntry {
  pty: {
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: () => void;
    onData: (cb: (data: string) => void) => void;
    onExit: (cb: (e: { exitCode: number }) => void) => void;
  };
  cols: number;
  rows: number;
  spaceId: string;
  createdAt: number;
  history: TerminalHistoryState;
  seq: number;
  exited: boolean;
  exitCode: number | null;
  destroyed: boolean;
}

export const terminals = new Map<string, TerminalEntry>();

let ptyModule: { spawn: (...args: unknown[]) => TerminalEntry["pty"] } | null = null;

function getPty() {
  if (!ptyModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyModule = require("node-pty");
  }
  return ptyModule!;
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("terminal:create", (_event, { cwd, cols, rows, spaceId }: { cwd?: string; cols?: number; rows?: number; spaceId?: string } = {}) => {
    try {
      const pty = getPty();
      const isWin = process.platform === "win32";
      const shellPath = isWin
        ? process.env.COMSPEC || "powershell.exe"
        : process.env.SHELL || "/bin/zsh";
      const terminalId = crypto.randomUUID();

      const ptyProcess = pty.spawn(shellPath, [], {
        name: "xterm-256color",
        cols: cols || 80,
        rows: rows || 24,
        cwd: cwd || (isWin ? process.env.USERPROFILE : process.env.HOME),
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });

      const entry: TerminalEntry = {
        pty: ptyProcess,
        cols: cols || 80,
        rows: rows || 24,
        spaceId: spaceId || "default",
        createdAt: Date.now(),
        history: EMPTY_TERMINAL_HISTORY,
        seq: 0,
        exited: false,
        exitCode: null,
        destroyed: false,
      };
      terminals.set(terminalId, entry);
      void captureEvent("terminal_created");

      ptyProcess.onData((data: string) => {
        if (entry.destroyed) return;
        entry.history = appendTerminalHistory(entry.history, data);
        entry.seq += 1;
        safeSend(getMainWindow, "terminal:data", { terminalId, data, seq: entry.seq });
      });

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        if (entry.destroyed) return;
        log("TERMINAL", `Terminal ${terminalId.slice(0, 8)} exited with code ${exitCode}`);
        entry.exited = true;
        entry.exitCode = exitCode;
        const exitNotice = "\r\n\x1b[2m[process exited]\x1b[0m\r\n";
        entry.history = appendTerminalHistory(entry.history, exitNotice);
        entry.seq += 1;
        safeSend(getMainWindow, "terminal:data", {
          terminalId,
          data: exitNotice,
          seq: entry.seq,
        });
        safeSend(getMainWindow, "terminal:exit", { terminalId, exitCode });
      });

      log("TERMINAL", `Created terminal ${terminalId.slice(0, 8)} shell=${shellPath} cwd=${cwd}`);
      return { terminalId };
    } catch (err) {
      const errMsg = reportError("TERMINAL_CREATE_ERR", err);
      return { error: errMsg };
    }
  });

  ipcMain.handle("terminal:write", (_event, { terminalId, data }: { terminalId: string; data: string }) => {
    const term = terminals.get(terminalId);
    if (!term) return { error: "Terminal not found" };
    if (term.exited) return { error: "Terminal has exited" };
    term.pty.write(data);
    return { ok: true };
  });

  ipcMain.handle("terminal:resize", (_event, { terminalId, cols, rows }: { terminalId: string; cols: number; rows: number }) => {
    const term = terminals.get(terminalId);
    if (!term) return { error: "Terminal not found" };
    if (term.exited) {
      term.cols = cols;
      term.rows = rows;
      return { ok: true };
    }
    try {
      term.pty.resize(cols, rows);
      term.cols = cols;
      term.rows = rows;
    } catch (err) {
      log("TERMINAL_ERR", `Resize failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { ok: true };
  });

  ipcMain.handle("terminal:snapshot", (_event, terminalId: string) => {
    const term = terminals.get(terminalId);
    if (!term) return { error: "Terminal not found" };
    return {
      output: readTerminalHistory(term.history),
      seq: term.seq,
      exited: term.exited,
      exitCode: term.exitCode,
    };
  });

  ipcMain.handle("terminal:list", () => {
    return {
      terminals: Array.from(terminals.entries())
        .map(([terminalId, term]) => ({
          terminalId,
          spaceId: term.spaceId,
          createdAt: term.createdAt,
          exited: term.exited,
          exitCode: term.exitCode,
        }))
        .sort((a, b) => a.createdAt - b.createdAt),
    };
  });

  ipcMain.handle("terminal:destroy", (_event, terminalId: string) => {
    const term = terminals.get(terminalId);
    if (term) {
      term.destroyed = true;
      if (!term.exited) term.pty.kill();
      terminals.delete(terminalId);
      log("TERMINAL", `Destroyed terminal ${terminalId.slice(0, 8)}`);
    }
    return { ok: true };
  });

  ipcMain.handle("terminal:destroy-space", (_event, spaceId: string) => {
    for (const [terminalId, term] of terminals.entries()) {
      if (term.spaceId !== spaceId) continue;
      term.destroyed = true;
      if (!term.exited) term.pty.kill();
      terminals.delete(terminalId);
      log("TERMINAL", `Destroyed terminal ${terminalId.slice(0, 8)} for space ${spaceId}`);
    }
    return { ok: true };
  });
}
