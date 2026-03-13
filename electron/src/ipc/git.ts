import { ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { gitExec, ALWAYS_SKIP } from "../lib/git-exec";
import { captureEvent } from "../lib/posthog";
import { reportError } from "../lib/error-utils";

interface DiscoveredRepo {
  path: string;
  name: string;
  isSubRepo: boolean;
  isWorktree: boolean;
  isPrimaryWorktree: boolean;
}

interface RepoMetadata {
  topLevel: string;
  isLinkedWorktree: boolean;
}

function normalizePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isNestedPath(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function parseWorktreePaths(raw: string): string[] {
  const paths: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.push(line.slice("worktree ".length).trim());
    }
  }
  return paths;
}

async function readRepoMetadata(cwd: string): Promise<RepoMetadata | null> {
  try {
    const raw = await gitExec(["rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir"], cwd);
    const [topLevelRaw, gitDirRaw, commonDirRaw] = raw.split("\n").map((line) => line.trim());
    if (!topLevelRaw || !gitDirRaw || !commonDirRaw) return null;

    const cwdPath = normalizePath(cwd);
    const topLevel = normalizePath(topLevelRaw);
    const gitDir = normalizePath(path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(cwdPath, gitDirRaw));
    const commonDir = normalizePath(path.isAbsolute(commonDirRaw) ? commonDirRaw : path.resolve(cwdPath, commonDirRaw));

    return {
      topLevel,
      isLinkedWorktree: gitDir !== commonDir,
    };
  } catch {
    return null;
  }
}

/** Validate that a user-provided git ref doesn't look like a flag to prevent argument injection. */
function validateRef(ref: string): void {
  if (ref.startsWith("-")) {
    throw new Error(`Invalid ref: "${ref}" — must not start with a dash`);
  }
}

export function register(): void {
  ipcMain.handle("git:discover-repos", async (_event, projectPath: string) => {
    const normalizedProjectPath = normalizePath(projectPath);
    const reposByPath = new Map<string, DiscoveredRepo>();
    const candidatePaths = new Set<string>([normalizedProjectPath]);

    const upsertRepo = (
      repoPath: string,
      { isSubRepo, isWorktree, isPrimaryWorktree }: { isSubRepo: boolean; isWorktree: boolean; isPrimaryWorktree: boolean },
    ) => {
      const normalizedRepoPath = normalizePath(repoPath);
      const existing = reposByPath.get(normalizedRepoPath);
      if (existing) {
        existing.isSubRepo = existing.isSubRepo || isSubRepo;
        existing.isWorktree = existing.isWorktree || isWorktree;
        existing.isPrimaryWorktree = existing.isPrimaryWorktree || isPrimaryWorktree;
        return;
      }

      reposByPath.set(normalizedRepoPath, {
        path: normalizedRepoPath,
        name: path.basename(normalizedRepoPath),
        isSubRepo,
        isWorktree,
        isPrimaryWorktree,
      });
    };

    const walk = (dir: string, depth: number): void => {
      if (depth > 2) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || ALWAYS_SKIP.has(entry.name)) continue;
          const sub = path.join(dir, entry.name);
          if (entry.name === ".git") continue;
          const gitDir = path.join(sub, ".git");
          if (fs.existsSync(gitDir)) {
            candidatePaths.add(normalizePath(sub));
          } else {
            walk(sub, depth + 1);
          }
        }
      } catch {
        /* permission errors */
      }
    };

    walk(normalizedProjectPath, 0);

    for (const candidatePath of candidatePaths) {
      const metadata = await readRepoMetadata(candidatePath);
      if (!metadata) continue;
      upsertRepo(metadata.topLevel, {
        isSubRepo: isNestedPath(normalizedProjectPath, metadata.topLevel),
        isWorktree: metadata.isLinkedWorktree,
        isPrimaryWorktree: false,
      });
    }

    const worktreeSeedPaths = [...reposByPath.keys()];
    for (const seedPath of worktreeSeedPaths) {
      try {
        const worktreesRaw = await gitExec(["worktree", "list", "--porcelain"], seedPath);
        const worktreePaths = parseWorktreePaths(worktreesRaw);
        for (const rawWorktreePath of worktreePaths) {
          const metadata = await readRepoMetadata(rawWorktreePath);
          if (!metadata) continue;
          upsertRepo(metadata.topLevel, {
            isSubRepo: isNestedPath(normalizedProjectPath, metadata.topLevel),
            isWorktree: true,
            isPrimaryWorktree: !metadata.isLinkedWorktree,
          });
        }
      } catch {
        // Not all repositories use worktrees; ignore and continue discovery.
      }
    }

    return [...reposByPath.values()];
  });

  ipcMain.handle("git:status", async (_event, cwd: string) => {
    try {
      const raw = await gitExec(["status", "--porcelain=v2", "--branch"], cwd);
      const lines = raw.split("\n");
      let branch = "HEAD";
      let upstream: string | undefined;
      let ahead = 0;
      let behind = 0;
      const files: Array<{ path: string; oldPath?: string; status: string; group: string }> = [];

      for (const line of lines) {
        if (line.startsWith("# branch.head ")) {
          branch = line.slice("# branch.head ".length);
        } else if (line.startsWith("# branch.upstream ")) {
          upstream = line.slice("# branch.upstream ".length);
        } else if (line.startsWith("# branch.ab ")) {
          const match = line.match(/\+(\d+) -(\d+)/);
          if (match) {
            ahead = parseInt(match[1], 10);
            behind = parseInt(match[2], 10);
          }
        } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
          const parts = line.split(" ");
          const xy = parts[1];
          const isRename = line.startsWith("2 ");
          let filePath: string;
          let oldPath: string | undefined;
          if (isRename) {
            const rest = parts.slice(8).join(" ");
            const tabParts = rest.split("\t");
            filePath = tabParts[0];
            oldPath = tabParts[1];
          } else {
            filePath = parts.slice(8).join(" ");
          }

          const x = xy[0];
          const y = xy[1];
          const statusMap: Record<string, string> = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", U: "unmerged" };

          if (x !== "." && x !== "?") {
            files.push({
              path: filePath,
              oldPath: isRename ? oldPath : undefined,
              status: statusMap[x] || "modified",
              group: "staged",
            });
          }
          if (y !== "." && y !== "?") {
            files.push({
              path: filePath,
              status: statusMap[y] || "modified",
              group: "unstaged",
            });
          }
        } else if (line.startsWith("u ")) {
          const parts = line.split(" ");
          const filePath = parts.slice(10).join(" ");
          files.push({ path: filePath, status: "unmerged", group: "unstaged" });
        } else if (line.startsWith("? ")) {
          files.push({ path: line.slice(2), status: "untracked", group: "untracked" });
        }
      }

      return { branch, upstream, ahead, behind, files };
    } catch (err) {
      return { error: reportError("GIT_STATUS_ERR", err) };
    }
  });

  ipcMain.handle("git:stage", async (_event, { cwd, files }: { cwd: string; files: string[] }) => {
    try {
      await gitExec(["add", "--", ...files], cwd);
      return { ok: true };
    } catch (err) {
      return { error: reportError("GIT_STAGE_ERR", err) };
    }
  });

  ipcMain.handle("git:unstage", async (_event, { cwd, files }: { cwd: string; files: string[] }) => {
    try {
      await gitExec(["restore", "--staged", "--", ...files], cwd);
      return { ok: true };
    } catch (err) {
      return { error: reportError("GIT_UNSTAGE_ERR", err) };
    }
  });

  ipcMain.handle("git:stage-all", async (_event, cwd: string) => {
    try {
      await gitExec(["add", "-A"], cwd);
      return { ok: true };
    } catch (err) {
      return { error: reportError("GIT_STAGE_ALL_ERR", err) };
    }
  });

  ipcMain.handle("git:unstage-all", async (_event, cwd: string) => {
    try {
      await gitExec(["reset", "HEAD", "--", "."], cwd);
      return { ok: true };
    } catch (err) {
      return { error: reportError("GIT_UNSTAGE_ALL_ERR", err) };
    }
  });

  ipcMain.handle("git:discard", async (_event, { cwd, files }: { cwd: string; files: string[] }) => {
    try {
      const statusRaw = await gitExec(["status", "--porcelain"], cwd);
      const untrackedSet = new Set<string>();
      for (const line of statusRaw.split("\n")) {
        if (line.startsWith("??")) untrackedSet.add(line.slice(3).trim());
      }

      const tracked = files.filter((f) => !untrackedSet.has(f));
      const untracked = files.filter((f) => untrackedSet.has(f));

      if (tracked.length > 0) {
        await gitExec(["checkout", "--", ...tracked], cwd);
      }
      if (untracked.length > 0) {
        await gitExec(["clean", "-f", "--", ...untracked], cwd);
      }
      return { ok: true };
    } catch (err) {
      return { error: reportError("GIT_DISCARD_ERR", err) };
    }
  });

  ipcMain.handle("git:commit", async (_event, { cwd, message }: { cwd: string; message: string }) => {
    try {
      const output = await gitExec(["commit", "-m", message], cwd);
      void captureEvent("git_commit_created", { message_length: message.length });
      return { ok: true, output };
    } catch (err) {
      return { error: reportError("GIT_COMMIT_ERR", err) };
    }
  });

  ipcMain.handle("git:branches", async (_event, cwd: string) => {
    try {
      const raw = await gitExec(
        ["branch", "-a", "--format=%(HEAD)\t%(refname:short)\t%(upstream:short)\t%(upstream:track,nobracket)"],
        cwd,
      );
      const branches: Array<{
        name: string;
        isCurrent: boolean;
        isRemote: boolean;
        upstream?: string;
        ahead?: number;
        behind?: number;
      }> = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        const [head, name, upstream, track] = line.split("\t");
        const isCurrent = head === "*";
        const isRemote = name.startsWith("remotes/");
        let ahead: number | undefined;
        let behind: number | undefined;
        if (track) {
          const aheadMatch = track.match(/ahead (\d+)/);
          const behindMatch = track.match(/behind (\d+)/);
          if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
          if (behindMatch) behind = parseInt(behindMatch[1], 10);
        }
        branches.push({
          name: isRemote ? name.replace(/^remotes\//, "") : name,
          isCurrent,
          isRemote,
          upstream: upstream || undefined,
          ahead,
          behind,
        });
      }
      return branches;
    } catch (err) {
      return { error: reportError("GIT_BRANCHES_ERR", err) };
    }
  });

  ipcMain.handle("git:checkout", async (_event, { cwd, branch }: { cwd: string; branch: string }) => {
    try {
      validateRef(branch);
      await gitExec(["checkout", branch], cwd);
      void captureEvent("git_branch_switched");
      return { ok: true };
    } catch (err) {
      return { error: reportError("GIT_CHECKOUT_ERR", err) };
    }
  });

  ipcMain.handle("git:create-branch", async (_event, { cwd, name }: { cwd: string; name: string }) => {
    try {
      validateRef(name);
      await gitExec(["checkout", "-b", name], cwd);
      return { ok: true };
    } catch (err) {
      return { error: reportError("GIT_CREATE_BRANCH_ERR", err) };
    }
  });

  ipcMain.handle("git:create-worktree", async (_event, { cwd, path: worktreePath, branch, fromRef }: { cwd: string; path: string; branch: string; fromRef?: string }) => {
    try {
      validateRef(branch);
      if (fromRef?.trim()) validateRef(fromRef.trim());
      const resolvedPath = path.isAbsolute(worktreePath) ? worktreePath : path.resolve(cwd, worktreePath);
      const args = ["worktree", "add", "-b", branch, resolvedPath];
      if (fromRef?.trim()) args.push(fromRef.trim());
      const output = await gitExec(args, cwd);

      // Auto-add .harnss/ to .gitignore if the worktree is inside .harnss/worktrees/
      if (resolvedPath.includes("/.harnss/")) {
        try {
          const gitignorePath = path.join(cwd, ".gitignore");
          const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : "";
          if (!existing.includes(".harnss/") && !existing.includes(".harnss")) {
            const newContent = existing
              ? (existing.endsWith("\n") ? `${existing}.harnss/\n` : `${existing}\n.harnss/\n`)
              : ".harnss/\n";
            fs.writeFileSync(gitignorePath, newContent, "utf-8");
          }
        } catch {
          // Non-critical — don't fail worktree creation over .gitignore
        }
      }

      return { ok: true, path: resolvedPath, output };
    } catch (err) {
      return { error: reportError("GIT_CREATE_WORKTREE_ERR", err) };
    }
  });


  ipcMain.handle("git:remove-worktree", async (_event, { cwd, path: worktreePath, force }: { cwd: string; path: string; force?: boolean }) => {
    try {
      const resolvedPath = path.isAbsolute(worktreePath) ? worktreePath : path.resolve(cwd, worktreePath);
      const args = ["worktree", "remove"];
      if (force) args.push("--force");
      args.push(resolvedPath);
      const output = await gitExec(args, cwd);
      return { ok: true, output };
    } catch (err) {
      return { error: reportError("GIT_REMOVE_WORKTREE_ERR", err) };
    }
  });

  ipcMain.handle("git:prune-worktrees", async (_event, cwd: string) => {
    try {
      const output = await gitExec(["worktree", "prune"], cwd);
      return { ok: true, output };
    } catch (err) {
      return { error: reportError("GIT_PRUNE_WORKTREES_ERR", err) };
    }
  });

  ipcMain.handle("git:push", async (_event, cwd: string) => {
    try {
      const output = await gitExec(["push"], cwd);
      return { ok: true, output };
    } catch (err) {
      return { error: reportError("GIT_PUSH_ERR", err) };
    }
  });

  ipcMain.handle("git:pull", async (_event, cwd: string) => {
    try {
      const output = await gitExec(["pull"], cwd);
      return { ok: true, output };
    } catch (err) {
      return { error: reportError("GIT_PULL_ERR", err) };
    }
  });

  ipcMain.handle("git:fetch", async (_event, cwd: string) => {
    try {
      const output = await gitExec(["fetch", "--all"], cwd);
      return { ok: true, output };
    } catch (err) {
      return { error: reportError("GIT_FETCH_ERR", err) };
    }
  });

  ipcMain.handle("git:diff-file", async (_event, { cwd, file, staged }: { cwd: string; file: string; staged?: boolean }) => {
    try {
      const diffArgs = staged
        ? ["diff", "--staged", "--", file]
        : ["diff", "--", file];
      const diff = await gitExec(diffArgs, cwd);
      return { diff };
    } catch (err) {
      return { error: reportError("GIT_DIFF_FILE_ERR", err) };
    }
  });

  ipcMain.handle("git:diff-stat", async (_event, cwd: string) => {
    try {
      // Get line stats for both unstaged and staged changes
      const [unstagedRaw, stagedRaw] = await Promise.all([
        gitExec(["diff", "--shortstat"], cwd).catch(() => ""),
        gitExec(["diff", "--cached", "--shortstat"], cwd).catch(() => ""),
      ]);

      let additions = 0;
      let deletions = 0;
      for (const raw of [unstagedRaw, stagedRaw]) {
        const insMatch = raw.match(/(\d+) insertion/);
        const delMatch = raw.match(/(\d+) deletion/);
        if (insMatch) additions += parseInt(insMatch[1], 10);
        if (delMatch) deletions += parseInt(delMatch[1], 10);
      }

      return { additions, deletions };
    } catch (err) {
      return { additions: 0, deletions: 0 };
    }
  });

  ipcMain.handle("git:show-file-at-head", async (_event, { cwd, file }: { cwd: string; file: string }) => {
    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

    try {
      const headContent = await withTimeout(gitExec(["show", `HEAD:${file}`], cwd), 8000);

      let hasDiff = false;
      try {
        const diff = await withTimeout(gitExec(["diff", "HEAD", "--", file], cwd), 4000);
        hasDiff = diff.trim().length > 0;
      } catch {}

      if (!hasDiff) {
        try {
          const parentContent = await withTimeout(gitExec(["show", `HEAD~1:${file}`], cwd), 4000);
          if (parentContent !== headContent) return { content: parentContent };
        } catch {}
      }

      return { content: headContent };
    } catch (err) {
      reportError("GIT_SHOW_FILE_AT_HEAD_ERR", err, { cwd, file });
      return { error: "not-in-git" };
    }
  });

  ipcMain.handle("git:reflog", async (_event, { cwd, count }: { cwd: string; count?: number }) => {
    try {
      const limit = count || 20;
      const raw = await gitExec(["reflog", "--format=%H|%gd|%gs|%ci", `-n${limit}`], cwd);
      const entries = raw.trim().split("\n").filter(Boolean).map((line) => {
        const [hash, ref, subject, date] = line.split("|");
        return { hash, ref, subject, date };
      });
      return { entries };
    } catch (err) {
      return { entries: [], error: reportError("GIT_REFLOG_ERR", err) };
    }
  });

  ipcMain.handle("git:undo", async (_event, cwd: string) => {
    try {
      const reflog = await gitExec(["reflog", "--format=%H|%gs", "-n2"], cwd);
      const lines = reflog.trim().split("\n").filter(Boolean);
      if (lines.length < 2) return { error: "nothing-to-undo" };
      const targetHash = lines[1].split("|")[0];
      await gitExec(["reset", "--soft", targetHash], cwd);
      return { success: true, hash: targetHash };
    } catch (err) {
      return { error: reportError("GIT_UNDO_ERR", err) };
    }
  });

  ipcMain.handle("git:stash-list", async (_event, cwd: string) => {
    try {
      const raw = await gitExec(["stash", "list", "--format=%gd|%gs|%ci"], cwd);
      const stashes = raw.trim().split("\n").filter(Boolean).map((line) => {
        const [ref, message, date] = line.split("|");
        return { ref, message, date };
      });
      return { stashes };
    } catch {
      return { stashes: [] };
    }
  });

  ipcMain.handle("git:stash-save", async (_event, { cwd, message }: { cwd: string; message?: string }) => {
    try {
      const args = ["stash", "push"];
      if (message) args.push("-m", message);
      await gitExec(args, cwd);
      return { success: true };
    } catch (err) {
      return { error: reportError("GIT_STASH_SAVE_ERR", err) };
    }
  });

  ipcMain.handle("git:stash-pop", async (_event, { cwd, ref }: { cwd: string; ref?: string }) => {
    try {
      await gitExec(["stash", "pop", ref || "stash@{0}"], cwd);
      return { success: true };
    } catch (err) {
      return { error: reportError("GIT_STASH_POP_ERR", err) };
    }
  });

  ipcMain.handle("git:stash-apply", async (_event, { cwd, ref }: { cwd: string; ref?: string }) => {
    try {
      await gitExec(["stash", "apply", ref || "stash@{0}"], cwd);
      return { success: true };
    } catch (err) {
      return { error: reportError("GIT_STASH_APPLY_ERR", err) };
    }
  });

  ipcMain.handle("git:stash-drop", async (_event, { cwd, ref }: { cwd: string; ref?: string }) => {
    try {
      await gitExec(["stash", "drop", ref || "stash@{0}"], cwd);
      return { success: true };
    } catch (err) {
      return { error: reportError("GIT_STASH_DROP_ERR", err) };
    }
  });

  ipcMain.handle("git:cherry-pick", async (_event, { cwd, hash }: { cwd: string; hash: string }) => {
    try {
      await gitExec(["cherry-pick", hash], cwd);
      return { success: true };
    } catch (err) {
      return { error: reportError("GIT_CHERRY_PICK_ERR", err) };
    }
  });

  ipcMain.handle("git:blame", async (_event, { cwd, file }: { cwd: string; file: string }) => {
    try {
      const raw = await gitExec(["blame", "--porcelain", file], cwd);
      const lines: Array<{ hash: string; author: string; date: string; lineNumber: number; content: string }> = [];
      const rawLines = raw.split("\n");
      let currentHash = "";
      let currentAuthor = "";
      let currentDate = "";
      let lineNum = 0;
      for (const line of rawLines) {
        const hashMatch = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)/);
        if (hashMatch) {
          currentHash = hashMatch[1];
          lineNum = parseInt(hashMatch[3], 10);
          continue;
        }
        if (line.startsWith("author ")) { currentAuthor = line.slice(7); continue; }
        if (line.startsWith("author-time ")) { currentDate = new Date(parseInt(line.slice(12), 10) * 1000).toISOString(); continue; }
        if (line.startsWith("\t")) {
          lines.push({ hash: currentHash, author: currentAuthor, date: currentDate, lineNumber: lineNum, content: line.slice(1) });
        }
      }
      return { lines };
    } catch (err) {
      return { error: reportError("GIT_BLAME_ERR", err) };
    }
  });

  ipcMain.handle("git:log", async (_event, { cwd, count }: { cwd: string; count?: number }) => {
    try {
      const limit = count || 50;
      const raw = await gitExec(
        ["log", `--format=%H\t%h\t%s\t%an\t%aI`, `-n`, String(limit)],
        cwd,
      );
      const entries: Array<{ hash: string; shortHash: string; subject: string; author: string; date: string }> = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        const [hash, shortHash, subject, author, date] = line.split("\t");
        entries.push({ hash, shortHash, subject, author, date });
      }
      return entries;
    } catch (err) {
      return { error: reportError("GIT_LOG_ERR", err) };
    }
  });
}
