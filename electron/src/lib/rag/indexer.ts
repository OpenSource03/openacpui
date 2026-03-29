/**
 * Local codebase indexer with BM25 ranking.
 *
 * Flow:
 *   triggerIndex(cwd)  → background build, non-blocking
 *   searchIndex(cwd, query, topK)  → BM25 ranked results
 *   isIndexReady(cwd)  → true when index is loaded in memory
 *
 * Storage: {userData}/openacpui-data/rag-index/{cwdHash}/index.json
 * TTL: 5 minutes (refreshed in background on next session start)
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { getDataDir } from "../data-dir";
import { log } from "../logger";

// ── BM25 constants ────────────────────────────────────────────────────────────
const K1 = 1.5;
const B = 0.75;

// ── Index constants ───────────────────────────────────────────────────────────
const INDEX_VERSION = 3;
const INDEX_TTL_MS = 5 * 60 * 1000;   // 5 min TTL
const CHUNK_LINES = 60;                // target lines per chunk
const CHUNK_OVERLAP = 8;               // overlap for context continuity
const MAX_FILE_BYTES = 150_000;        // skip files > 150 KB
const MAX_FILES = 3000;
const MAX_VOCAB = 20_000;              // max unique terms to index

const SKIP_EXTS = new Set([
  ".png",".jpg",".jpeg",".gif",".ico",".webp",".svg",
  ".woff",".woff2",".ttf",".eot",".otf",
  ".mp4",".mp3",".wav",".avi",
  ".lock",".bin",".exe",".dll",".so",".dylib",
  ".zip",".tar",".gz",".rar",".pdf",
  ".frx",".frf",".xlsx",".docx",
]);

const SKIP_DIRS = new Set([
  "node_modules",".git","dist","build","vendor",".next",
  "__pycache__","target","bin","obj",
]);

function isCodeFile(name: string): boolean {
  return !SKIP_EXTS.has(path.extname(name).toLowerCase());
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChunkMeta {
  id: number;
  file: string;
  startLine: number;
  endLine: number;
  /** Approx token count for BM25 normalization */
  length: number;
}

interface RagIndex {
  version: number;
  builtAt: number;
  cwd: string;
  chunks: ChunkMeta[];
  /** Average chunk length in tokens */
  avgLength: number;
  /** term → number of chunks containing it */
  df: Record<string, number>;
  /** term → [[chunkId, termFrequency], ...] */
  invertedIndex: Record<string, Array<[number, number]>>;
  /** file → mtime ms (for future incremental updates) */
  fileMtimes: Record<string, number>;
}

export interface IndexedSearchResult {
  file: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

// ── In-memory state ───────────────────────────────────────────────────────────

const indexCache = new Map<string, RagIndex>();
const building = new Set<string>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function cwdHash(cwd: string): string {
  return crypto.createHash("md5").update(cwd).digest("hex").slice(0, 12);
}

function getIndexDir(cwd: string): string {
  const dir = path.join(getDataDir(), "rag-index", cwdHash(cwd));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && t.length < 40);
}

// ── File listing ──────────────────────────────────────────────────────────────

function listFiles(cwd: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout) => {
        if (!err && stdout) {
          const files = stdout
            .trim()
            .split("\n")
            .filter((f) => f && isCodeFile(f))
            .slice(0, MAX_FILES);
          resolve(files);
          return;
        }
        // Fallback: recursive fs walk
        const files: string[] = [];
        function walk(dir: string, depth: number) {
          if (depth > 7 || files.length >= MAX_FILES) return;
          let entries: fs.Dirent[];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
          catch { return; }
          for (const entry of entries) {
            if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
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

// ── Chunking ──────────────────────────────────────────────────────────────────

function chunkLines(
  lines: string[],
): Array<{ startLine: number; endLine: number }> {
  if (lines.length <= CHUNK_LINES) {
    return [{ startLine: 1, endLine: lines.length }];
  }

  const chunks: Array<{ startLine: number; endLine: number }> = [];
  let i = 0;

  while (i < lines.length) {
    const start = i;
    let end = Math.min(i + CHUNK_LINES, lines.length);

    // Try to break at a natural boundary (blank line or top-level def)
    if (end < lines.length) {
      for (let j = end; j > start + Math.floor(CHUNK_LINES * 0.65); j--) {
        const line = lines[j - 1].trim();
        if (
          line === "" ||
          /^(export\s+)?(function|class|const|let|var|type|interface|def |func |fn |impl|public|private|protected|async function)\s/.test(line)
        ) {
          end = j;
          break;
        }
      }
    }

    if (start < end) {
      chunks.push({ startLine: start + 1, endLine: end });
    }

    i = end - CHUNK_OVERLAP;
    if (i <= start) i = end;
  }

  return chunks;
}

// ── Index build ───────────────────────────────────────────────────────────────

async function buildIndex(cwd: string): Promise<RagIndex> {
  const t0 = Date.now();
  const files = await listFiles(cwd);

  const chunksMeta: ChunkMeta[] = [];
  const df: Record<string, number> = Object.create(null);
  const invertedIndex: Record<string, Array<[number, number]>> = Object.create(null);
  const fileMtimes: Record<string, number> = {};
  const termDocSeen = new Map<string, Set<number>>(); // for df counting

  let chunkId = 0;
  let totalTokens = 0;

  for (const file of files) {
    const abs = path.resolve(cwd, file);
    let stat: fs.Stats;
    let content: string;
    try {
      stat = fs.statSync(abs);
      if (stat.size > MAX_FILE_BYTES) continue;
      content = fs.readFileSync(abs, "utf-8");
    } catch {
      continue;
    }

    fileMtimes[file] = stat.mtimeMs;
    const lines = content.split("\n");
    const chunks = chunkLines(lines);

    for (const chunk of chunks) {
      const text = lines.slice(chunk.startLine - 1, chunk.endLine).join("\n");
      const tokens = tokenize(text);
      if (tokens.length < 3) continue;

      const tf: Record<string, number> = {};
      for (const token of tokens) {
        tf[token] = (tf[token] ?? 0) + 1;
      }

      const id = chunkId++;
      chunksMeta.push({ id, file, startLine: chunk.startLine, endLine: chunk.endLine, length: tokens.length });
      totalTokens += tokens.length;

      for (const [term, freq] of Object.entries(tf)) {
        if (Object.keys(df).length >= MAX_VOCAB && !(term in df)) continue;
        if (!termDocSeen.has(term)) termDocSeen.set(term, new Set());
        termDocSeen.get(term)!.add(id);
        if (!invertedIndex[term]) invertedIndex[term] = [];
        invertedIndex[term].push([id, freq]);
      }
    }
  }

  // Build df from termDocSeen
  for (const [term, set] of termDocSeen) {
    df[term] = set.size;
  }

  const avgLength = chunkId > 0 ? totalTokens / chunkId : 0;
  const index: RagIndex = {
    version: INDEX_VERSION,
    builtAt: Date.now(),
    cwd,
    chunks: chunksMeta,
    avgLength,
    df,
    invertedIndex,
    fileMtimes,
  };

  try {
    const indexPath = path.join(getIndexDir(cwd), "index.json");
    fs.writeFileSync(indexPath, JSON.stringify(index), "utf-8");
  } catch (err) {
    log("RAG_INDEX", `save failed: ${(err as Error).message}`);
  }

  log("RAG_INDEX", `built: ${files.length} files, ${chunkId} chunks, ${Date.now() - t0}ms`);
  return index;
}

function loadFromDisk(cwd: string): RagIndex | null {
  try {
    const indexPath = path.join(getIndexDir(cwd), "index.json");
    const raw = fs.readFileSync(indexPath, "utf-8");
    const idx = JSON.parse(raw) as RagIndex;
    if (idx.version !== INDEX_VERSION) return null;
    if (Date.now() - idx.builtAt > INDEX_TTL_MS) return null;
    return idx;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start indexing a project in the background.
 * Returns immediately — index will be available shortly.
 */
export function triggerIndex(cwd: string): void {
  if (building.has(cwd)) return;

  // Check in-memory cache
  const cached = indexCache.get(cwd);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return;

  // Try loading from disk (fast path)
  const onDisk = loadFromDisk(cwd);
  if (onDisk) {
    indexCache.set(cwd, onDisk);
    return;
  }

  // Build in background, never block the caller
  building.add(cwd);
  buildIndex(cwd)
    .then((idx) => indexCache.set(cwd, idx))
    .catch((err) => log("RAG_INDEX", `build error: ${(err as Error).message}`))
    .finally(() => building.delete(cwd));
}

/** Invalidate cache for a project (e.g. after files change) */
export function invalidateIndex(cwd: string): void {
  indexCache.delete(cwd);
  try {
    const indexPath = path.join(getIndexDir(cwd), "index.json");
    fs.unlinkSync(indexPath);
  } catch { /* ok */ }
}

export function isIndexReady(cwd: string): boolean {
  return indexCache.has(cwd);
}

/**
 * BM25 search over the indexed codebase.
 * Returns empty array if index is not ready yet (will be ready on next turn).
 */
export function searchIndex(
  cwd: string,
  query: string,
  topK = 5,
): IndexedSearchResult[] {
  const index = indexCache.get(cwd);
  if (!index) return [];

  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) return [];

  const N = index.chunks.length;
  const scores = new Map<number, number>();

  for (const term of queryTokens) {
    const postings = index.invertedIndex[term];
    if (!postings || postings.length === 0) continue;

    const df = index.df[term] ?? 1;
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

    for (const [chunkId, tf] of postings) {
      const chunk = index.chunks[chunkId];
      if (!chunk) continue;
      const norm = 1 - B + B * (chunk.length / index.avgLength);
      const tfNorm = (tf * (K1 + 1)) / (tf + K1 * norm);
      scores.set(chunkId, (scores.get(chunkId) ?? 0) + idf * tfNorm);
    }
  }

  // Keep best chunk per file to avoid repeating the same file
  const bestPerFile = new Map<string, { score: number; chunkId: number }>();
  for (const [chunkId, score] of scores) {
    const chunk = index.chunks[chunkId];
    if (!chunk) continue;
    const prev = bestPerFile.get(chunk.file);
    if (!prev || score > prev.score) {
      bestPerFile.set(chunk.file, { score, chunkId });
    }
  }

  const ranked = [...bestPerFile.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const results: IndexedSearchResult[] = [];
  for (const { score, chunkId } of ranked) {
    const meta = index.chunks[chunkId];
    if (!meta) continue;
    try {
      const abs = path.resolve(cwd, meta.file);
      const content = fs.readFileSync(abs, "utf-8");
      const lines = content.split("\n");
      const snippet = lines.slice(meta.startLine - 1, meta.endLine).join("\n");
      results.push({ file: meta.file, startLine: meta.startLine, endLine: meta.endLine, score, snippet });
    } catch {
      // file deleted since indexing
    }
  }

  return results;
}
