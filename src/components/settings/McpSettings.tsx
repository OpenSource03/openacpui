import { memo, useState, useCallback } from "react";
import { Search, Package, ExternalLink, Globe, Terminal, Plus, Loader2, Plug, Store, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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

interface McpSettingsProps {
  projectId: string | null;
}

export const McpSettings = memo(function McpSettings({ projectId }: McpSettingsProps) {
  const [query, setQuery] = useState("");
  const [servers, setServers] = useState<RegistryServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [addingName, setAddingName] = useState<string | null>(null);
  const [addedNames, setAddedNames] = useState<Set<string>>(new Set());

  const doSearch = useCallback(async (searchQuery?: string, cursor?: string) => {
    setLoading(true);
    try {
      const result = await window.claude.mcpRegistry.search(searchQuery || undefined, cursor);
      if (result.ok) {
        setServers(cursor ? (prev) => [...prev, ...result.servers] : result.servers);
        setNextCursor(result.nextCursor);
      }
    } catch {}
    setLoading(false);
    setSearched(true);
  }, []);

  const handleAddFromRegistry = useCallback(async (server: RegistryServer, pkg: RegistryServer["packages"][0]) => {
    if (!projectId || addingName) return;
    const shortName = server.name.split("/").pop() ?? server.name;
    setAddingName(server.name);
    try {
      await window.claude.mcp.addFromRegistry({
        projectId,
        name: shortName,
        transport: pkg.transport as "stdio" | "sse" | "http",
        registry: pkg.registry,
        identifier: pkg.identifier,
        envVars: pkg.envVars,
      });
      setAddedNames((prev) => new Set(prev).add(server.name));
    } catch {}
    setAddingName(null);
  }, [projectId, addingName]);

  return (
    <div className="flex h-full flex-col">
      <Tabs defaultValue="store" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-foreground/[0.06] px-6">
          <div className="py-4">
            <h2 className="text-base font-semibold text-foreground">MCP Servers</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Browse the MCP registry or manage your project servers
            </p>
          </div>
          <TabsList variant="line">
            <TabsTrigger value="store" className="gap-1.5">
              <Store className="h-3.5 w-3.5" />
              MCP Store
            </TabsTrigger>
            <TabsTrigger value="my-servers" className="gap-1.5">
              <Plug className="h-3.5 w-3.5" />
              My Servers
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="store" className="min-h-0 flex-1">
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-5 py-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") doSearch(query); }}
                  placeholder="Search MCP servers..."
                  spellCheck={false}
                  className="h-8 w-full rounded-md border border-foreground/10 bg-background pe-3 ps-8 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                />
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => doSearch(query)} disabled={loading}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              {!searched && !loading && (
                <div className="grid grid-cols-2 gap-3 px-5 py-4">
                  {["github", "slack", "filesystem", "postgres", "docker", "jira"].map((term) => (
                    <button
                      key={term}
                      onClick={() => { setQuery(term); doSearch(term); }}
                      className="flex items-center gap-2 rounded-lg border border-foreground/[0.06] px-4 py-3 text-start transition-colors hover:border-foreground/10 hover:bg-foreground/[0.02]"
                    >
                      <Package className="h-4 w-4 text-muted-foreground/40" />
                      <span className="text-sm text-muted-foreground">{term}</span>
                    </button>
                  ))}
                </div>
              )}

              {searched && servers.length === 0 && !loading && (
                <div className="py-12 text-center text-sm text-muted-foreground">No servers found</div>
              )}

              <div className="grid grid-cols-2 gap-3 px-5 pb-5">
                {servers.map((server) => {
                  const isExpanded = expandedName === server.name;
                  const npmPkg = server.packages.find((p) => p.registry === "npm");
                  const pypiPkg = server.packages.find((p) => p.registry === "pypi");
                  const mainPkg = npmPkg ?? pypiPkg ?? server.packages[0];
                  const hasRemote = server.remotes.length > 0;
                  const shortName = server.name.split("/").pop() ?? server.name;

                  return (
                    <div key={server.name} className="flex flex-col rounded-lg border border-foreground/[0.06] bg-background transition-colors hover:border-foreground/10">
                      <button
                        onClick={() => setExpandedName(isExpanded ? null : server.name)}
                        className="flex flex-1 flex-col gap-2 p-3 text-start"
                      >
                        <div className="flex items-start gap-2.5">
                          {server.icon ? (
                            <img src={server.icon} alt="" className="h-9 w-9 shrink-0 rounded-lg" />
                          ) : (
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04]">
                              <Package className="h-4 w-4 text-muted-foreground/50" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-semibold text-foreground">{shortName}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                              <span className="font-mono">v{server.version}</span>
                              {mainPkg && <span>· {mainPkg.registry}</span>}
                            </div>
                          </div>
                        </div>
                        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{server.description}</p>
                      </button>

                      <div className="flex items-center justify-between border-t border-foreground/[0.04] px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {hasRemote && (
                            <span className="rounded-full bg-blue-500/10 px-2 py-px text-[10px] font-medium text-blue-400">remote</span>
                          )}
                          {mainPkg?.transport && (
                            <span className="rounded-full bg-foreground/[0.05] px-2 py-px text-[10px] text-muted-foreground/60">{mainPkg.transport}</span>
                          )}
                        </div>
                        {mainPkg && (() => {
                          const isAdding = addingName === server.name;
                          const isAdded = addedNames.has(server.name);
                          return (
                            <Button
                              variant={isAdded ? "ghost" : "outline"}
                              size="sm"
                              className="h-7 gap-1.5 text-xs"
                              disabled={!projectId || isAdding || isAdded}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddFromRegistry(server, mainPkg);
                              }}
                            >
                              {isAdding ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : isAdded ? (
                                <Check className="h-3 w-3 text-emerald-500" />
                              ) : (
                                <Plus className="h-3 w-3" />
                              )}
                              {isAdding ? "Adding..." : isAdded ? "Added" : "Add"}
                            </Button>
                          );
                        })()}
                      </div>

                      {isExpanded && (
                        <div className="border-t border-foreground/[0.04] px-3 pb-3 pt-2 text-xs">
                          <div className="mb-1.5 font-mono text-[10px] text-muted-foreground/50">{server.name}</div>

                          {mainPkg && (
                            <div className="mb-2 rounded bg-foreground/[0.03] p-2">
                              <code className="text-foreground/80">
                                {mainPkg.registry === "npm" ? `npx -y ${mainPkg.identifier}` : `uvx ${mainPkg.identifier}`}
                              </code>
                            </div>
                          )}

                          {mainPkg?.envVars && mainPkg.envVars.length > 0 && (
                            <div className="mb-2 space-y-0.5">
                              {mainPkg.envVars.map((env) => (
                                <div key={env.name} className="flex items-center gap-1.5">
                                  <code className="rounded bg-foreground/[0.05] px-1 text-[10px] text-foreground/70">{env.name}</code>
                                  {env.isRequired && <span className="text-[9px] text-amber-400">req</span>}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex gap-1.5">
                            {server.repoUrl && (
                              <a href={server.repoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                                <Globe className="h-3 w-3" /> Repo
                              </a>
                            )}
                            {server.websiteUrl && (
                              <a href={server.websiteUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                                <ExternalLink className="h-3 w-3" /> Site
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {nextCursor && (
                <div className="px-5 pb-5">
                  <Button variant="outline" className="w-full" onClick={() => doSearch(query || undefined, nextCursor)} disabled={loading}>
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load More"}
                  </Button>
                </div>
              )}
            </ScrollArea>
          </div>
        </TabsContent>

        <TabsContent value="my-servers" className="min-h-0 flex-1">
          <div className="flex flex-1 flex-col items-center justify-center px-4">
            <div className="flex max-w-md flex-col items-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
                <Plug className="h-7 w-7 text-foreground/80" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Project Servers</h3>
              <p className="text-sm text-muted-foreground">
                MCP servers are configured per-project from the{" "}
                <Plug className="inline h-3.5 w-3.5 -translate-y-px text-foreground/70" />{" "}
                <span className="font-medium text-foreground">MCP Servers</span> panel in the right-side toolbar.
              </p>
              <p className="text-xs text-muted-foreground/60">
                Each project has its own set of MCP servers that connect to your AI sessions.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
});
