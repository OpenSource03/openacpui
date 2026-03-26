import { memo, useMemo, type ReactNode } from "react";
import {
  Search,
  FileText,
  CaseSensitive,
  Regex,
  File,
  AlignLeft,
  Folder,
  ChevronDown,
  ChevronRight,
  Loader2,
  List,
  GitBranch as TreeIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PanelHeader } from "@/components/PanelHeader";
import { useSearch, type ContentSearchResult } from "@/hooks/useSearch";
import { useState, useCallback } from "react";

interface SearchPanelProps {
  cwd?: string;
  enabled?: boolean;
  onOpenFile?: (filePath: string) => void;
}

function extColor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "tsx" || ext === "ts") return "text-blue-400/70";
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "text-yellow-400/70";
  if (ext === "json") return "text-amber-400/70";
  if (ext === "css" || ext === "scss" || ext === "sass") return "text-purple-400/70";
  if (ext === "md" || ext === "mdx") return "text-green-400/70";
  if (ext === "html") return "text-orange-400/70";
  if (ext === "py") return "text-blue-500/70";
  if (ext === "rs") return "text-orange-500/70";
  if (ext === "go") return "text-cyan-400/70";
  return "text-foreground/30";
}

function highlightMatch(preview: string, match: string): ReactNode {
  if (!match) return preview;
  const idx = preview.indexOf(match);
  if (idx === -1) return preview;
  return (
    <>
      {preview.slice(0, idx)}
      <span className="rounded-sm bg-amber-500/20 text-amber-200/90">{preview.slice(idx, idx + match.length)}</span>
      {preview.slice(idx + match.length)}
    </>
  );
}

function groupByFile(results: ContentSearchResult[]): Map<string, ContentSearchResult[]> {
  const map = new Map<string, ContentSearchResult[]>();
  for (const r of results) {
    const existing = map.get(r.file);
    if (existing) existing.push(r);
    else map.set(r.file, [r]);
  }
  return map;
}

export const SearchPanel = memo(function SearchPanel({
  cwd,
  enabled = true,
  onOpenFile,
}: SearchPanelProps) {
  const search = useSearch(enabled ? cwd : undefined);
  const [showFilters, setShowFilters] = useState(false);
  const [treeView, setTreeView] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const toggleFileCollapse = useCallback((file: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }, []);

  const groupedContent = useMemo(
    () => groupByFile(search.contentResults),
    [search.contentResults],
  );

  if (!cwd) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader icon={Search} label="Search" iconClass="text-cyan-600/70 dark:text-cyan-200/50" />
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/[0.05]">
            <Search className="h-3.5 w-3.5 text-foreground/25" />
          </div>
          <p className="text-[11px] text-foreground/40">No project open</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader icon={Search} label="Search" iconClass="text-cyan-600/70 dark:text-cyan-200/50">
        {search.isSearching && <Loader2 className="h-3 w-3 animate-spin text-foreground/40" />}
      </PanelHeader>

      <div className="space-y-1.5 border-b border-foreground/[0.06] px-3 py-2">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute start-2 h-3 w-3 text-foreground/35" />
          <input
            type="text"
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            placeholder={search.mode === "files" ? "Search files..." : search.mode === "folders" ? "Search folders..." : "Search in files..."}
            className="h-7 w-full rounded border border-input bg-background ps-6 pe-2 text-[11px] text-foreground/85 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            className={`h-6 gap-1 px-1.5 text-[10px] ${search.mode === "files" ? "bg-foreground/[0.08] text-foreground/80" : "text-foreground/40"}`}
            onClick={() => search.setMode("files")}
          >
            <File className="h-3 w-3" />
            Files
          </Button>
          <Button
            variant="ghost"
            className={`h-6 gap-1 px-1.5 text-[10px] ${search.mode === "content" ? "bg-foreground/[0.08] text-foreground/80" : "text-foreground/40"}`}
            onClick={() => search.setMode("content")}
          >
            <AlignLeft className="h-3 w-3" />
            Text
          </Button>
          <Button
            variant="ghost"
            className={`h-6 gap-1 px-1.5 text-[10px] ${search.mode === "folders" ? "bg-foreground/[0.08] text-foreground/80" : "text-foreground/40"}`}
            onClick={() => search.setMode("folders")}
          >
            <Folder className="h-3 w-3" />
            Folders
          </Button>

          <div className="mx-1 h-3 w-px bg-foreground/[0.08]" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-6 w-6 ${search.caseSensitive ? "bg-foreground/[0.08] text-foreground/80" : "text-foreground/40"}`}
                onClick={search.toggleCaseSensitive}
              >
                <CaseSensitive className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p className="text-xs">Match Case</p></TooltipContent>
          </Tooltip>
          {search.mode === "content" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-6 w-6 ${search.isRegex ? "bg-foreground/[0.08] text-foreground/80" : "text-foreground/40"}`}
                  onClick={search.toggleRegex}
                >
                  <Regex className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Use Regex</p></TooltipContent>
            </Tooltip>
          )}

          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-6 w-6 ${treeView ? "bg-foreground/[0.08] text-foreground/70" : "text-foreground/40"}`}
                onClick={() => setTreeView((p) => !p)}
              >
                {treeView ? <List className="h-3 w-3" /> : <TreeIcon className="h-3 w-3" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p className="text-xs">{treeView ? "Flat view" : "Tree view"}</p></TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            className={`h-6 gap-1 px-1.5 text-[10px] ${showFilters ? "bg-foreground/[0.08] text-foreground/70" : "text-foreground/40"}`}
            onClick={() => setShowFilters((p) => !p)}
          >
            Filters
            {showFilters ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        </div>

        {showFilters && (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className="shrink-0 text-[9px] uppercase tracking-wide text-foreground/30 w-9">incl</span>
              <input
                type="text"
                value={search.include}
                onChange={(e) => search.setInclude(e.target.value)}
                placeholder="*.tsx, src/**"
                className="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-[10px] text-foreground/85 outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="shrink-0 text-[9px] uppercase tracking-wide text-foreground/30 w-9">excl</span>
              <input
                type="text"
                value={search.exclude}
                onChange={(e) => search.setExclude(e.target.value)}
                placeholder="node_modules, dist"
                className="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-[10px] text-foreground/85 outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {search.mode === "files" && search.fileResults.length > 0 && !treeView && (
          <div className="py-1">
            {search.fileResults.map((r, i) => (
              <Tooltip key={r.path}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-1.5 px-3 py-[3px] text-[10px] transition-colors hover:bg-foreground/[0.05] cursor-pointer ${i % 2 === 1 ? "bg-foreground/[0.015]" : ""}`}
                    onClick={() => onOpenFile?.(r.path)}
                  >
                    <FileText className={`h-3 w-3 shrink-0 ${extColor(r.name)}`} />
                    <span className="shrink-0 font-medium text-foreground/80">{r.name}</span>
                    {r.dir && <span className="min-w-0 truncate text-foreground/40">{r.dir}</span>}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={4}>
                  <p className="font-mono text-[10px]">{r.path}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        {search.mode === "files" && search.fileResults.length > 0 && treeView && (() => {
          const grouped = new Map<string, typeof search.fileResults>();
          for (const r of search.fileResults) {
            const dir = r.dir || ".";
            const list = grouped.get(dir) || [];
            list.push(r);
            grouped.set(dir, list);
          }
          return (
            <div className="py-1">
              {Array.from(grouped.entries()).map(([dir, items]) => (
                <div key={dir}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1 px-3 py-[3px] text-[10px] transition-colors hover:bg-foreground/[0.03] cursor-pointer"
                    onClick={() => setExpandedDirs((prev) => {
                      const next = new Set(prev);
                      if (next.has(dir)) next.delete(dir);
                      else next.add(dir);
                      return next;
                    })}
                  >
                    {expandedDirs.has(dir) ? <ChevronDown className="h-2.5 w-2.5 text-foreground/40" /> : <ChevronRight className="h-2.5 w-2.5 text-foreground/40" />}
                    <Folder className="h-2.5 w-2.5 text-amber-400/60" />
                    <span className="font-medium text-foreground/55">{dir}</span>
                    <span className="text-foreground/30">{items.length}</span>
                  </button>
                  {expandedDirs.has(dir) && items.map((r) => (
                    <button
                      key={r.path}
                      type="button"
                      className="flex w-full items-center gap-1.5 ps-7 pe-3 py-[2px] text-[10px] transition-colors hover:bg-foreground/[0.05] cursor-pointer"
                      onClick={() => onOpenFile?.(r.path)}
                    >
                      <FileText className={`h-2.5 w-2.5 shrink-0 ${extColor(r.name)}`} />
                      <span className="text-foreground/80">{r.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          );
        })()}

        {search.mode === "folders" && search.fileResults.length > 0 && (
          <div className="py-1">
            {search.fileResults.map((r, i) => (
              <button
                key={r.dir || r.path}
                type="button"
                className={`flex w-full items-center gap-1.5 px-3 py-[3px] text-[10px] transition-colors hover:bg-foreground/[0.05] cursor-pointer ${i % 2 === 1 ? "bg-foreground/[0.015]" : ""}`}
                onClick={() => onOpenFile?.(r.dir || r.path)}
              >
                <Folder className="h-3 w-3 shrink-0 text-amber-400/60" />
                <span className="min-w-0 truncate font-medium text-foreground/70">{r.dir || "."}</span>
              </button>
            ))}
          </div>
        )}

        {search.mode === "content" && groupedContent.size > 0 && (
          <div className="py-1">
            {Array.from(groupedContent.entries()).map(([file, matches], fileIdx) => (
              <div key={file}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-1.5 px-3 py-[3px] transition-colors hover:bg-foreground/[0.05] cursor-pointer ${fileIdx % 2 === 1 ? "bg-foreground/[0.015]" : ""}`}
                  onClick={() => toggleFileCollapse(file)}
                >
                  {collapsedFiles.has(file) ? (
                    <ChevronRight className="h-3 w-3 shrink-0 text-foreground/40" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0 text-foreground/40" />
                  )}
                  <FileText className={`h-3 w-3 shrink-0 ${extColor(file)}`} />
                  <span className="min-w-0 truncate text-[10px] font-medium text-foreground/70">{file}</span>
                  <span className="shrink-0 rounded-full bg-foreground/[0.07] px-1.5 py-px text-[9px] font-medium tabular-nums text-foreground/45">
                    {matches.length}
                  </span>
                </button>
                {!collapsedFiles.has(file) &&
                  matches.map((m, i) => (
                    <button
                      key={`${file}-${m.line}-${i}`}
                      type="button"
                      className={`flex w-full items-center gap-1.5 pe-3 ps-8 py-[2px] text-[10px] transition-colors hover:bg-foreground/[0.05] cursor-pointer ${i % 2 === 1 ? "bg-foreground/[0.015]" : ""}`}
                      onClick={() => onOpenFile?.(file)}
                    >
                      <span className="shrink-0 w-8 text-end font-mono text-foreground/35 tabular-nums">
                        {m.line}
                      </span>
                      <span className="min-w-0 truncate font-mono text-foreground/65">
                        {highlightMatch(m.preview, m.match)}
                      </span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}

        {search.query && !search.isSearching && search.fileResults.length === 0 && search.contentResults.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/[0.05]">
              <Search className="h-3.5 w-3.5 text-foreground/25" />
            </div>
            <p className="text-[11px] font-medium text-foreground/50">No results for "{search.query}"</p>
            <p className="text-[10px] text-foreground/30">Try a shorter term, different spelling, or switch search mode</p>
          </div>
        )}
      </ScrollArea>

      {search.query && (
        <div className="flex items-center justify-between border-t border-foreground/[0.06] px-3 py-1 text-[10px] text-foreground/40">
          <span>
            {search.mode === "files"
              ? `${search.fileResults.length} files`
              : search.mode === "folders"
              ? `${search.fileResults.length} folders`
              : `${search.totalContentCount} results in ${groupedContent.size} files`}
          </span>
          {search.searchTimeMs !== null && !search.isSearching && (
            <span className="text-foreground/25">{search.searchTimeMs}ms</span>
          )}
        </div>
      )}
    </div>
  );
});
