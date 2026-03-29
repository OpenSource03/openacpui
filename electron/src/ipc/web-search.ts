import { ipcMain } from "electron";
import { getAppSetting } from "../lib/app-settings";
import type { WebSearchProvider, WebSearchProviderConfig } from "../lib/app-settings";
import { log } from "../lib/logger";

let cacheModule: typeof import("../lib/rag/search-cache") | null = null;
try {
  cacheModule = require("../lib/rag/search-cache") as typeof import("../lib/rag/search-cache");
} catch {}

async function testSearxng(config: WebSearchProviderConfig): Promise<{ ok: boolean; count?: number; ms?: number; error?: string }> {
  const baseUrl = (config.baseUrl || "http://localhost:8080").replace(/\/$/, "");
  const start = Date.now();
  const response = await fetch(`${baseUrl}/search?q=test&format=json&categories=general`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { results?: unknown[] };
  return { ok: true, count: data.results?.length ?? 0, ms: Date.now() - start };
}

async function testDdgHtml(): Promise<{ ok: boolean; count?: number; ms?: number; error?: string }> {
  const start = Date.now();
  const response = await fetch("https://html.duckduckgo.com/html/?q=test", {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Harnss/1.0)" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const matches = html.match(/class="result__a"/g);
  return { ok: true, count: matches?.length ?? 0, ms: Date.now() - start };
}

async function testDdgApi(): Promise<{ ok: boolean; count?: number; ms?: number; error?: string }> {
  const start = Date.now();
  const response = await fetch("https://api.duckduckgo.com/?q=test&format=json&no_html=1&t=harnss", {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { RelatedTopics?: unknown[]; Results?: unknown[] };
  const count = (data.Results?.length ?? 0) + (data.RelatedTopics?.length ?? 0);
  return { ok: true, count, ms: Date.now() - start };
}

async function testBrave(config: WebSearchProviderConfig): Promise<{ ok: boolean; count?: number; ms?: number; error?: string }> {
  const apiKey = config.apiKey;
  if (!apiKey) return { ok: false, error: "No API key configured" };
  const start = Date.now();
  const response = await fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=3", {
    signal: AbortSignal.timeout(8000),
    headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 100)}`);
  }
  const data = (await response.json()) as { web?: { results?: unknown[] } };
  return { ok: true, count: data.web?.results?.length ?? 0, ms: Date.now() - start };
}

async function testTavily(config: WebSearchProviderConfig): Promise<{ ok: boolean; count?: number; ms?: number; error?: string }> {
  const apiKey = config.apiKey;
  if (!apiKey) return { ok: false, error: "No API key configured" };
  const start = Date.now();
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query: "test", max_results: 3 }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 100)}`);
  }
  const data = (await response.json()) as { results?: unknown[] };
  return { ok: true, count: data.results?.length ?? 0, ms: Date.now() - start };
}

async function testGoogleCse(config: WebSearchProviderConfig): Promise<{ ok: boolean; count?: number; ms?: number; error?: string }> {
  const apiKey = config.apiKey;
  if (!apiKey) return { ok: false, error: "No API key configured (format: key:cx)" };
  const [key, cx] = apiKey.split(":");
  if (!key || !cx) return { ok: false, error: "API key must be in format key:cx" };
  const start = Date.now();
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=test&num=3`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 100)}`);
  }
  const data = (await response.json()) as { items?: unknown[] };
  return { ok: true, count: data.items?.length ?? 0, ms: Date.now() - start };
}

export function register(): void {
  ipcMain.handle("web-search:test", async (_event, providerId: string) => {
    const webSearch = getAppSetting("webSearch");
    const config = webSearch.providers.find((p) => p.id === providerId);
    if (!config) return { ok: false, error: "Provider not found" };

    try {
      switch (providerId as WebSearchProvider) {
        case "searxng": return await testSearxng(config);
        case "ddg-html": return await testDdgHtml();
        case "ddg-api": return await testDdgApi();
        case "brave": return await testBrave(config);
        case "tavily": return await testTavily(config);
        case "google-cse": return await testGoogleCse(config);
        default: return { ok: false, error: `Unknown provider: ${providerId}` };
      }
    } catch (err) {
      log("WEB_SEARCH_TEST", `${providerId} failed: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("web-search:history", async (_event, limit?: number) => {
    return cacheModule?.getSearchHistory(limit ?? 50) ?? [];
  });

  ipcMain.handle("web-search:stats", async () => {
    return cacheModule?.getCacheStats() ?? {
      totalEntries: 0, totalSearches: 0, cacheHits: 0, cacheMisses: 0,
      hitRate: "0%", providerBreakdown: [], dbSizeBytes: 0,
    };
  });

  ipcMain.handle("web-search:clear-expired", async () => {
    return { removed: cacheModule?.clearExpired() ?? 0 };
  });

  ipcMain.handle("web-search:clear-all", async () => {
    cacheModule?.clearAll();
    return { ok: true };
  });

  ipcMain.handle("crawler:test", async (_event, providerId: string) => {
    const { crawlUrl: doCrawl } = await import("../lib/rag/web-crawl");
    const testUrl = "https://example.com";
    try {
      const start = Date.now();
      const result = await doCrawl(testUrl);
      return { ok: true, chars: result.content.length, ms: Date.now() - start, provider: result.provider };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  let crawlCacheModule: typeof import("../lib/rag/crawl-cache") | null = null;
  try { crawlCacheModule = require("../lib/rag/crawl-cache") as typeof import("../lib/rag/crawl-cache"); } catch {}

  ipcMain.handle("crawler:history", async (_event, limit?: number) => {
    return crawlCacheModule?.getCrawlHistory(limit ?? 30) ?? [];
  });

  ipcMain.handle("crawler:stats", async () => {
    return crawlCacheModule?.getCrawlStats() ?? { totalEntries: 0, totalChars: 0, dbSizeBytes: 0 };
  });

  ipcMain.handle("crawler:clear-all", async () => {
    crawlCacheModule?.clearAll();
    return { ok: true };
  });
}
