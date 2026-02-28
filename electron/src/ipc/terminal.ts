import { BrowserWindow, ipcMain } from "electron";
import crypto from "crypto";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";

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

      terminals.set(terminalId, { pty: ptyProcess, cols: cols || 80, rows: rows || 24, spaceId: spaceId || "default" });

      ptyProcess.onData((data: string) => {
        safeSend(getMainWindow, "terminal:data", { terminalId, data });
      });

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        log("TERMINAL", `Terminal ${terminalId.slice(0, 8)} exited with code ${exitCode}`);
        terminals.delete(terminalId);
        safeSend(getMainWindow, "terminal:exit", { terminalId, exitCode });
      });

      log("TERMINAL", `Created terminal ${terminalId.slice(0, 8)} shell=${shellPath} cwd=${cwd}`);
      return { terminalId };
    } catch (err) {
      log("TERMINAL_ERR", `Create failed: ${(err as Error).message}`);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("terminal:write", (_event, { terminalId, data }: { terminalId: string; data: string }) => {
    const term = terminals.get(terminalId);
    if (!term) return { error: "Terminal not found" };
    term.pty.write(data);
    return { ok: true };
  });

  ipcMain.handle("terminal:resize", (_event, { terminalId, cols, rows }: { terminalId: string; cols: number; rows: number }) => {
    const term = terminals.get(terminalId);
    if (!term) return { error: "Terminal not found" };
    try {
      term.pty.resize(cols, rows);
      term.cols = cols;
      term.rows = rows;
    } catch (err) {
      log("TERMINAL_ERR", `Resize failed: ${(err as Error).message}`);
    }
    return { ok: true };
  });

  ipcMain.handle("terminal:destroy", (_event, terminalId: string) => {
    const term = terminals.get(terminalId);
    if (term) {
      term.pty.kill();
      terminals.delete(terminalId);
      log("TERMINAL", `Destroyed terminal ${terminalId.slice(0, 8)}`);
    }
    return { ok: true };
  });

  ipcMain.handle("terminal:destroy-space", (_event, spaceId: string) => {
    for (const [terminalId, term] of terminals.entries()) {
      if (term.spaceId !== spaceId) continue;
      term.pty.kill();
      terminals.delete(terminalId);
      log("TERMINAL", `Destroyed terminal ${terminalId.slice(0, 8)} for space ${spaceId}`);
    }
    return { ok: true };
  });
}
