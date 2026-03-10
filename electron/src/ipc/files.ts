import { ipcMain, shell } from "electron";
import type { BrowserWindow } from "electron";
import { execFile } from "child_process";
import path from "path";
import fs from "fs";
import { log } from "../lib/logger";
import { ALWAYS_SKIP } from "../lib/git-exec";
import { getAppSetting } from "../lib/app-settings";
import { captureEvent } from "../lib/posthog";
import { reportError } from "../lib/error-utils";
import { safeSend } from "../lib/safe-send";

function listFilesGit(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.split("\n").filter((f) => f.trim()).sort());
      },
    );
  });
}

function parseGitignore(gitignorePath: string): string[] {
  try {
    if (!fs.existsSync(gitignorePath)) return [];
    return fs.readFileSync(gitignorePath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

function isIgnoredByPatterns(name: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    const clean = pat.replace(/\/$/, "");
    if (name === clean) return true;
    if (clean.includes("*")) {
      const regex = new RegExp("^" + clean.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      if (regex.test(name)) return true;
    }
  }
  return false;
}

function listFilesWalk(cwd: string, maxFiles = 10000): string[] {
  const files: string[] = [];
  const queue: string[] = [""];

  while (queue.length > 0 && files.length < maxFiles) {
    const rel = queue.shift()!;
    const abs = rel ? path.join(cwd, rel) : cwd;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }

    const localIgnore = parseGitignore(path.join(abs, ".gitignore"));

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name)) continue;
        if (isIgnoredByPatterns(entry.name, localIgnore)) continue;
        queue.push(entryRel);
      } else if (entry.isFile()) {
        if (isIgnoredByPatterns(entry.name, localIgnore)) continue;
        files.push(entryRel);
      }
    }
  }

  return files.sort();
}

async function listProjectFiles(cwd: string): Promise<string[]> {
  try {
    return await listFilesGit(cwd);
  } catch {
    log("FILES:LIST", "Not a git repo, falling back to filesystem walk");
    return listFilesWalk(cwd);
  }
}

/** Dirs to skip in the full filesystem walk (VCS internals + massive dependency dirs). */
const EXPLORER_SKIP = new Set([".git", ".hg", ".svn", "node_modules"]);

interface ProjectWatchState {
  refCount: number;
  watchers: Map<string, fs.FSWatcher>;
  notifyTimer?: ReturnType<typeof setTimeout>;
  syncTimer?: ReturnType<typeof setTimeout>;
}

const projectWatchers = new Map<string, ProjectWatchState>();

function collectWatchDirs(cwd: string, maxDirs = 5000): string[] {
  const dirs = [cwd];
  const queue = [cwd];

  while (queue.length > 0 && dirs.length < maxDirs) {
    const dir = queue.shift()!;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || EXPLORER_SKIP.has(entry.name)) continue;
      const childDir = path.join(dir, entry.name);
      dirs.push(childDir);
      queue.push(childDir);
      if (dirs.length >= maxDirs) break;
    }
  }

  return dirs;
}

function closeProjectWatchers(state: ProjectWatchState): void {
  if (state.notifyTimer) clearTimeout(state.notifyTimer);
  if (state.syncTimer) clearTimeout(state.syncTimer);
  for (const watcher of state.watchers.values()) {
    watcher.close();
  }
  state.watchers.clear();
}

function scheduleWatcherNotify(
  cwd: string,
  getMainWindow: () => BrowserWindow | null,
): void {
  const state = projectWatchers.get(cwd);
  if (!state || state.notifyTimer) return;

  state.notifyTimer = setTimeout(() => {
    const current = projectWatchers.get(cwd);
    if (!current) return;
    current.notifyTimer = undefined;
    safeSend(getMainWindow, "files:changed", { cwd });
  }, 150);
}

function syncProjectWatchers(
  cwd: string,
  getMainWindow: () => BrowserWindow | null,
): void {
  const state = projectWatchers.get(cwd);
  if (!state) return;

  const nextDirs = new Set(collectWatchDirs(cwd));

  for (const [dir, watcher] of state.watchers) {
    if (nextDirs.has(dir)) continue;
    watcher.close();
    state.watchers.delete(dir);
  }

  for (const dir of nextDirs) {
    if (state.watchers.has(dir)) continue;
    try {
      const watcher = fs.watch(dir, { persistent: false }, () => {
        scheduleWatcherNotify(cwd, getMainWindow);
        scheduleWatcherSync(cwd, getMainWindow);
      });
      watcher.on("error", () => {
        scheduleWatcherSync(cwd, getMainWindow);
      });
      state.watchers.set(dir, watcher);
    } catch {
      // Ignore transient watch failures; the next sync will retry.
    }
  }
}

function scheduleWatcherSync(
  cwd: string,
  getMainWindow: () => BrowserWindow | null,
): void {
  const state = projectWatchers.get(cwd);
  if (!state || state.syncTimer) return;

  state.syncTimer = setTimeout(() => {
    const current = projectWatchers.get(cwd);
    if (!current) return;
    current.syncTimer = undefined;
    syncProjectWatchers(cwd, getMainWindow);
  }, 250);
}

function startProjectWatcher(
  cwd: string,
  getMainWindow: () => BrowserWindow | null,
): void {
  const existing = projectWatchers.get(cwd);
  if (existing) {
    existing.refCount += 1;
    return;
  }

  const state: ProjectWatchState = {
    refCount: 1,
    watchers: new Map(),
  };
  projectWatchers.set(cwd, state);
  syncProjectWatchers(cwd, getMainWindow);
}

function stopProjectWatcher(cwd: string): void {
  const state = projectWatchers.get(cwd);
  if (!state) return;

  state.refCount = Math.max(0, state.refCount - 1);
  if (state.refCount > 0) return;

  closeProjectWatchers(state);
  projectWatchers.delete(cwd);
}

/**
 * Walk the filesystem including gitignored files.
 * Only skips VCS internals and node_modules (too massive).
 * Used by the "Project Files" explorer panel.
 */
function listAllFiles(cwd: string, maxFiles = 10000): string[] {
  const files: string[] = [];
  const queue: string[] = [""];

  while (queue.length > 0 && files.length < maxFiles) {
    const rel = queue.shift()!;
    const abs = rel ? path.join(cwd, rel) : cwd;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (EXPLORER_SKIP.has(entry.name)) continue;
        queue.push(entryRel);
      } else if (entry.isFile()) {
        files.push(entryRel);
      }
    }
  }

  return files.sort();
}

interface TreeNode {
  _file?: true;
  _dir?: true;
  _children?: Record<string, TreeNode>;
  [key: string]: TreeNode | boolean | Record<string, TreeNode> | undefined;
}

function buildFolderTree(dirPrefix: string, filePaths: string[]): string {
  const root: Record<string, TreeNode> = {};
  for (const f of filePaths) {
    const rel = f.slice(dirPrefix.length);
    if (!rel) continue;
    const parts = rel.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        current[p] = { _file: true };
      } else {
        if (!current[p]) current[p] = { _dir: true, _children: {} };
        current = (current[p] as TreeNode)._children as Record<string, TreeNode>;
      }
    }
  }

  function render(node: Record<string, TreeNode>, prefix = ""): string[] {
    const entries = Object.entries(node).sort((a, b) => {
      const aIsDir = !!a[1]._dir;
      const bIsDir = !!b[1]._dir;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a[0].localeCompare(b[0]);
    });
    const lines: string[] = [];
    entries.forEach(([name, val], i) => {
      const isLastEntry = i === entries.length - 1;
      const connector = isLastEntry ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
      const childPrefix = isLastEntry ? "    " : "\u2502   ";
      if (val._file) {
        lines.push(prefix + connector + name);
      } else {
        lines.push(prefix + connector + name + "/");
        lines.push(...render(val._children as Record<string, TreeNode>, prefix + childPrefix));
      }
    });
    return lines;
  }

  const lines = render(root);
  return dirPrefix + "\n" + lines.join("\n");
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("shell:open-external", async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      const errMsg = reportError("SHELL:OPEN_EXTERNAL_ERR", err, { url });
      return { error: errMsg };
    }
  });

  ipcMain.handle("files:list", async (_event, cwd: string) => {
    try {
      const files = await listProjectFiles(cwd);
      const dirSet = new Set<string>();
      for (const file of files) {
        const parts = file.split("/");
        for (let i = 1; i < parts.length; i++) {
          dirSet.add(parts.slice(0, i).join("/") + "/");
        }
      }
      const dirs = Array.from(dirSet).sort();
      return { files, dirs };
    } catch (err) {
      reportError("FILES:LIST_ERR", err);
      return { files: [], dirs: [] };
    }
  });

  ipcMain.handle("files:list-all", async (_event, cwd: string) => {
    try {
      const files = listAllFiles(cwd);
      const dirSet = new Set<string>();
      for (const file of files) {
        const parts = file.split("/");
        for (let i = 1; i < parts.length; i++) {
          dirSet.add(parts.slice(0, i).join("/") + "/");
        }
      }
      const dirs = Array.from(dirSet).sort();
      return { files, dirs };
    } catch (err) {
      reportError("FILES:LIST_ALL_ERR", err);
      return { files: [], dirs: [] };
    }
  });

  ipcMain.handle("files:watch", async (_event, cwd: string) => {
    try {
      startProjectWatcher(cwd, getMainWindow);
      return { ok: true };
    } catch (err) {
      const errMsg = reportError("FILES:WATCH_ERR", err, { cwd });
      return { error: errMsg };
    }
  });

  ipcMain.handle("files:unwatch", async (_event, cwd: string) => {
    try {
      stopProjectWatcher(cwd);
      return { ok: true };
    } catch (err) {
      const errMsg = reportError("FILES:UNWATCH_ERR", err, { cwd });
      return { error: errMsg };
    }
  });

  ipcMain.handle("files:read-multiple", async (_event, { cwd, paths }: { cwd: string; paths: string[] }) => {
    const results: Array<{ path: string; content?: string; error?: string; isDir?: boolean; tree?: string }> = [];
    for (const relPath of paths) {
      try {
        const absPath = path.resolve(cwd, relPath);
        if (!absPath.startsWith(path.resolve(cwd) + path.sep) && absPath !== path.resolve(cwd)) {
          results.push({ path: relPath, error: "Path outside project directory" });
          continue;
        }
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          const allFiles = await listProjectFiles(cwd);
          const dirPrefix = relPath.endsWith("/") ? relPath : relPath + "/";
          const matchingFiles = allFiles.filter((f) => f.startsWith(dirPrefix));
          const tree = buildFolderTree(dirPrefix, matchingFiles);
          results.push({ path: relPath, isDir: true, tree });
        } else {
          if (stat.size > 500_000) {
            results.push({ path: relPath, error: "File too large" });
            continue;
          }
          const content = fs.readFileSync(absPath, "utf-8");
          results.push({ path: relPath, content });
        }
      } catch (err) {
        results.push({ path: relPath, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  });

  ipcMain.handle("file:read", async (_event, filePath: string) => {
    try {
      // Resolve to absolute path and validate it's not outside the filesystem root
      const absPath = path.resolve(filePath);
      if (!absPath || absPath === path.sep) {
        return { error: "Invalid file path" };
      }
      const content = fs.readFileSync(absPath, "utf-8");
      return { content };
    } catch (err) {
      const errMsg = reportError("FILE:READ_ERR", err, { filePath });
      return { error: errMsg };
    }
  });

  ipcMain.handle("file:open-in-editor", async (_event, { filePath, line, editor: editorOverride }: { filePath: string; line?: number; editor?: string }) => {
    // Directories don't support --goto; just pass the path so the editor opens the folder
    let isDir = false;
    try { isDir = fs.statSync(filePath).isDirectory(); } catch { /* not found — treat as file */ }

    /** Try launching a single editor CLI. Resolves on success, rejects if not found. */
    const tryEditor = (editor: string): Promise<{ ok: true; editor: string }> =>
      new Promise((resolve, reject) => {
        const args = isDir
          ? [filePath]
          : ["--goto", line ? `${filePath}:${line}` : filePath];
        execFile(editor, args, { timeout: 3000 }, (err) => {
          if (err) reject(err);
          else resolve({ ok: true, editor });
        });
      });

    // Resolution order: explicit override → AppSettings preferredEditor → auto-detect
    const preferred = editorOverride ?? getAppSetting("preferredEditor") ?? "auto";
    const allEditors = ["cursor", "code", "zed"];

    // If a specific editor is requested, try it first then fall through to the rest
    const ordered = preferred !== "auto"
      ? [preferred, ...allEditors.filter((e) => e !== preferred)]
      : allEditors;

    for (const editor of ordered) {
      try {
        const result = await tryEditor(editor);
        void captureEvent("file_opened_in_editor", { editor });
        return result;
      } catch {
        // Editor not found, try next
      }
    }

    // Fallback: OS default
    try {
      await shell.openPath(filePath);
      void captureEvent("file_opened_in_editor", { editor: "default" });
      return { ok: true, editor: "default" };
    } catch (err) {
      const errMsg = reportError("FILE:OPEN_EDITOR_ERR", err, { filePath });
      return { error: errMsg };
    }
  });
}
