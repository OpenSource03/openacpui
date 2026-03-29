import fs from "fs";
import path from "path";
import type { Intent } from "./intent-detector";
import type { SearchHit } from "./code-search";

// ── Limits tuned for 4B models ────────────────────────────────────────────────

const MAX_LINES_PER_FILE = 80;
/** Max total characters of code context sent to model */
const MAX_CONTEXT_CHARS = 7000;
/** Context window padding — extra lines before/after a match cluster */
const CONTEXT_PADDING = 15;

// ── File extensions considered code/text ─────────────────────────────────────

const SKIP_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
  ".svg", ".woff", ".woff2", ".ttf", ".eot",
  ".mp4", ".mp3", ".wav",
  ".lock", ".bin", ".exe", ".dll",
]);

// ── Snippet extraction ────────────────────────────────────────────────────────

interface Snippet {
  filePath: string;
  snippet: string;
  startLine: number;
  endLine: number;
}

function extractSnippet(
  relPath: string,
  cwd: string,
  matchedLines: Array<{ line: number }>,
): Snippet | null {
  const ext = path.extname(relPath).toLowerCase();
  if (SKIP_EXTS.has(ext)) return null;

  const abs = path.resolve(cwd, relPath);
  let content: string;
  try {
    const stat = fs.statSync(abs);
    if (stat.size > 200_000) return null; // skip files > 200 KB
    content = fs.readFileSync(abs, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n");

  // If the whole file fits, return it all
  if (lines.length <= MAX_LINES_PER_FILE) {
    return { filePath: relPath, snippet: content, startLine: 1, endLine: lines.length };
  }

  // Find the window that covers most matched lines
  let windowStart = 0;
  if (matchedLines.length > 0) {
    const sorted = [...matchedLines].sort((a, b) => a.line - b.line);
    const first = sorted[0].line - 1; // 0-indexed
    const last = sorted[sorted.length - 1].line - 1;
    const center = Math.floor((first + last) / 2);
    const half = Math.floor(MAX_LINES_PER_FILE / 2);
    windowStart = Math.max(0, center - half);
  }

  // Expand slightly to include CONTEXT_PADDING before the first match
  if (matchedLines.length > 0) {
    const firstMatch = Math.min(...matchedLines.map((l) => l.line)) - 1;
    windowStart = Math.max(0, Math.min(windowStart, firstMatch - CONTEXT_PADDING));
  }

  const windowEnd = Math.min(lines.length, windowStart + MAX_LINES_PER_FILE);

  // If we're mid-file, add ellipsis markers
  const prefix = windowStart > 0 ? `// ... (lines 1–${windowStart} omitted)\n` : "";
  const suffix =
    windowEnd < lines.length ? `\n// ... (lines ${windowEnd + 1}–${lines.length} omitted)` : "";

  return {
    filePath: relPath,
    snippet: prefix + lines.slice(windowStart, windowEnd).join("\n") + suffix,
    startLine: windowStart + 1,
    endLine: windowEnd,
  };
}

// ── Context formatting ────────────────────────────────────────────────────────

function langTag(filePath: string): string {
  const ext = path.extname(filePath).slice(1);
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", go: "go", rs: "rust", css: "css", scss: "css",
    json: "json", md: "markdown", yaml: "yaml", yml: "yaml",
  };
  return map[ext] ?? ext ?? "text";
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface BuiltContext {
  snippets: Snippet[];
  fileCount: number;
}

export function buildContext(
  _prompt: string,
  _intent: Intent,
  hits: SearchHit[],
  cwd: string,
): BuiltContext {
  if (hits.length === 0) return { snippets: [], fileCount: 0 };

  const snippets: Snippet[] = [];
  let totalChars = 0;

  for (const hit of hits) {
    if (totalChars >= MAX_CONTEXT_CHARS) break;

    const extracted = extractSnippet(hit.file, cwd, hit.matchedLines);
    if (!extracted) continue;

    const remaining = MAX_CONTEXT_CHARS - totalChars;
    if (extracted.snippet.length > remaining) {
      extracted.snippet = extracted.snippet.slice(0, remaining) + "\n// ... (truncated)";
    }

    snippets.push(extracted);
    totalChars += extracted.snippet.length;
  }

  return { snippets, fileCount: snippets.length };
}

/** Format a snippet for display as a tool result */
export function snippetToToolResult(s: Snippet): string {
  return [
    `Read ${s.filePath}: OK (${s.snippet.length} chars, lines ${s.startLine}–${s.endLine})`,
    `\nContents of ${s.filePath}:`,
    "```" + langTag(s.filePath),
    s.snippet,
    "```",
  ].join("\n");
}
