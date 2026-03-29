import type { SearchProvider, SearchResponse } from "./types";

export function createDdgHtml(): SearchProvider {
  return {
    id: "ddg-html",
    async search(query, maxResults, timeoutMs) {
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Harnss/1.0)" },
      });
      if (!response.ok) throw new Error(`DDG HTML HTTP ${response.status}`);

      const html = await response.text();
      const results: Array<{ title: string; url: string; snippet: string }> = [];

      const blockRe = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;
      while ((m = blockRe.exec(html)) !== null && results.length < maxResults) {
        const rawUrl = m[1];
        const title = m[2].replace(/<[^>]+>/g, "").trim();
        const snippet = m[3].replace(/<[^>]+>/g, "").trim();
        const urlMatch = rawUrl.match(/uddg=([^&]+)/);
        const url = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
        if (title && url) results.push({ title, url, snippet });
      }

      return {
        query,
        abstract: "",
        abstractUrl: "",
        provider: "ddg-html",
        results,
      };
    },
  };
}
