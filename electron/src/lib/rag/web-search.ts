import { log } from "../logger";
import { getEnabledProviders, getSearchConfig } from "./providers/factory";
import type { SearchResponse } from "./providers/types";

let cacheModule: typeof import("./search-cache") | null = null;
try {
  cacheModule = require("./search-cache") as typeof import("./search-cache");
} catch (err) {
  log("SEARCH_CACHE", `SQLite cache unavailable: ${(err as Error).message}`);
}

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
  cached?: boolean;
  provider?: string;
}

export async function webSearch(query: string): Promise<WebSearchResult> {
  try {
    const cached = cacheModule?.getCachedAnyProvider(query);
    if (cached) {
      log("WEB_SEARCH", `cache hit: "${query}" [${cached.provider}]`);
      return {
        query,
        abstract: cached.abstract,
        abstractUrl: cached.abstractUrl,
        results: cached.results,
        cached: true,
        provider: cached.provider,
      };
    }
  } catch {}

  const providers = getEnabledProviders();
  const { maxResults, timeout } = getSearchConfig();

  if (providers.length === 0) {
    throw new Error("No search providers enabled — configure in Settings > Web Search");
  }

  const errors: string[] = [];

  for (const provider of providers) {
    try {
      log("WEB_SEARCH", `trying ${provider.id} for "${query}"`);
      const response = await provider.search(query, maxResults, timeout);
      log("WEB_SEARCH", `${provider.id}: ${response.results.length} results`);

      try {
        if (cacheModule && (response.results.length > 0 || response.abstract)) {
          cacheModule.putCache(query, provider.id, response.abstract, response.abstractUrl, response.results);
        }
      } catch {}

      return toWebSearchResult(response);
    } catch (err) {
      const msg = `${provider.id}: ${(err as Error).message}`;
      log("WEB_SEARCH", `${msg} — trying next provider`);
      errors.push(msg);
    }
  }

  throw new Error(`All providers failed:\n${errors.join("\n")}`);
}

function toWebSearchResult(response: SearchResponse): WebSearchResult {
  return {
    query: response.query,
    abstract: response.abstract,
    abstractUrl: response.abstractUrl,
    results: response.results,
    provider: response.provider,
  };
}

export function formatWebResults(result: WebSearchResult): string {
  const lines: string[] = [`Web search: "${result.query}"`];
  if (result.cached) lines.push("(cached)");
  if (result.provider) lines.push(`Provider: ${result.provider}`);

  if (result.abstract) {
    lines.push(`\nSummary: ${result.abstract}`);
    if (result.abstractUrl) lines.push(`Source: ${result.abstractUrl}`);
  }

  if (result.results.length > 0) {
    lines.push("\nResults:");
    for (const r of result.results) {
      lines.push(`- ${r.title}`);
      if (r.snippet && r.snippet !== r.title) lines.push(`  ${r.snippet}`);
      lines.push(`  ${r.url}`);
    }
  }

  if (!result.abstract && result.results.length === 0) {
    lines.push("No results found.");
  }

  return lines.join("\n");
}
