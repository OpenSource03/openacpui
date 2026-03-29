export interface CrawlResult {
  url: string;
  title: string;
  content: string;
  provider: string;
}

export interface CrawlProvider {
  id: string;
  crawl(url: string, timeoutMs: number): Promise<CrawlResult>;
}
