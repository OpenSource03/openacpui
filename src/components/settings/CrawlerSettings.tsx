import { memo, useState, useCallback, useEffect } from "react";
import { GripVertical, TestTube, ChevronDown, ChevronRight, Database, Trash2, Clock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow } from "@/components/settings/shared";
import type { AppSettings, CrawlerProviderConfig, CrawlerProviderId } from "@/types/ui";

interface CrawlerSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const PROVIDER_META: Record<CrawlerProviderId, { label: string; description: string; hasUrl: boolean; hasKey: boolean; urlPlaceholder?: string }> = {
  "jina-reader": {
    label: "Jina Reader",
    description: "Free URL-to-markdown proxy. Prepends r.jina.ai/ to any URL. No setup needed, no API key.",
    hasUrl: false,
    hasKey: false,
  },
  "crawl4ai": {
    label: "Crawl4AI",
    description: "Self-hosted crawler with JavaScript rendering via Playwright. Docker: docker run crawl4ai/crawl4ai",
    hasUrl: true,
    hasKey: false,
    urlPlaceholder: "http://localhost:11235",
  },
  firecrawl: {
    label: "Firecrawl",
    description: "Self-hosted or cloud web scraper with AI cleanup. Extracts clean markdown from any page.",
    hasUrl: true,
    hasKey: true,
    urlPlaceholder: "http://localhost:3002",
  },
};

export const CrawlerSettings = memo(function CrawlerSettings({
  appSettings,
  onUpdateAppSettings,
}: CrawlerSettingsProps) {
  const [providers, setProviders] = useState<CrawlerProviderConfig[]>([]);
  const [timeout, setTimeout_] = useState(15000);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, "idle" | "testing" | "ok" | "failed">>({});
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [cacheStats, setCacheStats] = useState<{ totalEntries: number; totalChars: number; dbSizeBytes: number } | null>(null);
  const [cacheHistory, setCacheHistory] = useState<Array<{ id: number; url: string; provider: string; contentLength: number; cachedAt: number; hitCount: number; expired: boolean }>>([]);
  const [showCache, setShowCache] = useState(false);

  const loadCacheData = useCallback(async () => {
    const [stats, history] = await Promise.all([
      window.claude.crawler.stats(),
      window.claude.crawler.history(20),
    ]);
    setCacheStats(stats);
    setCacheHistory(history);
  }, []);

  useEffect(() => {
    if (appSettings?.crawler) {
      setProviders(appSettings.crawler.providers);
      setTimeout_(appSettings.crawler.timeout);
    }
  }, [appSettings]);

  const saveProviders = useCallback(async (next: CrawlerProviderConfig[]) => {
    setProviders(next);
    await onUpdateAppSettings({ crawler: { providers: next, timeout } });
  }, [onUpdateAppSettings, timeout]);

  const handleToggle = useCallback(async (id: CrawlerProviderId, checked: boolean) => {
    await saveProviders(providers.map((p) => (p.id === id ? { ...p, enabled: checked } : p)));
  }, [providers, saveProviders]);

  const handleFieldSave = useCallback(async (id: CrawlerProviderId, field: "baseUrl" | "apiKey", value: string) => {
    await saveProviders(providers.map((p) => (p.id === id ? { ...p, [field]: value.trim() } : p)));
  }, [providers, saveProviders]);

  const handleTimeoutSave = useCallback(async (value: string) => {
    const n = Math.max(5000, Math.min(60000, parseInt(value) || 15000));
    setTimeout_(n);
    await onUpdateAppSettings({ crawler: { providers, timeout: n } });
  }, [onUpdateAppSettings, providers]);

  const handleTest = useCallback(async (id: CrawlerProviderId) => {
    setTestStatus((prev) => ({ ...prev, [id]: "testing" }));
    setTestResults((prev) => ({ ...prev, [id]: "" }));
    try {
      const result = await window.claude.crawler.test(id);
      if (result.ok) {
        setTestStatus((prev) => ({ ...prev, [id]: "ok" }));
        setTestResults((prev) => ({ ...prev, [id]: `${result.chars} chars in ${result.ms}ms` }));
      } else {
        setTestStatus((prev) => ({ ...prev, [id]: "failed" }));
        setTestResults((prev) => ({ ...prev, [id]: result.error ?? "Failed" }));
      }
    } catch (err) {
      setTestStatus((prev) => ({ ...prev, [id]: "failed" }));
      setTestResults((prev) => ({ ...prev, [id]: (err as Error).message }));
    }
    window.setTimeout(() => { setTestStatus((prev) => ({ ...prev, [id]: "idle" })); setTestResults((prev) => ({ ...prev, [id]: "" })); }, 8000);
  }, []);

  const handleDragStart = useCallback((idx: number) => { setDragIdx(idx); }, []);
  const handleDragOver = useCallback((e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === targetIdx) return;
    const next = [...providers];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    setProviders(next);
    setDragIdx(targetIdx);
  }, [dragIdx, providers]);
  const handleDragEnd = useCallback(() => { setDragIdx(null); saveProviders(providers); }, [providers, saveProviders]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">Crawler</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Configure URL crawling providers for reading web pages. Drag to reorder priority.
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          <div className="py-3">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Providers (drag to set priority)
            </div>

            <div className="flex flex-col gap-1">
              {providers.map((provider, idx) => {
                const meta = PROVIDER_META[provider.id];
                const isExpanded = expandedId === provider.id;
                const status = testStatus[provider.id] ?? "idle";
                const resultText = testResults[provider.id] ?? "";
                return (
                  <div key={provider.id} draggable onDragStart={() => handleDragStart(idx)} onDragOver={(e) => handleDragOver(e, idx)} onDragEnd={handleDragEnd}
                    className={`rounded-lg border transition-colors ${dragIdx === idx ? "border-foreground/20 bg-foreground/[0.03]" : "border-foreground/[0.06] bg-background"}`}>
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/40 active:cursor-grabbing" />
                      <span className="rounded bg-foreground/[0.06] px-1.5 py-px text-[10px] font-mono text-muted-foreground/60">{idx + 1}</span>
                      <button onClick={() => setExpandedId(isExpanded ? null : provider.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-start">
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <span className={`text-sm font-medium ${provider.enabled ? "text-foreground" : "text-muted-foreground"}`}>{meta.label}</span>
                      </button>
                      <button onClick={() => handleTest(provider.id)} disabled={!provider.enabled || status === "testing"}
                        className={`flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors ${
                          status === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : status === "failed" ? "border-red-500/30 bg-red-500/10 text-red-400"
                          : !provider.enabled ? "border-foreground/5 text-muted-foreground/30"
                          : "border-foreground/10 bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground"}`}>
                        <TestTube className="h-3 w-3" />
                        {status === "testing" ? "..." : status === "ok" ? "OK" : status === "failed" ? "Fail" : "Test"}
                      </button>
                      <Switch checked={provider.enabled} onCheckedChange={(checked) => handleToggle(provider.id, checked)} />
                    </div>
                    {resultText && <div className={`px-3 pb-2 text-[11px] ${status === "ok" ? "text-emerald-400" : "text-red-400"}`}>{resultText}</div>}
                    {isExpanded && (
                      <div className="border-t border-foreground/[0.04] px-3 pb-3 pt-2">
                        <p className="mb-2 text-[11px] text-muted-foreground">{meta.description}</p>
                        {meta.hasUrl && (
                          <div className="mb-2">
                            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Server URL</label>
                            <input type="text" defaultValue={provider.baseUrl ?? ""} onBlur={(e) => handleFieldSave(provider.id, "baseUrl", e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleFieldSave(provider.id, "baseUrl", e.currentTarget.value); }}
                              spellCheck={false} className="h-7 w-full rounded-md border border-foreground/10 bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                              placeholder={meta.urlPlaceholder} />
                          </div>
                        )}
                        {meta.hasKey && (
                          <div className="mb-2">
                            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">API Key</label>
                            <input type="password" defaultValue={provider.apiKey ?? ""} onBlur={(e) => handleFieldSave(provider.id, "apiKey", e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleFieldSave(provider.id, "apiKey", e.currentTarget.value); }}
                              spellCheck={false} autoComplete="off" className="h-7 w-full rounded-md border border-foreground/10 bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-foreground/[0.06] py-3">
            <SettingRow label="Timeout" description="Maximum time to wait for page crawl (milliseconds).">
              <input type="number" value={timeout} onChange={(e) => setTimeout_(parseInt(e.target.value) || 15000)} onBlur={(e) => handleTimeoutSave(e.target.value)}
                min={5000} max={60000} step={1000} className="h-8 w-24 rounded-md border border-foreground/10 bg-background px-2.5 text-center text-sm text-foreground outline-none transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20" />
            </SettingRow>
          </div>

          <div className="border-t border-foreground/[0.06] py-3">
            <button onClick={() => { setShowCache(!showCache); if (!showCache) loadCacheData(); }} className="mb-3 flex w-full items-center gap-2 text-start">
              {showCache ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              <Database className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Page Cache (SQLite)</span>
              {cacheStats && <span className="rounded bg-foreground/[0.06] px-1.5 py-px text-[10px] font-mono text-muted-foreground/60">{cacheStats.totalEntries} pages</span>}
            </button>
            {showCache && cacheStats && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Pages", value: cacheStats.totalEntries },
                    { label: "Total Content", value: `${(cacheStats.totalChars / 1024).toFixed(0)} KB` },
                    { label: "DB Size", value: `${(cacheStats.dbSizeBytes / 1024).toFixed(1)} KB` },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-md border border-foreground/[0.06] px-2.5 py-2 text-center">
                      <div className="text-sm font-semibold text-foreground">{stat.value}</div>
                      <div className="text-[10px] text-muted-foreground">{stat.label}</div>
                    </div>
                  ))}
                </div>
                {cacheHistory.length > 0 && (
                  <div className="rounded-md border border-foreground/[0.06] p-2.5">
                    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Recent Pages</div>
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {cacheHistory.map((entry) => (
                        <div key={entry.id} className="flex items-center gap-2 text-xs">
                          <Clock className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                          <span className={`min-w-0 flex-1 truncate ${entry.expired ? "text-muted-foreground/40 line-through" : "text-foreground"}`}>{entry.url}</span>
                          <span className="shrink-0 rounded bg-foreground/[0.04] px-1 py-px text-[10px] text-muted-foreground/60">{entry.provider}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground/50">{(entry.contentLength / 1024).toFixed(0)}K</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={async () => { await window.claude.crawler.clearAll(); loadCacheData(); }}
                    className="flex items-center gap-1.5 rounded-md border border-red-500/20 bg-background px-3 py-1.5 text-xs font-medium text-red-400/80 transition-colors hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-400">
                    <Trash2 className="h-3 w-3" /> Clear All
                  </button>
                  <button onClick={loadCacheData} className="rounded-md border border-foreground/10 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground">
                    Refresh
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
});
