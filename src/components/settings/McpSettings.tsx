import { memo, useState, useCallback } from "react";
import { Search, Package, ExternalLink, Globe, Terminal, ChevronRight, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface RegistryServer {
  name: string;
  description: string;
  version: string;
  websiteUrl?: string;
  repoUrl?: string;
  icon?: string;
  packages: Array<{
    registry: string;
    identifier: string;
    version?: string;
    transport: string;
    envVars: Array<{ name: string; description: string; isRequired: boolean; isSecret?: boolean }>;
  }>;
  remotes: Array<{ type: string; url: string }>;
  publishedAt?: string;
}

export const McpSettings = memo(function McpSettings() {
  const [query, setQuery] = useState("");
  const [servers, setServers] = useState<RegistryServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doSearch = useCallback(async (searchQuery?: string, cursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.claude.mcpRegistry.search(searchQuery || undefined, cursor);
      if (result.ok) {
        if (cursor) {
          setServers((prev) => [...prev, ...result.servers]);
        } else {
          setServers(result.servers);
        }
        setNextCursor(result.nextCursor);
      } else {
        setError(result.error ?? "Search failed");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, []);

  const handleSearch = useCallback(() => {
    doSearch(query);
  }, [query, doSearch]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">MCP Servers</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Browse and discover MCP servers from the official registry. Per-project servers are managed from the toolbar.
        </p>
      </div>

      <div className="border-b border-foreground/[0.06] px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              placeholder="Search MCP servers (e.g. github, slack, database...)"
              spellCheck={false}
              className="h-8 w-full rounded-md border border-foreground/10 bg-background pe-3 ps-8 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="h-8 shrink-0 rounded-md border border-foreground/10 bg-background px-4 text-xs font-medium text-foreground transition-colors hover:border-foreground/20 hover:bg-foreground/[0.03] disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
          </button>
          {!searched && (
            <button
              onClick={() => doSearch()}
              disabled={loading}
              className="h-8 shrink-0 rounded-md border border-foreground/10 bg-background px-4 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground disabled:opacity-50"
            >
              Browse All
            </button>
          )}
        </div>
        {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {servers.length === 0 && searched && !loading && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No servers found. Try a different search term.
            </div>
          )}

          {!searched && !loading && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Package className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                Search the official MCP registry to discover servers
              </p>
            </div>
          )}

          <div className="space-y-1">
            {servers.map((server) => {
              const isExpanded = expandedName === server.name;
              const npmPkg = server.packages.find((p) => p.registry === "npm");
              const pypiPkg = server.packages.find((p) => p.registry === "pypi");
              const mainPkg = npmPkg ?? pypiPkg ?? server.packages[0];
              const hasRemote = server.remotes.length > 0;

              return (
                <div key={server.name} className="rounded-lg border border-foreground/[0.06] bg-background transition-colors hover:border-foreground/10">
                  <button
                    onClick={() => setExpandedName(isExpanded ? null : server.name)}
                    className="flex w-full items-start gap-3 px-3 py-2.5 text-start"
                  >
                    {server.icon ? (
                      <img src={server.icon} alt="" className="mt-0.5 h-8 w-8 shrink-0 rounded-md" />
                    ) : (
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground/[0.04]">
                        <Package className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{server.name.split("/").pop()}</span>
                        <span className="shrink-0 rounded bg-foreground/[0.05] px-1.5 py-px text-[10px] font-mono text-muted-foreground/60">
                          v{server.version}
                        </span>
                        {hasRemote && (
                          <span className="shrink-0 rounded bg-blue-500/10 px-1.5 py-px text-[10px] text-blue-400">remote</span>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{server.description}</p>
                    </div>
                    <ChevronRight className={`mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  </button>

                  {isExpanded && (
                    <div className="border-t border-foreground/[0.04] px-3 pb-3 pt-2">
                      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Full name: <span className="font-mono text-foreground/60">{server.name}</span>
                      </div>

                      {mainPkg && (
                        <div className="mb-2 rounded-md bg-foreground/[0.03] p-2">
                          <div className="mb-1 text-[10px] font-medium text-muted-foreground">Install ({mainPkg.registry})</div>
                          <code className="block text-xs text-foreground/80">
                            {mainPkg.registry === "npm" ? `npx -y ${mainPkg.identifier}` : `uvx ${mainPkg.identifier}`}
                          </code>
                          <div className="mt-1 text-[10px] text-muted-foreground/60">
                            Transport: {mainPkg.transport}
                          </div>
                        </div>
                      )}

                      {hasRemote && (
                        <div className="mb-2 rounded-md bg-foreground/[0.03] p-2">
                          <div className="mb-1 text-[10px] font-medium text-muted-foreground">Remote</div>
                          {server.remotes.map((r, i) => (
                            <div key={i} className="text-xs text-foreground/80">
                              <span className="text-muted-foreground">{r.type}:</span> {r.url}
                            </div>
                          ))}
                        </div>
                      )}

                      {mainPkg && mainPkg.envVars.length > 0 && (
                        <div className="mb-2">
                          <div className="mb-1 text-[10px] font-medium text-muted-foreground">Environment Variables</div>
                          <div className="space-y-1">
                            {mainPkg.envVars.map((env) => (
                              <div key={env.name} className="flex items-center gap-2 text-xs">
                                <code className="rounded bg-foreground/[0.05] px-1 py-px text-[11px] text-foreground/70">{env.name}</code>
                                {env.isRequired && <span className="text-[10px] text-amber-400">required</span>}
                                {env.isSecret && <span className="text-[10px] text-red-400/60">secret</span>}
                                <span className="truncate text-muted-foreground/60">{env.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        {server.repoUrl && (
                          <a href={server.repoUrl} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 rounded-md border border-foreground/10 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                            <Globe className="h-3 w-3" /> Repo
                          </a>
                        )}
                        {server.websiteUrl && (
                          <a href={server.websiteUrl} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 rounded-md border border-foreground/10 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                            <ExternalLink className="h-3 w-3" /> Website
                          </a>
                        )}
                        {mainPkg && (
                          <button
                            onClick={() => {
                              const cmd = mainPkg.registry === "npm"
                                ? `npx -y ${mainPkg.identifier}`
                                : `uvx ${mainPkg.identifier}`;
                              navigator.clipboard.writeText(cmd);
                            }}
                            className="flex items-center gap-1 rounded-md border border-foreground/10 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                            <Terminal className="h-3 w-3" /> Copy Install
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {nextCursor && (
            <button
              onClick={() => doSearch(query || undefined, nextCursor)}
              disabled={loading}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-foreground/[0.06] py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/10 hover:text-foreground"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load More"}
            </button>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
