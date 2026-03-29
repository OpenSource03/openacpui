/**
 * RAG Orchestrator for Ollama engine.
 *
 * Search priority:
 *   1. BM25 indexed search (if index is ready) — best quality
 *   2. Direct filename lookup (if user names a specific file)
 *   3. Live grep search (fallback when index not ready yet)
 *
 * Injection strategy per intent:
 *   EXPLAIN / SEARCH / GENERAL →
 *     Single augmented user message with file content between clear separators.
 *     Small models follow single-turn context; injected history gets ignored.
 *
 *   EDIT / FIX / REFACTOR →
 *     Simulated tool turns: model "already read" files, so it produces
 *     structured edit_file output without unnecessary exploration.
 */

import fs from "fs";
import path from "path";
import { detectIntent, type Intent } from "./intent-detector";
import { searchCode } from "./code-search";
import { buildContext } from "./context-builder";
import { searchIndex, isIndexReady, type IndexedSearchResult } from "./indexer";
import { log } from "../logger";

export type { Intent };
export { detectIntent };
export { triggerIndex, isIndexReady, invalidateIndex } from "./indexer";
export { compressConversation, estimateTokens } from "./conversation-manager";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OllamaMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AugmentResult {
  /** Original user message — always pushed first */
  userMessage: string;
  /** Simulated tool turns injected after userMessage */
  injectedTurns?: OllamaMessage[];
  intent: Intent;
  contextFileCount: number;
  /** File paths that were directly read and injected */
  contextFiles?: string[];
}

// ── Intent classification ─────────────────────────────────────────────────────

const EDIT_INTENTS = new Set<Intent["type"]>(["EDIT_CODE", "FIX_BUG", "REFACTOR", "GENERATE_FILE"]);

// ── BM25 result → snippet format ──────────────────────────────────────────────

function indexedResultToSnippet(r: IndexedSearchResult): {
  filePath: string;
  snippet: string;
  startLine: number;
  endLine: number;
} {
  return {
    filePath: r.file,
    snippet: r.snippet,
    startLine: r.startLine,
    endLine: r.endLine,
  };
}

function langTag(filePath: string): string {
  const ext = path.extname(filePath).slice(1);
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", go: "go", rs: "rust", css: "css", scss: "css",
    php: "php", rb: "ruby", java: "java",
    json: "json", md: "markdown", yaml: "yaml", yml: "yaml",
  };
  return map[ext] ?? ext ?? "text";
}

// ── Direct file read ─────────────────────────────────────────────────────────
/**
 * Priority 0: when the user explicitly names a file (e.g. "package.json"),
 * read it directly from disk — do NOT run BM25 or grep which find random files
 * that merely contain those words as tokens.
 */
function readDirectTargets(
  targets: string[],
  cwd: string,
): Array<{ filePath: string; snippet: string; startLine: number; endLine: number }> {
  const results: Array<{ filePath: string; snippet: string; startLine: number; endLine: number }> = [];

  for (const target of targets) {
    if (!path.extname(target)) continue; // skip non-filename targets

    // Try exact relative path first
    const candidates = [
      path.resolve(cwd, target),
    ];

    // Also search by basename if path has no directory component
    if (!target.includes("/") && !target.includes(path.sep)) {
      // Walk up to 4 levels to find file by name
      const found = findByBasenameSync(cwd, target, 4);
      candidates.push(...found);
    }

    for (const abs of candidates) {
      if (!abs.startsWith(cwd)) continue;
      try {
        const stat = fs.statSync(abs);
        if (!stat.isFile() || stat.size > 200_000) continue;
        const content = fs.readFileSync(abs, "utf-8");
        const lines = content.split("\n");
        const relPath = path.relative(cwd, abs);
        results.push({
          filePath: relPath,
          snippet: content,
          startLine: 1,
          endLine: lines.length,
        });
        break; // found this target, move to next
      } catch { /* skip */ }
    }

    if (results.length >= 3) break;
  }

  return results;
}

function findByBasenameSync(cwd: string, basename: string, maxDepth: number): string[] {
  const found: string[] = [];
  const lc = basename.toLowerCase();

  function walk(dir: string, depth: number) {
    if (depth > maxDepth || found.length >= 3) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "vendor") continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs, depth + 1);
      } else if (e.isFile() && e.name.toLowerCase() === lc) {
        found.push(abs);
      }
    }
  }
  walk(cwd, 0);
  return found;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function augmentWithRag(
  userMessage: string,
  cwd: string,
): Promise<AugmentResult> {
  const intent = detectIntent(userMessage);

  // ── Search ──────────────────────────────────────────────────────────────────
  let snippets: Array<{ filePath: string; snippet: string; startLine: number; endLine: number }> = [];
  // Track which file paths came from direct reads (Priority 0) so injection
  // is only done when we are 100% confident we have the right content.
  const directHitsSet = new Set<string>();

  try {
    // Priority 0: direct file read when user explicitly names a file.
    // This must run BEFORE BM25 — BM25 matches on tokens ("package", "json")
    // and returns unrelated files that happen to contain those words.
    const directHits = readDirectTargets(intent.targets, cwd);
    if (directHits.length > 0) {
      snippets = directHits;
      for (const h of directHits) directHitsSet.add(h.filePath);
      log("RAG", `direct read: ${directHits.map(h => h.filePath).join(", ")}`);
    } else if (isIndexReady(cwd)) {
      // Priority 1: BM25 indexed search — best for semantic/keyword queries
      const query = [userMessage, ...intent.targets].join(" ");
      const hits = searchIndex(cwd, query, 5);
      snippets = hits.map(indexedResultToSnippet);
      log("RAG", `BM25 search: intent=${intent.type} hits=${hits.length}`);
    } else {
      // Path 2: Live grep (index still building)
      const searchKeywords =
        intent.type === "EXPLAIN_CODE" || intent.type === "SEARCH" || intent.type === "GENERAL"
          ? intent.keywords.slice(0, 3)
          : intent.keywords;

      const hits = await searchCode(cwd, searchKeywords, intent.targets);
      if (hits.length > 0) {
        const ctx = buildContext(userMessage, intent, hits, cwd);
        snippets = ctx.snippets;
      }
      log("RAG", `live grep: intent=${intent.type} snippets=${snippets.length}`);
    }
  } catch (err) {
    log("RAG", `search failed: ${(err as Error).message}`);
  }

  if (snippets.length === 0) {
    return { userMessage, intent, contextFileCount: 0 };
  }

  // ── Build injection ─────────────────────────────────────────────────────────
  //
  // ONLY inject simulated tool-turns for Priority 0 (direct file reads by exact
  // name). For BM25 / grep results we are not confident enough — injecting wrong
  // file content actively hurts because the model trusts the "already-read"
  // history and hallucinate based on irrelevant content.
  //
  // When no injection happens the model falls back to its own <read_file> /
  // <search_files> tools which are always accurate.

  const isDirectRead = snippets.every((s) =>
    directHitsSet.has(s.filePath),
  );

  if (!isDirectRead) {
    // BM25 / grep path — skip injection, let the model explore on its own
    return { userMessage, intent, contextFileCount: 0 };
  }

  const readTags = snippets.map((s) => `<read_file path="${s.filePath}"/>`).join("\n");

  const toolResultParts = ["Tool results:"];
  for (const s of snippets) {
    toolResultParts.push(
      `\nRead ${s.filePath}: OK (lines ${s.startLine}–${s.endLine})\n` +
      `\nContents of ${s.filePath}:\n\`\`\`${langTag(s.filePath)}\n${s.snippet}\n\`\`\``,
    );
  }

  // Instruction depends on whether this looks like a modification or a question
  const instruction = EDIT_INTENTS.has(intent.type)
    ? "Apply the requested change using edit_file or write_file. Do NOT output the file as text — emit the XML tag directly."
    : "Answer the user's question using ONLY the file content above. Be concise — summarize, do not dump the entire file.";

  toolResultParts.push(`\n${instruction}`);

  return {
    userMessage,
    injectedTurns: [
      { role: "assistant", content: readTags },
      { role: "user", content: toolResultParts.join("\n") },
    ],
    intent,
    contextFileCount: snippets.length,
    contextFiles: snippets.map((s) => s.filePath),
  };
}
