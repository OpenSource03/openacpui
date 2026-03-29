import type { CrawlProvider, CrawlResult } from "./types";

export function createJinaReader(): CrawlProvider {
  return {
    id: "jina-reader",
    async crawl(url, timeoutMs) {
      const response = await fetch(`https://r.jina.ai/${url}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "text/markdown",
          "X-Return-Format": "markdown",
        },
      });
      if (!response.ok) throw new Error(`Jina Reader HTTP ${response.status}`);

      const content = await response.text();
      const titleMatch = content.match(/^#\s+(.+)$/m);

      return {
        url,
        title: titleMatch?.[1] ?? url,
        content,
        provider: "jina-reader",
      };
    },
  };
}
