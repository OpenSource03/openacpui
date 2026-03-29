import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { getDataDir } from "../data-dir";
import { log } from "../logger";

import type { CrawlResult } from "./crawlers/types";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let db: Database.Database | null = null;

function dbPath(): string {
  return path.join(getDataDir(), "crawl-cache.db");
}

function getDb(): Database.Database {
  if (db) return db;

  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS crawls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      url_normalized TEXT NOT NULL,
      provider TEXT NOT NULL,
      title TEXT DEFAULT '',
      content TEXT NOT NULL,
      content_length INTEGER NOT NULL,
      cached_at INTEGER NOT NULL,
      ttl INTEGER NOT NULL,
      hit_count INTEGER DEFAULT 0,
      last_hit_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_crawls_url ON crawls(url_normalized);
    CREATE INDEX IF NOT EXISTS idx_crawls_cached_at ON crawls(cached_at DESC);
  `);

  return db;
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().trim().replace(/\/$/, "").replace(/^https?:\/\//, "");
}

export function getCachedCrawl(url: string): CrawlResult | null {
  const d = getDb();
  const normalized = normalizeUrl(url);
  const now = Date.now();

  const row = d.prepare(`
    SELECT * FROM crawls WHERE url_normalized = ? AND (cached_at + ttl) > ? ORDER BY cached_at DESC LIMIT 1
  `).get(normalized, now) as Record<string, unknown> | undefined;

  if (!row) return null;

  d.prepare("UPDATE crawls SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?").run(now, row.id);

  log("CRAWL_CACHE", `hit: "${url}" [${row.provider}] (${row.content_length} chars)`);

  return {
    url: row.url as string,
    title: row.title as string,
    content: row.content as string,
    provider: row.provider as string,
  };
}

export function putCrawl(url: string, provider: string, title: string, content: string, ttl = DEFAULT_TTL_MS): void {
  const d = getDb();
  const normalized = normalizeUrl(url);
  const now = Date.now();

  d.prepare("DELETE FROM crawls WHERE url_normalized = ?").run(normalized);

  d.prepare(`
    INSERT INTO crawls (url, url_normalized, provider, title, content, content_length, cached_at, ttl, hit_count, last_hit_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(url, normalized, provider, title, content, content.length, now, ttl, now);

  log("CRAWL_CACHE", `stored: "${url}" [${provider}] (${content.length} chars, ttl=${Math.round(ttl / 3600000)}h)`);

  const count = (d.prepare("SELECT COUNT(*) as c FROM crawls").get() as { c: number }).c;
  if (count > 200) {
    d.prepare("DELETE FROM crawls WHERE id IN (SELECT id FROM crawls ORDER BY last_hit_at ASC LIMIT ?)").run(count - 200);
  }
}

export function getCrawlHistory(limit = 30): Array<{
  id: number; url: string; provider: string; contentLength: number;
  cachedAt: number; hitCount: number; expired: boolean;
}> {
  const d = getDb();
  const now = Date.now();
  return (d.prepare("SELECT id, url, provider, content_length, cached_at, ttl, hit_count FROM crawls ORDER BY cached_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>)
    .map((r) => ({
      id: r.id as number,
      url: r.url as string,
      provider: r.provider as string,
      contentLength: r.content_length as number,
      cachedAt: r.cached_at as number,
      hitCount: r.hit_count as number,
      expired: now - (r.cached_at as number) > (r.ttl as number),
    }));
}

export function getCrawlStats(): {
  totalEntries: number; totalChars: number; dbSizeBytes: number;
} {
  const d = getDb();
  const row = d.prepare("SELECT COUNT(*) as c, COALESCE(SUM(content_length),0) as chars FROM crawls").get() as { c: number; chars: number };
  let dbSize = 0;
  try { dbSize = fs.statSync(dbPath()).size; } catch {}
  return { totalEntries: row.c, totalChars: row.chars, dbSizeBytes: dbSize };
}

export function clearAll(): void {
  getDb().exec("DELETE FROM crawls");
}
