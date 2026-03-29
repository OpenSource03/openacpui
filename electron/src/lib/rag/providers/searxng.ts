import type { SearchProvider, SearchResponse } from "./types";

export function createSearxng(baseUrl: string): SearchProvider {
  const url = baseUrl.replace(/\/$/, "");

  return {
    id: "searxng",
    async search(query, maxResults, timeoutMs) {
      const searchUrl = `${url}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
      const response = await fetch(searchUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);

      const data = (await response.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };

      return {
        query,
        abstract: "",
        abstractUrl: "",
        provider: "searxng",
        results: (data.results ?? []).slice(0, maxResults).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.content ?? "",
        })).filter((r) => r.title && r.url),
      };
    },
  };
}
