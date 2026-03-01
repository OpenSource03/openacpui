import { memo, useState, useCallback, useMemo } from "react";
import {
  Search,
  RefreshCw,
  Check,
  ArrowUpRight,
  Download,
  AlertCircle,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentIcon } from "@/components/AgentIcon";
import { useAgentStore } from "@/hooks/useAgentStore";
import {
  registryAgentToDefinition,
  hasUpdate,
  isInstallable,
} from "@/lib/agent-store-utils";
import type { InstalledAgent, RegistryAgent } from "@/types";

// ── Types ──

interface AgentStoreProps {
  installedAgents: InstalledAgent[];
  onInstall: (agent: InstalledAgent) => Promise<{ ok?: boolean; error?: string }>;
  onUninstall: (id: string) => Promise<{ ok?: boolean; error?: string }>;
}

type CardStatus = "available" | "installed" | "update" | "manual";

// ── Helpers ──

/** Determine the install status of a registry agent relative to installed agents. */
function getCardStatus(
  registryAgent: RegistryAgent,
  installedMap: Map<string, InstalledAgent>,
): CardStatus {
  if (!isInstallable(registryAgent)) return "manual";
  const installed = installedMap.get(registryAgent.id);
  if (!installed) return "available";
  if (hasUpdate(installed, registryAgent)) return "update";
  return "installed";
}

/** Format author list — strip email addresses for cleaner display. */
function formatAuthors(authors: string[]): string {
  return authors
    .map((a) => a.replace(/<[^>]+>/, "").trim())
    .join(", ");
}

// ── Skeleton loader for initial fetch ──

function StoreSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 px-5 py-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-lg border border-foreground/[0.04] bg-foreground/[0.015] p-4"
        >
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 shrink-0 rounded-md bg-foreground/[0.06]" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-24 rounded bg-foreground/[0.06]" />
              <div className="h-2.5 w-32 rounded bg-foreground/[0.04]" />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="h-2.5 w-full rounded bg-foreground/[0.04]" />
            <div className="h-2.5 w-3/4 rounded bg-foreground/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Store Agent Card ──

const StoreAgentCard = memo(function StoreAgentCard({
  agent,
  status,
  isInstalling,
  onInstall,
  onUninstall,
}: {
  agent: RegistryAgent;
  status: CardStatus;
  isInstalling: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  return (
    <div className="group relative flex flex-col rounded-lg border border-foreground/[0.06] bg-background p-4 transition-colors hover:border-foreground/[0.1]">
      {/* Header: icon + name + version */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/40">
          <AgentIcon icon={agent.icon} size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {agent.name}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-mono">v{agent.version}</span>
            <span className="text-foreground/20">·</span>
            <span className="truncate">{formatAuthors(agent.authors)}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {agent.description}
      </p>

      {/* Footer: license + action */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground/70">
            {agent.license}
          </Badge>
          {agent.repository && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={agent.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground/50 transition-colors hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                View repository
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Install / Installed / Update / Manual */}
        {status === "available" && (
          <Button
            size="sm"
            className="h-7 gap-1.5 px-3 text-xs"
            onClick={onInstall}
            disabled={isInstalling}
          >
            {isInstalling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {isInstalling ? "Adding..." : "Add"}
          </Button>
        )}

        {status === "installed" && (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-destructive/60 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  onClick={onUninstall}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Remove agent</TooltipContent>
            </Tooltip>
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Check className="h-2.5 w-2.5" />
              Added
            </Badge>
          </div>
        )}

        {status === "update" && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-3 text-xs"
            onClick={onInstall}
            disabled={isInstalling}
          >
            {isInstalling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {isInstalling ? "Updating..." : "Update"}
          </Button>
        )}

        {status === "manual" && agent.repository && (
          <a
            href={agent.repository}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm" className="h-7 gap-1.5 px-3 text-xs">
              <ArrowUpRight className="h-3 w-3" />
              Setup
            </Button>
          </a>
        )}
      </div>
    </div>
  );
});

// ── Main Component ──

export const AgentStore = memo(function AgentStore({
  installedAgents,
  onInstall,
  onUninstall,
}: AgentStoreProps) {
  const { registryAgents, isLoading, error, refresh } = useAgentStore();
  const [search, setSearch] = useState("");
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Map installed agents by registryId for O(1) lookup
  const installedMap = useMemo(
    () =>
      new Map(
        installedAgents
          .filter((a) => a.registryId)
          .map((a) => [a.registryId!, a]),
      ),
    [installedAgents],
  );

  // Client-side search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return registryAgents;
    const q = search.toLowerCase();
    return registryAgents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.authors.some((auth) => auth.toLowerCase().includes(q)),
    );
  }, [registryAgents, search]);

  const handleInstall = useCallback(
    async (registryAgent: RegistryAgent) => {
      const def = registryAgentToDefinition(registryAgent);
      if (!def) return;
      setInstalling((prev) => new Set(prev).add(registryAgent.id));
      try {
        await onInstall(def);
      } finally {
        setInstalling((prev) => {
          const next = new Set(prev);
          next.delete(registryAgent.id);
          return next;
        });
      }
    },
    [onInstall],
  );

  const handleUninstall = useCallback(
    async (agentId: string) => {
      await onUninstall(agentId);
    },
    [onUninstall],
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      {/* Search + refresh bar */}
      <div className="flex items-center gap-2 px-5 py-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="h-8 ps-8 text-xs"
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Refresh registry
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-5 mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Failed to load registry: {error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-destructive hover:text-destructive"
            onClick={handleRefresh}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <StoreSkeleton />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid grid-cols-2 gap-3 px-5 pb-5">
            {filtered.map((agent) => {
              const status = getCardStatus(agent, installedMap);
              return (
                <StoreAgentCard
                  key={agent.id}
                  agent={agent}
                  status={status}
                  isInstalling={installing.has(agent.id)}
                  onInstall={() => handleInstall(agent)}
                  onUninstall={() => handleUninstall(agent.id)}
                />
              );
            })}
          </div>

          {/* Empty search results */}
          {filtered.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="h-8 w-8 text-muted-foreground/30" />
              <p className="mt-3 text-sm text-muted-foreground">No agents found</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Try a different search term
              </p>
            </div>
          )}
        </ScrollArea>
      )}
    </div>
  );
});
