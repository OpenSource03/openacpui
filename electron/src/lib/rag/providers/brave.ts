import type { SearchProvider, SearchResponse } from "./types";

export function createBrave(apiKey: string): SearchProvider {
  return {
    id: "brave",
    async search(query, maxResults, timeoutMs) {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
        {
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": apiKey,
          },
        },
      );
      if (!response.ok) throw new Error(`Brave HTTP ${response.status}`);

      const data = (await response.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
      };

      return {
        query,
        abstract: "",
        abstractUrl: "",
        provider: "brave",
        results: (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.description ?? "",
        })).filter((r) => r.title && r.url),
      };
    },
  };
}
