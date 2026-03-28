import type { SearchProvider, SearchResponse } from "./types";

export function createTavily(apiKey: string): SearchProvider {
  return {
    id: "tavily",
    async search(query, maxResults, timeoutMs) {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
      });
      if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);

      const data = (await response.json()) as {
        answer?: string;
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };

      return {
        query,
        abstract: data.answer ?? "",
        abstractUrl: "",
        provider: "tavily",
        results: (data.results ?? []).slice(0, maxResults).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.content ?? "",
        })).filter((r) => r.title && r.url),
      };
    },
  };
}
