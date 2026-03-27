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

// ── Main export ───────────────────────────────────────────────────────────────

export async function augmentWithRag(
  userMessage: string,
  cwd: string,
): Promise<AugmentResult> {
  const intent = detectIntent(userMessage);

  // ── Search ──────────────────────────────────────────────────────────────────
  let snippets: Array<{ filePath: string; snippet: string; startLine: number; endLine: number }> = [];

  try {
    if (isIndexReady(cwd)) {
      // Path 1: BM25 indexed search — best quality
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

  // ── Always use tool-turns format ───────────────────────────────────────────
  // The model understands any language — let it decide whether to explain or
  // apply changes. The tool-turns format primes it to use edit_file/write_file
  // when the user asks for a modification, and respond in text when they ask
  // a question. Single-turn "answer based on content" blocks tool usage.

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
    ? "Apply the requested change using edit_file or write_file. Do NOT show the result as text — emit the tool tag directly."
    : "If the task requires modifying a file, use edit_file or write_file. If it is a question, answer in text using only the contents above.";

  toolResultParts.push(`\n${instruction}`);

  return {
    userMessage,
    injectedTurns: [
      { role: "assistant", content: readTags },
      { role: "user", content: toolResultParts.join("\n") },
    ],
    intent,
    contextFileCount: snippets.length,
  };
}
