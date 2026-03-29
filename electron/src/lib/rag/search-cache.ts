import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { getDataDir } from "../data-dir";
import { log } from "../logger";

export interface CachedResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchCacheEntry {
  id: number;
  query: string;
  queryNormalized: string;
  provider: string;
  abstract: string;
  abstractUrl: string;
  results: CachedResult[];
  cachedAt: number;
  ttl: number;
  hitCount: number;
  lastHitAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

let db: Database.Database | null = null;

function dbPath(): string {
  return path.join(getDataDir(), "search-cache.db");
}

function getDb(): Database.Database {
  if (db) return db;

  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      query_normalized TEXT NOT NULL,
      provider TEXT NOT NULL,
      abstract TEXT DEFAULT '',
      abstract_url TEXT DEFAULT '',
      results_json TEXT NOT NULL DEFAULT '[]',
      cached_at INTEGER NOT NULL,
      ttl INTEGER NOT NULL,
      hit_count INTEGER DEFAULT 0,
      last_hit_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_searches_normalized_provider
      ON searches(query_normalized, provider);

    CREATE INDEX IF NOT EXISTS idx_searches_normalized
      ON searches(query_normalized);

    CREATE INDEX IF NOT EXISTS idx_searches_cached_at
      ON searches(cached_at DESC);

    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0
    );

    INSERT OR IGNORE INTO stats(key, value) VALUES ('total_searches', 0);
    INSERT OR IGNORE INTO stats(key, value) VALUES ('cache_hits', 0);
    INSERT OR IGNORE INTO stats(key, value) VALUES ('cache_misses', 0);
  `);

  return db;
}

function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}

function incStat(key: string): void {
  getDb().prepare("UPDATE stats SET value = value + 1 WHERE key = ?").run(key);
}

function getStat(key: string): number {
  const row = getDb().prepare("SELECT value FROM stats WHERE key = ?").get(key) as { value: number } | undefined;
  return row?.value ?? 0;
}

export function getCached(query: string, provider: string): SearchCacheEntry | null {
  const d = getDb();
  const normalized = normalizeQuery(query);
  const now = Date.now();

  incStat("total_searches");

  const row = d.prepare(`
    SELECT * FROM searches
    WHERE query_normalized = ? AND provider = ?
    ORDER BY cached_at DESC LIMIT 1
  `).get(normalized, provider) as Record<string, unknown> | undefined;

  if (!row) {
    incStat("cache_misses");
    return null;
  }

  const cachedAt = row.cached_at as number;
  const ttl = row.ttl as number;
  if (now - cachedAt > ttl) {
    d.prepare("DELETE FROM searches WHERE id = ?").run(row.id);
    incStat("cache_misses");
    return null;
  }

  d.prepare("UPDATE searches SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?").run(now, row.id);
  incStat("cache_hits");

  const entry = rowToEntry(row);
  log("SEARCH_CACHE", `hit: "${query}" [${provider}] (${entry.results.length} results, ${Math.round((now - cachedAt) / 60000)}m ago)`);
  return entry;
}

export function getCachedAnyProvider(query: string): SearchCacheEntry | null {
  const d = getDb();
  const normalized = normalizeQuery(query);
  const now = Date.now();

  const row = d.prepare(`
    SELECT * FROM searches
    WHERE query_normalized = ? AND (cached_at + ttl) > ?
    ORDER BY cached_at DESC LIMIT 1
  `).get(normalized, now) as Record<string, unknown> | undefined;

  if (!row) return null;

  d.prepare("UPDATE searches SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?").run(now, row.id);
  incStat("cache_hits");
  incStat("total_searches");

  const entry = rowToEntry(row);
  log("SEARCH_CACHE", `cross-provider hit: "${query}" [${entry.provider}]`);
  return entry;
}

export function putCache(
  query: string,
  provider: string,
  abstract: string,
  abstractUrl: string,
  results: CachedResult[],
  ttl = DEFAULT_TTL_MS,
): void {
  const d = getDb();
  const normalized = normalizeQuery(query);
  const now = Date.now();

  d.prepare(`
    DELETE FROM searches WHERE query_normalized = ? AND provider = ?
  `).run(normalized, provider);

  d.prepare(`
    INSERT INTO searches (query, query_normalized, provider, abstract, abstract_url, results_json, cached_at, ttl, hit_count, last_hit_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(query, normalized, provider, abstract, abstractUrl, JSON.stringify(results), now, ttl, now);

  log("SEARCH_CACHE", `stored: "${query}" [${provider}] (${results.length} results, ttl=${Math.round(ttl / 60000)}m)`);

  const count = (d.prepare("SELECT COUNT(*) as c FROM searches").get() as { c: number }).c;
  if (count > 500) {
    d.prepare(`
      DELETE FROM searches WHERE id IN (
        SELECT id FROM searches ORDER BY last_hit_at ASC LIMIT ?
      )
    `).run(count - 500);
  }
}

export function searchInCache(queryFragment: string, limit = 20): SearchCacheEntry[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT * FROM searches
    WHERE query LIKE ? OR abstract LIKE ?
    ORDER BY cached_at DESC LIMIT ?
  `).all(`%${queryFragment}%`, `%${queryFragment}%`, limit) as Record<string, unknown>[];

  return rows.map(rowToEntry);
}

export function getSearchHistory(limit = 50): Array<{
  id: number;
  query: string;
  provider: string;
  resultCount: number;
  cachedAt: number;
  hitCount: number;
  expired: boolean;
}> {
  const d = getDb();
  const now = Date.now();
  const rows = d.prepare(`
    SELECT id, query, provider, results_json, cached_at, ttl, hit_count
    FROM searches ORDER BY cached_at DESC LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const results = JSON.parse(r.results_json as string) as unknown[];
    return {
      id: r.id as number,
      query: r.query as string,
      provider: r.provider as string,
      resultCount: results.length,
      cachedAt: r.cached_at as number,
      hitCount: r.hit_count as number,
      expired: now - (r.cached_at as number) > (r.ttl as number),
    };
  });
}

export function getCacheStats(): {
  totalEntries: number;
  totalSearches: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: string;
  providerBreakdown: Array<{ provider: string; count: number; avgResults: number }>;
  dbSizeBytes: number;
} {
  const d = getDb();
  const totalEntries = (d.prepare("SELECT COUNT(*) as c FROM searches").get() as { c: number }).c;
  const totalSearches = getStat("total_searches") || 1;
  const cacheHits = getStat("cache_hits");
  const cacheMisses = getStat("cache_misses");

  const providers = d.prepare(`
    SELECT provider, COUNT(*) as count,
           AVG(json_array_length(results_json)) as avg_results
    FROM searches GROUP BY provider
  `).all() as Array<{ provider: string; count: number; avg_results: number }>;

  let dbSize = 0;
  try { dbSize = fs.statSync(dbPath()).size; } catch {}

  return {
    totalEntries,
    totalSearches: getStat("total_searches"),
    cacheHits,
    cacheMisses,
    hitRate: `${Math.round((cacheHits / totalSearches) * 100)}%`,
    providerBreakdown: providers.map((p) => ({
      provider: p.provider,
      count: p.count,
      avgResults: Math.round(p.avg_results ?? 0),
    })),
    dbSizeBytes: dbSize,
  };
}

export function clearExpired(): number {
  const d = getDb();
  const now = Date.now();
  const info = d.prepare("DELETE FROM searches WHERE (cached_at + ttl) < ?").run(now);
  return info.changes;
}

export function clearAll(): void {
  const d = getDb();
  d.exec("DELETE FROM searches");
  d.exec("UPDATE stats SET value = 0");
}

export function exportDb(): string {
  return dbPath();
}

function rowToEntry(row: Record<string, unknown>): SearchCacheEntry {
  return {
    id: row.id as number,
    query: row.query as string,
    queryNormalized: row.query_normalized as string,
    provider: row.provider as string,
    abstract: row.abstract as string,
    abstractUrl: row.abstract_url as string,
    results: JSON.parse(row.results_json as string) as CachedResult[],
    cachedAt: row.cached_at as number,
    ttl: row.ttl as number,
    hitCount: row.hit_count as number,
    lastHitAt: row.last_hit_at as number,
  };
}
