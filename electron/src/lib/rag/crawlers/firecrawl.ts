import type { CrawlProvider, CrawlResult } from "./types";

export function createFirecrawl(baseUrl: string, apiKey?: string): CrawlProvider {
  const url = baseUrl.replace(/\/$/, "");

  return {
    id: "firecrawl",
    async crawl(targetUrl, timeoutMs) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const response = await fetch(`${url}/v1/scrape`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers,
        body: JSON.stringify({ url: targetUrl, formats: ["markdown"] }),
      });
      if (!response.ok) throw new Error(`Firecrawl HTTP ${response.status}`);

      const data = (await response.json()) as {
        data?: { markdown?: string; metadata?: { title?: string } };
      };

      return {
        url: targetUrl,
        title: data.data?.metadata?.title ?? targetUrl,
        content: data.data?.markdown ?? "",
        provider: "firecrawl",
      };
    },
  };
}
