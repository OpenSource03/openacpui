/**
 * Web search via DuckDuckGo Instant Answer API.
 * No API key required. Best-effort — returns empty results on failure.
 */

const DDG_API = "https://api.duckduckgo.com/";
const TIMEOUT_MS = 8000;
const MAX_RESULTS = 6;

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  query: string;
  abstract: string;
  abstractUrl: string;
  results: WebResult[];
}

interface DdgResponse {
  Abstract?: string;
  AbstractURL?: string;
  AbstractText?: string;
  Results?: Array<{ Text?: string; FirstURL?: string }>;
  RelatedTopics?: Array<{
    Text?: string;
    FirstURL?: string;
    Name?: string;
    Topics?: Array<{ Text?: string; FirstURL?: string }>;
  }>;
}

function cleanText(s: string | undefined): string {
  return (s ?? "").replace(/<[^>]+>/g, "").trim();
}

export async function webSearch(query: string): Promise<WebSearchResult> {
  const url = new URL(DDG_API);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");
  url.searchParams.set("t", "harnss");

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Accept": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`DDG API error: HTTP ${response.status}`);
  }

  const data = (await response.json()) as DdgResponse;

  const results: WebResult[] = [];

  // Direct results (rare but high quality)
  for (const r of data.Results ?? []) {
    if (results.length >= MAX_RESULTS) break;
    const title = cleanText(r.Text);
    const url = r.FirstURL ?? "";
    if (title && url) results.push({ title, url, snippet: title });
  }

  // Related topics (most common source of results)
  for (const t of data.RelatedTopics ?? []) {
    if (results.length >= MAX_RESULTS) break;
    // Some topics are nested groups
    if (t.Topics) {
      for (const sub of t.Topics) {
        if (results.length >= MAX_RESULTS) break;
        const title = cleanText(sub.Text);
        const url = sub.FirstURL ?? "";
        if (title && url) results.push({ title, url, snippet: title });
      }
    } else {
      const title = cleanText(t.Text);
      const url = t.FirstURL ?? "";
      if (title && url) results.push({ title, url, snippet: title });
    }
  }

  return {
    query,
    abstract: cleanText(data.AbstractText ?? data.Abstract),
    abstractUrl: data.AbstractURL ?? "",
    results,
  };
}

/** Format a WebSearchResult as a compact string for injection into LLM context */
export function formatWebResults(result: WebSearchResult): string {
  const lines: string[] = [`Web search: "${result.query}"`];

  if (result.abstract) {
    lines.push(`\nSummary: ${result.abstract}`);
    if (result.abstractUrl) lines.push(`Source: ${result.abstractUrl}`);
  }

  if (result.results.length > 0) {
    lines.push("\nResults:");
    for (const r of result.results) {
      lines.push(`- ${r.title}`);
      lines.push(`  ${r.url}`);
    }
  }

  if (!result.abstract && result.results.length === 0) {
    lines.push("No results found.");
  }

  return lines.join("\n");
}
