import type { CrawlProvider, CrawlResult } from "./types";

export function createCrawl4ai(baseUrl: string): CrawlProvider {
  const url = baseUrl.replace(/\/$/, "");

  return {
    id: "crawl4ai",
    async crawl(targetUrl, timeoutMs) {
      const response = await fetch(`${url}/crawl`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: [targetUrl], priority: 10 }),
      });
      if (!response.ok) throw new Error(`Crawl4AI HTTP ${response.status}`);

      const data = (await response.json()) as {
        results?: Array<{ markdown?: string; metadata?: { title?: string } }>;
      };
      const result = data.results?.[0];

      return {
        url: targetUrl,
        title: result?.metadata?.title ?? targetUrl,
        content: result?.markdown ?? "",
        provider: "crawl4ai",
      };
    },
  };
}
