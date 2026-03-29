import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  CornerLeftDown,
  ExternalLink,
  Plus,
  FileCog,
  ChevronRight,
  File,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  RefreshCw,
  Search,
  SquarePen,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { PanelHeader } from "@/components/PanelHeader";
import { OpenInEditorButton } from "./OpenInEditorButton";
import { useProjectFiles } from "@/hooks/useProjectFiles";
import { formatRanges, type AccessType, type FileAccess } from "@/lib/file-access";
import {
  buildSessionCacheKey,
  computeFilePanelData,
  getCachedFilePanelData,
  type FilePanelData,
} from "@/lib/session-derived-data";
import {
  collectDirPaths,
  countFiles,
  filterTree,
  flattenTree,
  type FileTreeNode,
} from "@/lib/file-tree";
import type { EngineId, UIMessage } from "@/types";

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

function getParentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return "";
  return path.slice(0, idx);
}

function joinRelativePath(baseDir: string, name: string): string {
  const trimmedBase = baseDir.trim().replace(/\/$/, "");
  const trimmedName = name.trim().replace(/^\//, "");
  if (!trimmedName) return trimmedBase;
  return trimmedBase ? `${trimmedBase}/${trimmedName}` : trimmedName;
}

function getBaseName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? path : path.slice(idx + 1);
}

function stripExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

function isPathInside(path: string, parentDir: string): boolean {
  return path === parentDir || path.startsWith(`${parentDir}/`);
}

function collectNodeMap(nodes: FileTreeNode[]): Map<string, FileTreeNode> {
  const map = new Map<string, FileTreeNode>();
  const walk = (items: FileTreeNode[]) => {
    for (const node of items) {
      map.set(node.path, node);
      if (node.type === "directory" && node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return map;
}

function toRelativePath(cwd: string, absolutePath: string): string | null {
  if (absolutePath === cwd) return "";
  const prefix = `${cwd}/`;
  if (!absolutePath.startsWith(prefix)) return null;
  return absolutePath.slice(prefix.length);
}

function getAncestorDirs(path: string): string[] {
  const dirs: string[] = [];
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) return dirs;
  for (let i = 1; i < segments.length; i += 1) {
    dirs.push(segments.slice(0, i).join("/"));
  }
  return dirs;
}

interface ProjectFilesPanelProps {
  cwd?: string;
  enabled: boolean;
  onPreviewFile?: (filePath: string, sourceRect: DOMRect) => void;
  onOpenFileInWorkspace?: (filePath: string, line?: number, openInFloating?: boolean) => void;
  activeFilePath?: string | null;
  sessionId?: string | null;
  messages?: UIMessage[];
  activeEngine?: EngineId;
}

export const ProjectFilesPanel = memo(function ProjectFilesPanel({
  cwd,
  enabled,
  onPreviewFile,
  onOpenFileInWorkspace,
  activeFilePath,
  sessionId,
  messages = [],
  activeEngine,
}: ProjectFilesPanelProps) {
  const { tree, loading, error, refresh } = useProjectFiles(cwd, enabled);
  const [filePanelData, setFilePanelData] = useState<FilePanelData | null>(null);

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [searchCollapsedDirs, setSearchCollapsedDirs] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pathDialog, setPathDialog] = useState<{
    open: boolean;
    mode: "new-file" | "new-folder" | "rename";
    title: string;
    description: string;
    value: string;
    confirmLabel: string;
    sourcePath?: string;
  }>({
    open: false,
    mode: "new-file",
    title: "",
    description: "",
    value: "",
    confirmLabel: "",
  });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [clipboardItem, setClipboardItem] = useState<{ path: string; mode: "copy" | "cut" } | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredTree = useMemo(() => {
    if (!tree) return null;
    if (!debouncedQuery.trim()) return tree;
    return filterTree(tree, debouncedQuery);
  }, [tree, debouncedQuery]);

  const effectiveExpanded = useMemo(() => {
    if (!filteredTree || !debouncedQuery.trim()) return expandedDirs;
    // During search: expand all matched dirs except those the user manually collapsed
    const allDirs = collectDirPaths(filteredTree);
    if (searchCollapsedDirs.size === 0) return allDirs;
    const result = new Set(allDirs);
    for (const d of searchCollapsedDirs) result.delete(d);
    return result;
  }, [filteredTree, debouncedQuery, expandedDirs, searchCollapsedDirs]);

  const flatItems = useMemo(() => {
    if (!filteredTree) return [];
    return flattenTree(filteredTree, effectiveExpanded);
  }, [filteredTree, effectiveExpanded]);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 28,
    overscan: 15,
  });

  const totalFiles = useMemo(() => (tree ? countFiles(tree) : 0), [tree]);
  const nodeByPath = useMemo(() => (tree ? collectNodeMap(tree) : new Map<string, FileTreeNode>()), [tree]);
  const selectedNode = selectedPath ? nodeByPath.get(selectedPath) ?? null : null;
  const cacheSessionId = sessionId ?? "no-session";
  const lastMessage = messages[messages.length - 1];
  const msgLen = messages.length;
  const lastMsgId = lastMessage?.id;
  const lastMsgTs = lastMessage?.timestamp;
  const fileAccessCacheKey = useMemo(
    () => buildSessionCacheKey(cacheSessionId, messages, `project-files:${cwd ?? ""}:${activeEngine ?? ""}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeEngine, cacheSessionId, cwd, msgLen, lastMsgId, lastMsgTs],
  );
  const activeRelativePath = useMemo(() => {
    if (!cwd || !activeFilePath) return null;
    return toRelativePath(cwd, activeFilePath);
  }, [activeFilePath, cwd]);

  useEffect(() => {
    if (!enabled) return;

    const cached = getCachedFilePanelData(cacheSessionId, fileAccessCacheKey);
    if (cached) {
      setFilePanelData(cached);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const next = computeFilePanelData(
        cacheSessionId,
        fileAccessCacheKey,
        messages,
        cwd,
        false,
      );
      if (cancelled) return;
      startTransition(() => setFilePanelData(next));
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cacheSessionId, cwd, enabled, fileAccessCacheKey, messages]);

  const accessByRelativePath = useMemo(() => {
    const map = new Map<string, FileAccess>();
    const files = filePanelData?.files ?? [];
    if (files.length === 0) return map;

    for (const file of files) {
      if (cwd && file.path.startsWith(`${cwd}/`)) {
        map.set(file.path.slice(cwd.length + 1), file);
        continue;
      }
      map.set(file.path, file);
    }
    return map;
  }, [cwd, filePanelData]);

  useEffect(() => {
    if (!activeRelativePath) return;
    setSelectedPath(activeRelativePath);
    const ancestorDirs = getAncestorDirs(activeRelativePath);
    if (ancestorDirs.length === 0) return;
    setExpandedDirs((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const dir of ancestorDirs) {
        if (!next.has(dir)) {
          next.add(dir);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeRelativePath]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setSearchCollapsedDirs(new Set()); // reset manual collapse state on new search
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 200);
  }, []);

  const toggleDir = useCallback((path: string) => {
    if (debouncedQuery.trim()) {
      // During search: toggle in the manually-collapsed set
      setSearchCollapsedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    } else {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    }
  }, [debouncedQuery]);

  const runPathAction = useCallback(async () => {
    if (!cwd) return;
    const value = pathDialog.value.trim();
    if (!value) return;

    if (pathDialog.mode === "new-file") {
      const result = await window.claude.files.createFile(cwd, value, "");
      if (result.error) {
        toast.error("Failed to create file", { description: result.error });
        return;
      }
      toast.success("File created");
      setPathDialog((prev) => ({ ...prev, open: false }));
      setSelectedPath(value);
      refresh();
      return;
    }

    if (pathDialog.mode === "new-folder") {
      const result = await window.claude.files.createDirectory(cwd, value);
      if (result.error) {
        toast.error("Failed to create folder", { description: result.error });
        return;
      }
      toast.success("Folder created");
      setPathDialog((prev) => ({ ...prev, open: false }));
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.add(value);
        return next;
      });
      setSelectedPath(value);
      refresh();
      return;
    }

    if (pathDialog.mode === "rename" && pathDialog.sourcePath) {
      const result = await window.claude.files.rename(cwd, pathDialog.sourcePath, value);
      if (result.error) {
        toast.error("Failed to rename/move", { description: result.error });
        return;
      }
      toast.success("Path updated");
      setPathDialog((prev) => ({ ...prev, open: false }));
      setSelectedPath(value);
      refresh();
    }
  }, [cwd, pathDialog, refresh]);

  const openCreateDialog = useCallback((mode: "new-file" | "new-folder", baseDir: string) => {
    const defaultName = mode === "new-file" ? "new-file.txt" : "new-folder";
    const initialPath = joinRelativePath(baseDir, defaultName);
    setPathDialog({
      open: true,
      mode,
      title: mode === "new-file" ? "Create File" : "Create Folder",
      description: "Enter a relative path in the project.",
      value: initialPath,
      confirmLabel: mode === "new-file" ? "Create File" : "Create Folder",
    });
  }, []);

  const openRenameDialog = useCallback((node: FileTreeNode) => {
    setPathDialog({
      open: true,
      mode: "rename",
      title: "Rename or Move",
      description: "Change the relative path.",
      value: node.path,
      confirmLabel: "Save",
      sourcePath: node.path,
    });
  }, []);

  const openFileInWorkspace = useCallback((
    node: FileTreeNode,
    options?: { event?: React.MouseEvent<HTMLDivElement>; openInFloating?: boolean },
  ) => {
    if (!cwd || node.type !== "file" || !onOpenFileInWorkspace) return;
    setSelectedPath(node.path);
    const absolutePath = `${cwd}/${node.path}`;
    if (options?.event?.altKey && onPreviewFile) {
      const rect = options.event.currentTarget.getBoundingClientRect();
      onPreviewFile(absolutePath, rect);
      return;
    }
    onOpenFileInWorkspace(absolutePath, undefined, options?.openInFloating ?? false);
  }, [cwd, onOpenFileInWorkspace, onPreviewFile]);

  const deletePath = useCallback(async () => {
    if (!cwd || !deleteTarget) return;
    const result = await window.claude.files.delete(cwd, deleteTarget);
    if (result.error) {
      toast.error("Failed to delete path", { description: result.error });
      return;
    }
    toast.success("Removed");
    if (selectedPath === deleteTarget) setSelectedPath(null);
    setDeleteTarget(null);
    refresh();
  }, [cwd, deleteTarget, refresh, selectedPath]);

  const renamePath = useCallback(async (fromPath: string, toPath: string) => {
    if (!cwd) return false;
    const result = await window.claude.files.rename(cwd, fromPath, toPath);
    if (result.error) {
      toast.error("Failed to move path", { description: result.error });
      return false;
    }
    setSelectedPath(toPath);
    refresh();
    return true;
  }, [cwd, refresh]);

  const copyPath = useCallback(async (fromPath: string, toPath: string) => {
    if (!cwd) return false;
    const result = await window.claude.files.copy(cwd, fromPath, toPath);
    if (result.error) {
      toast.error("Failed to copy path", { description: result.error });
      return false;
    }
    setSelectedPath(toPath);
    refresh();
    return true;
  }, [cwd, refresh]);

  const buildDuplicatePath = useCallback((sourcePath: string) => {
    const parentDir = getParentDir(sourcePath);
    const base = getBaseName(sourcePath);
    const sourceNode = nodeByPath.get(sourcePath);
    const existing = new Set(nodeByPath.keys());

    const mkName = (i: number): string => {
      if (sourceNode?.type === "directory") {
        return i === 0 ? `${base} copy` : `${base} copy ${i + 1}`;
      }
      const { stem, ext } = stripExtension(base);
      const name = i === 0 ? `${stem} copy${ext}` : `${stem} copy ${i + 1}${ext}`;
      return name;
    };

    for (let i = 0; i < 500; i++) {
      const candidate = joinRelativePath(parentDir, mkName(i));
      if (!existing.has(candidate)) return candidate;
    }
    return joinRelativePath(parentDir, `${base}-copy-${Date.now()}`);
  }, [nodeByPath]);

  const handleDuplicate = useCallback(async (sourcePath: string) => {
    const targetPath = buildDuplicatePath(sourcePath);
    const ok = await copyPath(sourcePath, targetPath);
    if (ok) {
      toast.success("Path duplicated");
    }
  }, [buildDuplicatePath, copyPath]);

  const handlePasteInto = useCallback(async (targetDir: string) => {
    if (!clipboardItem) return;
    const sourceNode = nodeByPath.get(clipboardItem.path);
    if (!sourceNode) {
      toast.error("Source item no longer exists");
      setClipboardItem(null);
      return;
    }

    if (clipboardItem.mode === "cut" && isPathInside(targetDir, clipboardItem.path)) {
      toast.error("Cannot move a folder into itself");
      return;
    }

    const targetPath = joinRelativePath(targetDir, getBaseName(clipboardItem.path));
    if (clipboardItem.mode === "cut") {
      const ok = await renamePath(clipboardItem.path, targetPath);
      if (ok) {
        toast.success("Path moved");
        setClipboardItem(null);
      }
      return;
    }
    const ok = await copyPath(clipboardItem.path, targetPath);
    if (ok) {
      toast.success("Path pasted");
    }
  }, [clipboardItem, copyPath, nodeByPath, renamePath]);

  const handleKeyboard = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selectedNode) return;
    const key = e.key;
    const mod = e.metaKey || e.ctrlKey;

    if (key === "F2") {
      e.preventDefault();
      openRenameDialog(selectedNode);
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      e.preventDefault();
      setDeleteTarget(selectedNode.path);
      return;
    }
    if (key === "Enter") {
      e.preventDefault();
      if (selectedNode.type === "directory") {
        toggleDir(selectedNode.path);
      } else {
        openFileInWorkspace(selectedNode);
      }
      return;
    }
    if (mod && key.toLowerCase() === "c") {
      e.preventDefault();
      setClipboardItem({ path: selectedNode.path, mode: "copy" });
      return;
    }
    if (mod && key.toLowerCase() === "x") {
      e.preventDefault();
      setClipboardItem({ path: selectedNode.path, mode: "cut" });
      return;
    }
    if (mod && key.toLowerCase() === "v") {
      e.preventDefault();
      const targetDir = selectedNode.type === "directory" ? selectedNode.path : getParentDir(selectedNode.path);
      void handlePasteInto(targetDir);
    }
  }, [handlePasteInto, openFileInWorkspace, openRenameDialog, selectedNode, toggleDir]);

  const getDefaultBaseDir = useCallback((): string => {
    if (!selectedNode) return "";
    if (selectedNode.type === "directory") return selectedNode.path;
    return getParentDir(selectedNode.path);
  }, [selectedNode]);

  const handleRowClick = useCallback((node: FileTreeNode) => {
    setSelectedPath(node.path);
  }, []);

  const handleRowOpenFile = useCallback((
    node: FileTreeNode,
    options: { event: React.MouseEvent<HTMLDivElement>; openInFloating: boolean },
  ) => {
    if (node.type !== "file") return;
    openFileInWorkspace(node, options);
  }, [openFileInWorkspace]);

  if (!cwd) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader icon={FolderTree} label="Project Files" iconClass="text-teal-600/70 dark:text-teal-200/50" />
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-xs text-muted-foreground">No project selected</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col outline-none"
      tabIndex={0}
      onKeyDown={handleKeyboard}
      onMouseDown={() => containerRef.current?.focus()}
    >
      <PanelHeader icon={FolderTree} label="Project Files" iconClass="text-teal-600/70 dark:text-teal-200/50">
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
              className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/50 transition-all duration-150 hover:bg-foreground/[0.06] hover:text-muted-foreground active:scale-90"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <p className="text-xs">Refresh files</p>
          </TooltipContent>
        </Tooltip>
      </PanelHeader>

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

      <div className="flex items-center border-b border-foreground/[0.08] px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]">
              <Plus className="me-1 h-3.5 w-3.5" />
              Create
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start">
            <DropdownMenuItem onClick={() => openCreateDialog("new-file", getDefaultBaseDir())}>
              <FilePlus2 className="me-2 h-3.5 w-3.5" />
              New File
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openCreateDialog("new-folder", getDefaultBaseDir())}>
              <FolderPlus className="me-2 h-3.5 w-3.5" />
              New Folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {clipboardItem && (
        <div className="border-b border-foreground/[0.08] px-2 py-1 text-[10px] text-muted-foreground/70">
          {clipboardItem.mode === "cut" ? "Cut" : "Copy"}: <span className="font-mono">{clipboardItem.path}</span>
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
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

        {flatItems.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const item = flatItems[virtualItem.index];
              const access = item.node.type === "file"
                ? accessByRelativePath.get(item.node.path)
                : undefined;
              return (
                <div
                  key={item.node.path}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <FileTreeRow
                    node={item.node}
                    cwd={cwd}
                    depth={item.depth}
                    isExpanded={item.isExpanded}
                    isSelected={selectedPath === item.node.path}
                    accessType={access?.accessType}
                    accessRangeText={access ? formatRanges(access) : null}
                    onClick={handleRowClick}
                    onOpenFile={handleRowOpenFile}
                    onToggleDir={toggleDir}
                    onCreateFile={() => openCreateDialog("new-file", item.node.type === "directory" ? item.node.path : getParentDir(item.node.path))}
                    onCreateFolder={() => openCreateDialog("new-folder", item.node.type === "directory" ? item.node.path : getParentDir(item.node.path))}
                    onOpenInWorkspace={openFileInWorkspace}
                    onRename={openRenameDialog}
                    onDuplicate={handleDuplicate}
                    onCopy={(path) => setClipboardItem({ path, mode: "copy" })}
                    onCut={(path) => setClipboardItem({ path, mode: "cut" })}
                    onPaste={(targetDir) => void handlePasteInto(targetDir)}
                    onDelete={(path) => setDeleteTarget(path)}
                    draggingPath={draggingPath}
                    dragOverDir={dragOverDir}
                    onDragStart={(path) => setDraggingPath(path)}
                    onDragEnd={() => {
                      setDraggingPath(null);
                      setDragOverDir(null);
                    }}
                    onDragOverDir={(path) => setDragOverDir(path)}
                    onDropToDir={(targetDir) => {
                      if (!draggingPath || draggingPath === targetDir) return;
                      if (isPathInside(targetDir, draggingPath)) {
                        toast.error("Cannot move a folder into itself");
                        return;
                      }
                      const targetPath = joinRelativePath(targetDir, getBaseName(draggingPath));
                      void renamePath(draggingPath, targetPath).then((ok) => {
                        if (ok) toast.success("Path moved");
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={pathDialog.open} onOpenChange={(open) => setPathDialog((prev) => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pathDialog.title}</DialogTitle>
            <DialogDescription>{pathDialog.description}</DialogDescription>
          </DialogHeader>
          <Input
            value={pathDialog.value}
            onChange={(e) => setPathDialog((prev) => ({ ...prev, value: e.target.value }))}
            placeholder="relative/path"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runPathAction();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPathDialog((prev) => ({ ...prev, open: false }))}>
              Cancel
            </Button>
            <Button onClick={() => void runPathAction()}>{pathDialog.confirmLabel}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => void deletePath()}
        title="Delete path"
        description={
          <p className="text-sm text-muted-foreground">
            This will permanently delete <span className="font-mono text-foreground">{deleteTarget ?? ""}</span>.
          </p>
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
      />
    </div>
  );
});

interface FileTreeRowProps {
  node: FileTreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  cwd: string;
  accessType?: AccessType;
  accessRangeText?: string | null;
  onClick: (node: FileTreeNode) => void;
  onOpenFile: (
    node: FileTreeNode,
    options: { event: React.MouseEvent<HTMLDivElement>; openInFloating: boolean },
  ) => void;
  onToggleDir: (path: string) => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onOpenInWorkspace: (node: FileTreeNode, options?: { openInFloating?: boolean }) => void;
  onRename: (node: FileTreeNode) => void;
  onDuplicate: (path: string) => void;
  onCopy: (path: string) => void;
  onCut: (path: string) => void;
  onPaste: (targetDir: string) => void;
  onDelete: (path: string) => void;
  draggingPath: string | null;
  dragOverDir: string | null;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  onDragOverDir: (path: string | null) => void;
  onDropToDir: (path: string) => void;
}

const FileTreeRow = memo(function FileTreeRow({
  node,
  depth,
  isExpanded,
  isSelected,
  cwd,
  accessType,
  accessRangeText,
  onClick,
  onOpenFile,
  onToggleDir,
  onCreateFile,
  onCreateFolder,
  onOpenInWorkspace,
  onRename,
  onDuplicate,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  draggingPath,
  dragOverDir,
  onDragStart,
  onDragEnd,
  onDragOverDir,
  onDropToDir,
}: FileTreeRowProps) {
  const isDir = node.type === "directory";
  const isDropTarget = isDir && dragOverDir === node.path;
  const isDragging = draggingPath === node.path;
  const accessBadgeClass = accessType === "created"
    ? "border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
    : accessType === "modified"
      ? "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300"
      : accessType === "read"
        ? "border-blue-500/35 bg-blue-500/12 text-blue-700 dark:text-blue-300"
        : "";
  const accessLabel = accessType === "created"
    ? "new"
    : accessType === "modified"
      ? "mod"
      : accessType === "read"
        ? "read"
        : null;
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      onClick(node);
      if (isDir) onToggleDir(node.path);
      else onOpenFile(node, { event: e, openInFloating: e.detail >= 2 });
    },
    [isDir, node, onClick, onOpenFile, onToggleDir],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={handleClick}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-harnss-path", node.path);
            e.dataTransfer.setData("application/x-harnss-is-dir", String(node.type === "directory"));
            onDragStart(node.path);
          }}
          onDragEnd={onDragEnd}
          onDragOver={(e) => {
            if (!isDir) return;
            if (draggingPath == null || draggingPath === node.path) return;
            e.preventDefault();
            onDragOverDir(node.path);
          }}
          onDragLeave={() => {
            if (isDir && isDropTarget) onDragOverDir(null);
          }}
          onDrop={(e) => {
            if (!isDir) return;
            e.preventDefault();
            onDragOverDir(null);
            onDropToDir(node.path);
          }}
          className={`group flex min-h-7 items-center gap-2 pe-1.5 py-1 transition-colors duration-75 ${
            isSelected ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.05]"
          } ${isDropTarget ? "ring-1 ring-primary/45" : ""} ${isDragging ? "opacity-60" : ""} cursor-pointer`}
          style={{ paddingInlineStart: depth * 14 + 8 }}
        >
      {isDir ? (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <ChevronRight
            className={`h-3 w-3 text-muted-foreground/50 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
          />
        </span>
      ) : (
        <span className="h-3.5 w-3.5 shrink-0" />
      )}

      <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-sm bg-foreground/[0.03] transition-colors duration-150 group-hover:bg-foreground/[0.06]">
        {isDir && isExpanded && <FolderOpen className="h-3.25 w-3.25 text-amber-400/80" />}
        {isDir && !isExpanded && <Folder className="h-3.25 w-3.25 text-amber-400/80" />}
        {!isDir && <File className={`h-3.25 w-3.25 ${getFileIconColor(node.extension)}`} />}
      </span>

      <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">{node.name}</span>
      {!isDir && accessLabel && (
        <span className={`shrink-0 rounded border px-1 py-0 text-[9px] uppercase tracking-wide ${accessBadgeClass}`}>
          {accessLabel}
        </span>
      )}
      {!isDir && accessRangeText && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">
          {accessRangeText}
        </span>
      )}

          {!isDir && (
            <div className="ms-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <OpenInEditorButton filePath={`${cwd}/${node.path}`} />
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {isDir && (
          <>
            <ContextMenuItem onClick={onCreateFile}>
              <FilePlus2 className="me-2 h-3.5 w-3.5" />
              New File
            </ContextMenuItem>
            <ContextMenuItem onClick={onCreateFolder}>
              <FolderPlus className="me-2 h-3.5 w-3.5" />
              New Folder
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {!isDir && (
          <ContextMenuItem onClick={() => onOpenInWorkspace(node)}>
            <FileCog className="me-2 h-3.5 w-3.5" />
            Open in Workspace
          </ContextMenuItem>
        )}
        {!isDir && (
          <ContextMenuItem onClick={() => onOpenInWorkspace(node, { openInFloating: true })}>
            <FileCog className="me-2 h-3.5 w-3.5" />
            Open in Floating Editor
          </ContextMenuItem>
        )}
        {!isDir && (
          <ContextMenuItem onClick={() => window.claude.openInEditor(`${cwd}/${node.path}`)}>
            <ExternalLink className="me-2 h-3.5 w-3.5" />
            Open in External Editor
          </ContextMenuItem>
        )}
        {!isDir && <ContextMenuSeparator />}
        <ContextMenuItem onClick={() => onRename(node)}>
          <SquarePen className="me-2 h-3.5 w-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onDuplicate(node.path)}>
          <CopyPlus className="me-2 h-3.5 w-3.5" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCopy(node.path)}>
          <Copy className="me-2 h-3.5 w-3.5" />
          Copy
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCut(node.path)}>
          <CornerLeftDown className="me-2 h-3.5 w-3.5" />
          Cut
        </ContextMenuItem>
        {isDir && (
          <ContextMenuItem onClick={() => onPaste(node.path)}>
            <ClipboardPaste className="me-2 h-3.5 w-3.5" />
            Paste
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onDelete(node.path)} variant="destructive">
          <Trash2 className="me-2 h-3.5 w-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
