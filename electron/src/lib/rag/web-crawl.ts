import { log } from "../logger";
import { getEnabledCrawlers, getCrawlerConfig } from "./crawlers/factory";
import type { CrawlResult } from "./crawlers/types";

let cacheModule: typeof import("./crawl-cache") | null = null;
try {
  cacheModule = require("./crawl-cache") as typeof import("./crawl-cache");
} catch (err) {
  log("CRAWL_CACHE", `SQLite cache unavailable: ${(err as Error).message}`);
}

export type { CrawlResult };

export async function crawlUrl(url: string): Promise<CrawlResult> {
  try {
    const cached = cacheModule?.getCachedCrawl(url);
    if (cached) {
      log("WEB_CRAWL", `cache hit: "${url}" [${cached.provider}]`);
      return cached;
    }
  } catch {}

  const providers = getEnabledCrawlers();
  const { timeout } = getCrawlerConfig();

  if (providers.length === 0) {
    throw new Error("No crawler providers enabled — configure in Settings > Crawler");
  }

  const errors: string[] = [];

  for (const provider of providers) {
    try {
      log("WEB_CRAWL", `trying ${provider.id} for "${url}"`);
      const result = await provider.crawl(url, timeout);
      log("WEB_CRAWL", `${provider.id}: ${result.content.length} chars`);

      try {
        if (cacheModule && result.content.length > 0) {
          cacheModule.putCrawl(url, result.provider, result.title, result.content);
        }
      } catch {}

      return result;
    } catch (err) {
      const msg = `${provider.id}: ${(err as Error).message}`;
      log("WEB_CRAWL", `${msg} — trying next provider`);
      errors.push(msg);
    }
  }

  throw new Error(`All crawlers failed:\n${errors.join("\n")}`);
}
