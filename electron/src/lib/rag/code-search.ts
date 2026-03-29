import { execFile } from "child_process";
import fs from "fs";
import path from "path";

export interface SearchHit {
  file: string;
  score: number;
  matchedLines: Array<{ line: number; text: string }>;
}

// ── Extension filter ──────────────────────────────────────────────────────────
// Only search inside files that can contain code or readable text.
const SKIP_SEARCH_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp4", ".mp3", ".wav", ".avi",
  ".lock", ".bin", ".exe", ".dll", ".so", ".dylib",
  ".zip", ".tar", ".gz", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".frx", ".frf", // FastReport — binary report templates
]);

function isCodeFile(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return !SKIP_SEARCH_EXTS.has(ext);
}

// ── Direct file read (highest priority) ──────────────────────────────────────
/**
 * When the user explicitly mentions a file by name (e.g. "package.json"),
 * check if it actually exists in the project and return it immediately.
 * Score 100 — always beats keyword matches.
 */
function findDirectFiles(cwd: string, targets: string[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const target of targets) {
    // Only consider targets that look like filenames (have an extension)
    if (!path.extname(target)) continue;

    // Try exact relative path first
    const abs = path.resolve(cwd, target);
    if (abs.startsWith(cwd) && safeFileExists(abs)) {
      hits.push({ file: path.relative(cwd, abs), score: 100, matchedLines: [] });
      continue;
    }

    // Try basename match: search for any file named the same anywhere in cwd
    const basename = path.basename(target).toLowerCase();
    const found = findByBasename(cwd, basename, 4 /* max depth */);
    for (const f of found) {
      hits.push({ file: f, score: 100, matchedLines: [] });
    }
  }
  return hits;
}

function safeFileExists(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

function findByBasename(cwd: string, basename: string, maxDepth: number): string[] {
  const results: string[] = [];
  function walk(dir: string, depth: number) {
    if (depth > maxDepth || results.length >= 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase() === basename) {
        results.push(path.relative(cwd, abs));
      }
    }
  }
  walk(cwd, 0);
  return results;
}

// ── git grep ──────────────────────────────────────────────────────────────────

function gitGrep(
  cwd: string,
  pattern: string,
): Promise<Array<{ file: string; line: number; text: string }>> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["grep", "-i", "-n", "-F", "--", pattern],
      { cwd, maxBuffer: 2 * 1024 * 1024 },
      (_err, stdout) => {
        if (!stdout) { resolve([]); return; }
        const hits: Array<{ file: string; line: number; text: string }> = [];
        for (const raw of stdout.split("\n")) {
          const colonIdx = raw.indexOf(":");
          if (colonIdx < 0) continue;
          const rest = raw.slice(colonIdx + 1);
          const colonIdx2 = rest.indexOf(":");
          if (colonIdx2 < 0) continue;
          const file = raw.slice(0, colonIdx);
          if (!isCodeFile(file)) continue; // skip binary/report files
          const lineNo = parseInt(rest.slice(0, colonIdx2), 10);
          const text = rest.slice(colonIdx2 + 1).trim();
          if (!isNaN(lineNo)) hits.push({ file, line: lineNo, text });
        }
        resolve(hits);
      },
    );
  });
}

// ── git ls-files (with fs fallback) ──────────────────────────────────────────

function listAllFiles(cwd: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout) => {
        if (!err && stdout) {
          resolve(stdout.trim().split("\n").filter((f) => f && isCodeFile(f)));
          return;
        }
        // Fallback: git not available or not a git repo — use fs walk
        const files: string[] = [];
        function walk(dir: string, depth: number) {
          if (depth > 5 || files.length > 2000) return;
          let entries: fs.Dirent[];
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(abs, depth + 1);
            } else if (entry.isFile() && isCodeFile(entry.name)) {
              files.push(path.relative(cwd, abs));
            }
          }
        }
        walk(cwd, 0);
        resolve(files);
      },
    );
  });
}

// ── Filename scoring ──────────────────────────────────────────────────────────

function scoreByTargets(
  files: string[],
  targets: string[],
  fileScores: Map<string, { score: number; lines: Map<number, string> }>,
): void {
  for (const file of files) {
    for (const target of targets) {
      const base = path.basename(target).toLowerCase();
      if (!base || !path.extname(base)) continue; // skip non-filename targets
      if (file.toLowerCase().includes(base)) {
        if (!fileScores.has(file)) fileScores.set(file, { score: 0, lines: new Map() });
        fileScores.get(file)!.score += 3;
      }
    }
  }
}

// ── Main search ───────────────────────────────────────────────────────────────

const MAX_KEYWORD_GREPS = 4;
const MAX_RESULTS = 6;

export async function searchCode(
  cwd: string,
  keywords: string[],
  targets: string[],
): Promise<SearchHit[]> {
  // ── Step 1: Direct filename lookup (highest priority) ────────────────────
  // If user named a specific file (e.g. "package.json"), find and return it
  // immediately — no need for fuzzy search.
  const directHits = findDirectFiles(cwd, targets);
  if (directHits.length > 0) {
    return directHits.slice(0, MAX_RESULTS);
  }

  // ── Step 2: Fuzzy keyword + filename search ──────────────────────────────
  const fileScores = new Map<string, { score: number; lines: Map<number, string> }>();

  function addHit(file: string, line: number, text: string, bonus: number) {
    if (!isCodeFile(file)) return;
    if (!fileScores.has(file)) fileScores.set(file, { score: 0, lines: new Map() });
    const entry = fileScores.get(file)!;
    entry.score += bonus;
    entry.lines.set(line, text);
  }

  const allFiles = await listAllFiles(cwd);
  scoreByTargets(allFiles, targets, fileScores);

  // Grep for identifier targets (CamelCase/camelCase names, not file paths)
  const identifierTargets = targets.filter((t) => !path.extname(t));
  for (const target of identifierTargets.slice(0, 3)) {
    const hits = await gitGrep(cwd, target);
    for (const h of hits) addHit(h.file, h.line, h.text, 2);
  }

  // Grep for top keywords — use only meaningful ones (longer than 3 chars)
  const meaningfulKeywords = keywords.filter((k) => k.length > 3).slice(0, MAX_KEYWORD_GREPS);
  for (const kw of meaningfulKeywords) {
    const hits = await gitGrep(cwd, kw);
    for (const h of hits) addHit(h.file, h.line, h.text, 1);
  }

  return [...fileScores.entries()]
    .map(([file, { score, lines }]) => ({
      file,
      score,
      matchedLines: [...lines.entries()]
        .map(([line, text]) => ({ line, text }))
        .sort((a, b) => a.line - b.line),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}
