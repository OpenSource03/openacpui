import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  FolderTree,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelHeader } from "@/components/PanelHeader";
import { OpenInEditorButton } from "./OpenInEditorButton";
import { useProjectFiles } from "@/hooks/useProjectFiles";
import {
  filterTree,
  flattenTree,
  countFiles,
  collectDirPaths,
  type FileTreeNode,
} from "@/lib/file-tree";

// ── File icon by extension ──

const EXTENSION_ICON_COLORS: Record<string, string> = {
  ts: "text-blue-400",
  tsx: "text-blue-400",
  js: "text-yellow-400",
  jsx: "text-yellow-400",
  json: "text-yellow-600",
  css: "text-purple-400",
  scss: "text-pink-400",
  html: "text-orange-400",
  md: "text-gray-400",
  py: "text-green-400",
  rs: "text-orange-500",
  go: "text-cyan-400",
  svg: "text-amber-400",
  yaml: "text-red-300",
  yml: "text-red-300",
  toml: "text-gray-500",
  sh: "text-green-500",
};

function getFileIconColor(extension?: string): string {
  if (!extension) return "text-muted-foreground/70";
  return EXTENSION_ICON_COLORS[extension] ?? "text-muted-foreground/70";
}

// ── Props ──

interface ProjectFilesPanelProps {
  cwd?: string;
  onPreviewFile?: (filePath: string, sourceRect: DOMRect) => void;
}

// ── Component ──

export const ProjectFilesPanel = memo(function ProjectFilesPanel({
  cwd,
  onPreviewFile,
}: ProjectFilesPanelProps) {
  const { tree, loading, error, refresh } = useProjectFiles(cwd);

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce search input
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 200);
  }, []);

  // Filter tree by search query
  const filteredTree = useMemo(() => {
    if (!tree) return null;
    if (!debouncedQuery.trim()) return tree;
    return filterTree(tree, debouncedQuery);
  }, [tree, debouncedQuery]);

  // When searching, auto-expand all matching directories
  const effectiveExpanded = useMemo(() => {
    if (!filteredTree || !debouncedQuery.trim()) return expandedDirs;
    return collectDirPaths(filteredTree);
  }, [filteredTree, debouncedQuery, expandedDirs]);

  // Flatten for rendering
  const flatItems = useMemo(() => {
    if (!filteredTree) return [];
    return flattenTree(filteredTree, effectiveExpanded);
  }, [filteredTree, effectiveExpanded]);

  const totalFiles = useMemo(() => (tree ? countFiles(tree) : 0), [tree]);

  // Toggle directory expanded state
  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Handle file row click
  const handleFileClick = useCallback(
    (node: FileTreeNode, event: React.MouseEvent<HTMLDivElement>) => {
      if (!cwd || !onPreviewFile) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const absolutePath = `${cwd}/${node.path}`;
      onPreviewFile(absolutePath, rect);
    },
    [cwd, onPreviewFile],
  );

  if (!cwd) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader icon={FolderTree} label="Project Files" />
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-xs text-muted-foreground">No project selected</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader icon={FolderTree} label="Project Files">
        {totalFiles > 0 && (
          <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px] font-semibold tabular-nums">
            {totalFiles}
          </Badge>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md
                text-muted-foreground/50 transition-all duration-150
                hover:text-muted-foreground hover:bg-foreground/[0.06]
                active:scale-90"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <p className="text-xs">Refresh files</p>
          </TooltipContent>
        </Tooltip>
      </PanelHeader>

      {/* Search bar */}
      <div className="flex items-center gap-1.5 border-b border-foreground/[0.08] px-3 py-1.5">
        <Search className="h-3 w-3 shrink-0 text-muted-foreground/50" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search files..."
          className="h-5 w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
        />
      </div>

      {/* Tree content */}
      <ScrollArea className="flex-1 min-h-0">
        {loading && !tree && (
          <div className="flex items-center justify-center p-8">
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground/50" />
          </div>
        )}

        {error && (
          <div className="p-4">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        {flatItems.length === 0 && !loading && !error && tree && (
          <div className="flex items-center justify-center p-8">
            <p className="text-xs text-muted-foreground/50">
              {debouncedQuery ? `No files matching "${debouncedQuery}"` : "No files found"}
            </p>
          </div>
        )}

        <div className="py-1">
          {flatItems.map((item) => (
            <FileTreeRow
              key={item.node.path}
              node={item.node}
              depth={item.depth}
              isExpanded={item.isExpanded}
              cwd={cwd}
              onToggleDir={toggleDir}
              onFileClick={handleFileClick}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
});

// ── FileTreeRow ──

interface FileTreeRowProps {
  node: FileTreeNode;
  depth: number;
  isExpanded: boolean;
  cwd: string;
  onToggleDir: (path: string) => void;
  onFileClick: (node: FileTreeNode, event: React.MouseEvent<HTMLDivElement>) => void;
}

const FileTreeRow = memo(function FileTreeRow({
  node,
  depth,
  isExpanded,
  cwd,
  onToggleDir,
  onFileClick,
}: FileTreeRowProps) {
  const isDir = node.type === "directory";

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDir) {
        onToggleDir(node.path);
      } else {
        onFileClick(node, e);
      }
    },
    [isDir, node, onToggleDir, onFileClick],
  );

  return (
    <div
      onClick={handleClick}
      className="group flex cursor-pointer items-center gap-1 px-2 py-[3px] transition-colors duration-75 hover:bg-foreground/[0.05]"
      style={{ paddingInlineStart: depth * 16 + 8 }}
    >
      {/* Chevron for directories */}
      {isDir ? (
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform duration-150 ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
      ) : (
        <span className="inline-block h-3 w-3 shrink-0" />
      )}

      {/* Icon */}
      {isDir && isExpanded && <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />}
      {isDir && !isExpanded && <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />}
      {!isDir && <File className={`h-3.5 w-3.5 shrink-0 ${getFileIconColor(node.extension)}`} />}

      {/* Name */}
      <span className="min-w-0 truncate text-xs text-foreground/80">{node.name}</span>

      {/* Open in editor (files only, on hover) */}
      {!isDir && (
        <span className="ms-auto shrink-0">
          <OpenInEditorButton filePath={`${cwd}/${node.path}`} />
        </span>
      )}
    </div>
  );
});
