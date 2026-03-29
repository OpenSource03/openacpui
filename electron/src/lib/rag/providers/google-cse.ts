import type { SearchProvider, SearchResponse } from "./types";

export function createGoogleCse(apiKeyAndCx: string): SearchProvider {
  const [key, cx] = apiKeyAndCx.split(":");

  return {
    id: "google-cse",
    async search(query, maxResults, timeoutMs) {
      if (!key || !cx) throw new Error("API key must be in format key:cx");

      const num = Math.min(maxResults, 10);
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${num}`;

      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`Google CSE HTTP ${response.status}`);

      const data = (await response.json()) as {
        items?: Array<{ title?: string; link?: string; snippet?: string }>;
      };

      return {
        query,
        abstract: "",
        abstractUrl: "",
        provider: "google-cse",
        results: (data.items ?? []).slice(0, maxResults).map((r) => ({
          title: r.title ?? "",
          url: r.link ?? "",
          snippet: r.snippet ?? "",
        })).filter((r) => r.title && r.url),
      };
    },
  };
}
