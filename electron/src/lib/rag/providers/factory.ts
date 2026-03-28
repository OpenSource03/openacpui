import { getAppSetting } from "../../app-settings";
import type { WebSearchProviderConfig } from "../../app-settings";
import type { SearchProvider } from "./types";
import { createSearxng } from "./searxng";
import { createDdgHtml } from "./ddg-html";
import { createDdgApi } from "./ddg-api";
import { createBrave } from "./brave";
import { createTavily } from "./tavily";
import { createGoogleCse } from "./google-cse";

function buildProvider(config: WebSearchProviderConfig): SearchProvider | null {
  switch (config.id) {
    case "searxng":
      return config.baseUrl ? createSearxng(config.baseUrl) : null;
    case "ddg-html":
      return createDdgHtml();
    case "ddg-api":
      return createDdgApi();
    case "brave":
      return config.apiKey ? createBrave(config.apiKey) : null;
    case "tavily":
      return config.apiKey ? createTavily(config.apiKey) : null;
    case "google-cse":
      return config.apiKey ? createGoogleCse(config.apiKey) : null;
    default:
      return null;
  }
}

export function getEnabledProviders(): SearchProvider[] {
  const webSearch = getAppSetting("webSearch");
  const providers: SearchProvider[] = [];

  for (const config of webSearch.providers) {
    if (!config.enabled) continue;
    const provider = buildProvider(config);
    if (provider) providers.push(provider);
  }

  return providers;
}

export function getSearchConfig(): { maxResults: number; timeout: number } {
  const webSearch = getAppSetting("webSearch");
  return { maxResults: webSearch.maxResults, timeout: webSearch.timeout };
}
