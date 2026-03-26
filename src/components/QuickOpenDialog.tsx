import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, File, AlignLeft, Folder, Regex } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { parseQuickOpenQuery, rankQuickOpenMatches } from "@/lib/quick-open";
import { reportError } from "@/lib/analytics";

type QuickMode = "file" | "text" | "folder" | "regex";

interface QuickOpenDialogProps {
  open: boolean;
  cwd?: string;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (absolutePath: string, line?: number) => void;
}

function detectMode(query: string): { mode: QuickMode; cleanQuery: string } {
  if (query.startsWith(">")) return { mode: "text", cleanQuery: query.slice(1).trimStart() };
  if (query.startsWith("#")) return { mode: "folder", cleanQuery: query.slice(1).trimStart() };
  if (query.startsWith("/")) return { mode: "regex", cleanQuery: query.slice(1) };
  return { mode: "file", cleanQuery: query };
}

const MODE_HINTS: Array<{ prefix: string; label: string; icon: typeof File; desc: string }> = [
  { prefix: "", label: "File", icon: File, desc: "Search by file name" },
  { prefix: ">", label: "Text", icon: AlignLeft, desc: "Search file contents" },
  { prefix: "#", label: "Folder", icon: Folder, desc: "Search folders" },
  { prefix: "/", label: "Regex", icon: Regex, desc: "Search with regex" },
];

export const QuickOpenDialog = memo(function QuickOpenDialog({
  open,
  cwd,
  onOpenChange,
  onOpenFile,
}: QuickOpenDialogProps) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [textResults, setTextResults] = useState<Array<{ file: string; line: number; preview: string }>>([]);
  const [textSearching, setTextSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { mode, cleanQuery } = useMemo(() => detectMode(query), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    setTextResults([]);
  }, [open]);

  useEffect(() => {
    if (!open || !cwd) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    window.claude.files.listAll(cwd)
      .then((result) => {
        if (cancelled) return;
        setFiles(result.files);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = reportError("QUICK_OPEN_LIST_FILES_ERR", err, { cwd });
        setError(message);
        setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [cwd, open]);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!cwd || !window.claude?.search) return;
    if ((mode === "text" || mode === "regex") && cleanQuery.length >= 2) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setTextSearching(true);
        try {
          const result = await window.claude.search.content({
            cwd,
            pattern: cleanQuery,
            isRegex: mode === "regex",
            maxResults: 50,
          });
          setTextResults(result.results || []);
        } finally {
          setTextSearching(false);
        }
      }, 300);
    } else {
      setTextResults([]);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [cwd, mode, cleanQuery]);

  const fileMatches = useMemo(
    () => rankQuickOpenMatches(files, cleanQuery, 300),
    [files, cleanQuery],
  );

  const folderMatches = useMemo(() => {
    if (mode !== "folder" || !cleanQuery) return [];
    const seen = new Set<string>();
    const dirs: Array<{ path: string; score: number }> = [];
    for (const m of fileMatches) {
      const dir = m.path.split("/").slice(0, -1).join("/");
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        dirs.push({ path: dir, score: m.score });
      }
    }
    return dirs;
  }, [mode, cleanQuery, fileMatches]);

  const totalItems = mode === "file" ? fileMatches.length
    : mode === "folder" ? folderMatches.length
    : textResults.length;

  useEffect(() => {
    if (selectedIndex >= totalItems) setSelectedIndex(0);
  }, [totalItems, selectedIndex]);

  const handlePick = useCallback((relativePath: string, line?: number) => {
    if (!cwd) return;
    onOpenFile(`${cwd}/${relativePath}`, line);
    onOpenChange(false);
  }, [cwd, onOpenChange, onOpenFile]);

  const handlePickFile = useCallback((relativePath: string) => {
    if (!cwd) return;
    const parsed = parseQuickOpenQuery(query);
    onOpenFile(`${cwd}/${relativePath}`, parsed.line);
    onOpenChange(false);
  }, [cwd, onOpenChange, onOpenFile, query]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (totalItems === 0 ? 0 : (prev + 1) % totalItems));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (totalItems === 0 ? 0 : (prev - 1 + totalItems) % totalItems));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "file") {
        const item = fileMatches[selectedIndex];
        if (item) handlePickFile(item.path);
      } else if (mode === "folder") {
        const item = folderMatches[selectedIndex];
        if (item) handlePick(item.path);
      } else {
        const item = textResults[selectedIndex];
        if (item) handlePick(item.file, item.line);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  }, [handlePick, handlePickFile, fileMatches, folderMatches, textResults, mode, onOpenChange, selectedIndex, totalItems]);

  const placeholder = mode === "file" ? "Go to file... (ex: src/App.tsx:42)"
    : mode === "text" ? "Search file contents..."
    : mode === "folder" ? "Search folders..."
    : "Regex pattern...";

  const showHints = query === "" && !loading;
  const isSearching = loading || textSearching;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-2xl p-0" showCloseButton={false}>
        <div className="border-b border-foreground/[0.08] px-4 py-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground/60" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={placeholder}
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
            {mode !== "file" && (
              <span className="shrink-0 rounded bg-foreground/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-foreground/50">
                {mode}
              </span>
            )}
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1">
          {isSearching && (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-muted-foreground/70">
              <Loader2 className="h-4 w-4 animate-spin" />
              {loading ? "Indexing project files..." : "Searching..."}
            </div>
          )}

          {!isSearching && error && (
            <p className="px-4 py-6 text-xs text-destructive">{error}</p>
          )}

          {showHints && (
            <div className="px-2 py-2">
              {MODE_HINTS.map((hint) => {
                const Icon = hint.icon;
                return (
                  <button
                    key={hint.label}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-foreground/[0.04]"
                    onClick={() => setQuery(hint.prefix)}
                  >
                    <Icon className="h-3.5 w-3.5 text-foreground/40" />
                    <div className="flex flex-1 items-center gap-2">
                      <span className="text-sm text-foreground/70">{hint.desc}</span>
                      {hint.prefix && (
                        <kbd className="rounded bg-foreground/[0.07] px-1.5 py-px font-mono text-[10px] text-foreground/45">
                          {hint.prefix}
                        </kbd>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!isSearching && !error && mode === "file" && cleanQuery && fileMatches.length === 0 && (
            <p className="px-4 py-6 text-xs text-muted-foreground/70">No matching files</p>
          )}

          {!isSearching && !error && mode === "file" && fileMatches.map((item, index) => {
            const fileName = item.path.split("/").pop() ?? item.path;
            const dir = item.path.slice(0, Math.max(0, item.path.length - fileName.length)).replace(/\/$/, "");
            const isSelected = index === selectedIndex;

            return (
              <button
                key={item.path}
                type="button"
                onClick={() => handlePickFile(item.path)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left transition-colors ${
                  isSelected ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]"
                }`}
              >
                <File className="h-3.5 w-3.5 shrink-0 text-foreground/30" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{fileName}</span>
                <span className="truncate text-xs text-muted-foreground/60">{dir}</span>
              </button>
            );
          })}

          {!isSearching && !error && mode === "folder" && cleanQuery && folderMatches.length === 0 && (
            <p className="px-4 py-6 text-xs text-muted-foreground/70">No matching folders</p>
          )}

          {!isSearching && !error && mode === "folder" && folderMatches.map((item, index) => {
            const isSelected = index === selectedIndex;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => handlePick(item.path)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left transition-colors ${
                  isSelected ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]"
                }`}
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400/60" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{item.path}</span>
              </button>
            );
          })}

          {!textSearching && (mode === "text" || mode === "regex") && cleanQuery.length >= 2 && textResults.length === 0 && (
            <p className="px-4 py-6 text-xs text-muted-foreground/70">No matches found</p>
          )}

          {!textSearching && (mode === "text" || mode === "regex") && textResults.map((item, index) => {
            const isSelected = index === selectedIndex;
            const fileName = item.file.split("/").pop() ?? item.file;
            return (
              <button
                key={`${item.file}:${item.line}:${index}`}
                type="button"
                onClick={() => handlePick(item.file, item.line)}
                className={`flex w-full items-center gap-2 px-4 py-1.5 text-left transition-colors ${
                  isSelected ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]"
                }`}
              >
                <AlignLeft className="h-3 w-3 shrink-0 text-foreground/30" />
                <span className="shrink-0 text-xs font-medium text-foreground/70">{fileName}</span>
                <span className="shrink-0 font-mono text-[10px] text-foreground/35">:{item.line}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/50">{item.preview}</span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
});
