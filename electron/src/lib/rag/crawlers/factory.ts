import { getAppSetting } from "../../app-settings";
import type { CrawlerProviderConfig } from "../../app-settings";
import type { CrawlProvider } from "./types";
import { createJinaReader } from "./jina-reader";
import { createCrawl4ai } from "./crawl4ai";
import { createFirecrawl } from "./firecrawl";

function buildProvider(config: CrawlerProviderConfig): CrawlProvider | null {
  switch (config.id) {
    case "jina-reader":
      return createJinaReader();
    case "crawl4ai":
      return config.baseUrl ? createCrawl4ai(config.baseUrl) : null;
    case "firecrawl":
      return config.baseUrl ? createFirecrawl(config.baseUrl, config.apiKey) : null;
    default:
      return null;
  }
}

export function getEnabledCrawlers(): CrawlProvider[] {
  const crawler = getAppSetting("crawler");
  const providers: CrawlProvider[] = [];
  for (const config of crawler.providers) {
    if (!config.enabled) continue;
    const provider = buildProvider(config);
    if (provider) providers.push(provider);
  }
  return providers;
}

export function getCrawlerConfig(): { timeout: number } {
  const crawler = getAppSetting("crawler");
  return { timeout: crawler.timeout };
}
