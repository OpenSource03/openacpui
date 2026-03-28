import type { SearchProvider, SearchResponse } from "./types";

function cleanText(s: string | undefined): string {
  return (s ?? "").replace(/<[^>]+>/g, "").trim();
}

export function createDdgApi(): SearchProvider {
  return {
    id: "ddg-api",
    async search(query, maxResults, timeoutMs) {
      const url = new URL("https://api.duckduckgo.com/");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("no_html", "1");
      url.searchParams.set("skip_disambig", "1");
      url.searchParams.set("t", "harnss");

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`DDG API HTTP ${response.status}`);

      const data = (await response.json()) as {
        Abstract?: string;
        AbstractURL?: string;
        AbstractText?: string;
        Results?: Array<{ Text?: string; FirstURL?: string }>;
        RelatedTopics?: Array<{
          Text?: string;
          FirstURL?: string;
          Topics?: Array<{ Text?: string; FirstURL?: string }>;
        }>;
      };

      const results: Array<{ title: string; url: string; snippet: string }> = [];

      for (const r of data.Results ?? []) {
        if (results.length >= maxResults) break;
        const title = cleanText(r.Text);
        const rUrl = r.FirstURL ?? "";
        if (title && rUrl) results.push({ title, url: rUrl, snippet: title });
      }

      for (const t of data.RelatedTopics ?? []) {
        if (results.length >= maxResults) break;
        if (t.Topics) {
          for (const sub of t.Topics) {
            if (results.length >= maxResults) break;
            const title = cleanText(sub.Text);
            const sUrl = sub.FirstURL ?? "";
            if (title && sUrl) results.push({ title, url: sUrl, snippet: title });
          }
        } else {
          const title = cleanText(t.Text);
          const tUrl = t.FirstURL ?? "";
          if (title && tUrl) results.push({ title, url: tUrl, snippet: title });
        }
      }

      return {
        query,
        abstract: cleanText(data.AbstractText ?? data.Abstract),
        abstractUrl: data.AbstractURL ?? "",
        provider: "ddg-api",
        results,
      };
    },
  };
}
