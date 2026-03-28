export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  abstract: string;
  abstractUrl: string;
  results: SearchResult[];
  provider: string;
}

export interface SearchProvider {
  id: string;
  search(query: string, maxResults: number, timeoutMs: number): Promise<SearchResponse>;
}
