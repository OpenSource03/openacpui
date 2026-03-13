import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitCompare, Maximize2, Minimize2, MonitorUp, MoreHorizontal, PanelTopClose, Save, SquarePen, WrapText, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isMac } from "@/lib/utils";
import Editor, { DiffEditor, type DiffOnMount, type OnMount } from "@monaco-editor/react";
import { diffLines } from "diff";
import { Button } from "@/components/ui/button";
import { useResolvedThemeClass } from "@/hooks/useResolvedThemeClass";
import { reportError } from "@/lib/analytics";
import { getLanguageFromPath } from "@/lib/languages";
import { getMonacoThemeForEditor } from "@/hooks/useEditorTheme";

type EditorTab = {
  id: string;
  relativePath: string;
  content: string;
  savedContent: string;
  gitHeadContent: string | null;
  showDiff: boolean;
  loading: boolean;
  error: string | null;
};

export interface CodeOpenRequest {
  id: number;
  filePath: string;
  line?: number;
  openInFloating?: boolean;

}

interface CodeWorkspaceProps {
  cwd?: string;
  showDocked: boolean;
  openRequest: CodeOpenRequest | null;
  forceOpenFloatingToken?: number;
  isDockedMaximized: boolean;
  sidebarOpen?: boolean;
  onOpenRequestHandled: (id: number) => void;
  onRequestQuickOpen: () => void;
  onToggleDockedMaximize: () => void;
  onActiveFilePathChange?: (filePath: string | null) => void;
  onAddToChat?: (code: string, filePath: string, lineStart: number, lineEnd: number, targetPane?: number) => void;
  splitMode?: boolean;
}

type FloatingRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DEFAULT_FLOATING_RECT: FloatingRect = {
  x: 36,
  y: 28,
  width: 760,
  height: 460,
};

const EDITOR_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

function getMonacoLanguage(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? "";
  const lowerName = fileName.toLowerCase();
  if (lowerName === "dockerfile") return "dockerfile";
  if (lowerName === "makefile" || lowerName === "gnumakefile") return "plaintext";
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : undefined;
  switch (extension) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
    case "jsonc":
      return "json";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "less":
      return "less";
    case "html":
      return "html";
    case "md":
    case "mdx":
      return "markdown";
    case "yaml":
    case "yml":
      return "yaml";
    case "xml":
    case "svg":
      return "xml";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "java":
      return "java";
    case "kt":
      return "kotlin";
    case "cs":
      return "csharp";
    case "rb":
      return "ruby";
    case "php":
      return "php";
    case "swift":
      return "swift";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "sql":
      return "sql";
    case "graphql":
    case "gql":
      return "graphql";
    case "c":
      return "c";
    case "cpp":
    case "hpp":
      return "cpp";
    case "toml":
      return "toml";
    default:
      return "plaintext";
  }
}

function getFileLabel(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toRelativePath(cwd: string | undefined, filePath: string): string {
  if (!cwd) return filePath;
  if (filePath === cwd) return "";
  const prefix = `${cwd}/`;
  if (!filePath.startsWith(prefix)) return filePath;
  return filePath.slice(prefix.length);
}

function getChunkLineCount(value: string): number {
  if (value.length === 0) return 0;
  const parts = value.split("\n");
  return value.endsWith("\n") ? Math.max(0, parts.length - 1) : parts.length;
}

type LineHookKind = "added" | "modified" | "deleted";

interface LineHook {
  kind: LineHookKind;
  lineNumber: number;
  beforeText: string;
  afterText: string;
}

interface LineChangeSummary {
  hooks: LineHook[];
  changedLines: number[];
  addedLines: number;
  removedLines: number;
}

function splitDiffLines(value: string): string[] {
  if (value.length === 0) return [];
  const parts = value.split("\n");
  if (value.endsWith("\n")) parts.pop();
  return parts;
}

function formatHookText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "empty";
  return compact.length > 52 ? `${compact.slice(0, 52)}...` : compact;
}

function getHookPreview(hook: LineHook): string {
  if (hook.kind === "added") return `+ ${formatHookText(hook.afterText)}`;
  if (hook.kind === "deleted") return `- ${formatHookText(hook.beforeText)}`;
  return `~ ${formatHookText(hook.beforeText)} -> ${formatHookText(hook.afterText)}`;
}

function computeLineChangeSummary(previousValue: string, currentValue: string): LineChangeSummary {
  const hooks: LineHook[] = [];
  let nextLineNumber = 1;
  let addedLines = 0;
  let removedLines = 0;

  const parts = diffLines(previousValue, currentValue);
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex];
    const lineCount = getChunkLineCount(part.value);
    if (lineCount === 0) continue;
    if (part.added) {
      const added = splitDiffLines(part.value);
      addedLines += lineCount;
      for (let index = 0; index < added.length; index += 1) {
        hooks.push({
          kind: "added",
          lineNumber: Math.max(1, nextLineNumber + index),
          beforeText: "",
          afterText: added[index] ?? "",
        });
      }
      nextLineNumber += lineCount;
      continue;
    }
    if (part.removed) {
      const removed = splitDiffLines(part.value);
      removedLines += lineCount;
      const nextPart = parts[partIndex + 1];
      if (nextPart && nextPart.added) {
        const added = splitDiffLines(nextPart.value);
        addedLines += getChunkLineCount(nextPart.value);
        const maxLen = Math.max(removed.length, added.length);
        for (let index = 0; index < maxLen; index += 1) {
          const beforeText = removed[index] ?? "";
          const afterText = added[index] ?? "";
          const kind: LineHookKind = beforeText && afterText
            ? "modified"
            : beforeText
              ? "deleted"
              : "added";
          const anchorOffset = added.length === 0 ? 0 : Math.min(index, added.length - 1);
          hooks.push({
            kind,
            lineNumber: Math.max(1, nextLineNumber + anchorOffset),
            beforeText,
            afterText,
          });
        }
        nextLineNumber += added.length;
        partIndex += 1;
        continue;
      }
      for (const beforeText of removed) {
        hooks.push({
          kind: "deleted",
          lineNumber: Math.max(1, nextLineNumber),
          beforeText,
          afterText: "",
        });
      }
      continue;
    }
    nextLineNumber += lineCount;
  }

  const changedLines = Array.from(new Set(hooks.map((hook) => hook.lineNumber))).sort((a, b) => a - b);

  return {
    hooks,
    changedLines,
    addedLines,
    removedLines,
  };
}

export const CodeWorkspace = memo(function CodeWorkspace({
  cwd,
  showDocked,
  openRequest,
  forceOpenFloatingToken,
  isDockedMaximized,
  sidebarOpen,
  onOpenRequestHandled,
  onRequestQuickOpen,
  onToggleDockedMaximize,
  onActiveFilePathChange,
  onAddToChat,
  splitMode,
}: CodeWorkspaceProps) {
  type MonacoEditorInstance = Parameters<OnMount>[0];
  type MonacoInstance = Parameters<OnMount>[1];
  const resolvedTheme = useResolvedThemeClass();
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [floatingMaximized, setFloatingMaximized] = useState(false);
  const [showLineHooks, setShowLineHooks] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number } | null>(null);
  const [floatingRect, setFloatingRect] = useState<FloatingRect>(DEFAULT_FLOATING_RECT);
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const monacoRef = useRef<MonacoInstance | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const diffChangeDisposeRef = useRef<{ dispose: () => void } | null>(null);
  const pendingLineRef = useRef<number | null>(null);
  const openingPathsRef = useRef(new Set<string>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const onAddToChatRef = useRef(onAddToChat);
  onAddToChatRef.current = onAddToChat;
  const splitModeRef = useRef(splitMode);
  splitModeRef.current = splitMode;

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );
  const activeAbsolutePath = useMemo(() => {
    if (!activeTab) return null;
    if (!cwd) return activeTab.relativePath;
    if (!activeTab.relativePath) return cwd;
    if (activeTab.relativePath.startsWith("/") || activeTab.relativePath.startsWith(`${cwd}/`)) {
      return activeTab.relativePath;
    }
    return `${cwd}/${activeTab.relativePath}`;
  }, [activeTab, cwd]);

  const lineChangeSummary = useMemo(() => {
    if (!activeTab) {
      return {
        hooks: [] as LineHook[],
        changedLines: [] as number[],
        addedLines: 0,
        removedLines: 0,
      };
    }
    const baseline = activeTab.gitHeadContent ?? activeTab.savedContent;
    return computeLineChangeSummary(baseline, activeTab.content);
  }, [activeTab]);

  const openFile = useCallback(async (absolutePath: string, line?: number) => {
    const nextRelativePath = toRelativePath(cwd, absolutePath);
    if (cwd && !absolutePath.startsWith(`${cwd}/`)) return;

    const existing = tabs.find((tab) => tab.relativePath === nextRelativePath);
    if (existing) {
      setActiveTabId(existing.id);
      pendingLineRef.current = line ?? null;
      return;
    }

    if (openingPathsRef.current.has(nextRelativePath)) return;
    openingPathsRef.current.add(nextRelativePath);
    const newTabId = `${Date.now()}-${nextRelativePath}`;
    setTabs((prev) => [
      ...prev,
      {
        id: newTabId,
        relativePath: nextRelativePath,
        content: "",
        savedContent: "",
        gitHeadContent: null,
        showDiff: false,
        loading: true,
        error: null,
      },
    ]);
    setActiveTabId(newTabId);
    pendingLineRef.current = line ?? null;

    try {
      const [result, gitResult] = await Promise.all([
        window.claude.readFile(absolutePath),
        cwd
          ? window.claude.git.showFileAtHead(cwd, nextRelativePath).catch(() => ({ error: "no-git" as const }))
          : Promise.resolve(null),
      ]);
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== newTabId) return tab;
          if (result.error) {
            return { ...tab, loading: false, error: result.error };
          }
          const content = result.content ?? "";
          const gitHeadContent = gitResult && "content" in gitResult && gitResult.content !== undefined ? gitResult.content : null;
          const showDiff = gitHeadContent !== null && gitHeadContent !== content;
          return {
            ...tab,
            loading: false,
            content,
            savedContent: content,
            gitHeadContent,
            showDiff,
            error: null,
          };
        }),
      );
    } catch (err) {
      const message = reportError("CODE_WORKSPACE_OPEN_FILE_ERR", err, { path: nextRelativePath });
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== newTabId) return tab;
          return { ...tab, loading: false, error: message };
        }),
      );
    } finally {
      openingPathsRef.current.delete(nextRelativePath);
    }
  }, [cwd, tabs]);

  useEffect(() => {
    if (!openRequest) return;
    void openFile(openRequest.filePath, openRequest.line);
    if (openRequest.openInFloating) setFloatingOpen(true);
    onOpenRequestHandled(openRequest.id);
  }, [onOpenRequestHandled, openFile, openRequest]);

  useEffect(() => {
    if (!forceOpenFloatingToken) return;
    setFloatingOpen(true);
  }, [forceOpenFloatingToken]);

  useEffect(() => {
    onActiveFilePathChange?.(activeAbsolutePath);
  }, [activeAbsolutePath, onActiveFilePathChange]);

  useEffect(() => {
    return () => {
      onActiveFilePathChange?.(null);
    };
  }, [onActiveFilePathChange]);

  const updateActiveContent = useCallback((value: string | undefined) => {
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeTabId
        ? { ...tab, content: value ?? "" }
        : tab
    )));
  }, [activeTabId]);

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const target = prev.find((tab) => tab.id === tabId);
      const isDirty = target ? target.content !== target.savedContent : false;
      if (isDirty) {
        const shouldClose = window.confirm("This tab has unsaved changes. Close anyway?");
        if (!shouldClose) return prev;
      }
      const next = prev.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        const nextActive = next[next.length - 1];
        setActiveTabId(nextActive ? nextActive.id : null);
      }
      return next;
    });
  }, [activeTabId]);

  const handleSave = useCallback(async () => {
    if (!cwd || !activeTab) return;
    if (activeTab.loading || activeTab.error) return;
    if (activeTab.content === activeTab.savedContent) return;

    setSaving(true);
    try {
      const result = await window.claude.files.writeFile(cwd, activeTab.relativePath, activeTab.content);
      if (result.error) return;
      setTabs((prev) => prev.map((tab) => (
        tab.id === activeTab.id
          ? { ...tab, savedContent: tab.content }
          : tab
      )));
    } catch (err) {
      reportError("CODE_WORKSPACE_SAVE_FILE_ERR", err, { path: activeTab.relativePath });
    } finally {
      setSaving(false);
    }
  }, [activeTab, cwd]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && key === "s") {
        if (!activeTabId) return;
        e.preventDefault();
        void handleSave();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && key === "w") {
        if (!activeTabId) return;
        e.preventDefault();
        handleCloseTab(activeTabId);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && key === "e") {
        e.preventDefault();
        setFloatingOpen((prev) => !prev);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && key === "g") {
        e.preventDefault();
        const lineStr = prompt("Go to line:");
        if (lineStr) {
          const lineNumber = parseInt(lineStr, 10);
          if (!isNaN(lineNumber) && editorRef.current) {
            editorRef.current.revealLineInCenter(lineNumber);
            editorRef.current.setPosition({ lineNumber, column: 1 });
            editorRef.current.focus();
          }
        }
        return;
      }
      const numKey = parseInt(key, 10);
      if ((e.metaKey || e.ctrlKey) && numKey >= 1 && numKey <= 9) {
        e.preventDefault();
        const idx = numKey - 1;
        if (idx < tabs.length) setActiveTabId(tabs[idx].id);
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, handleCloseTab, handleSave, tabs]);

  useEffect(() => {
    const line = pendingLineRef.current;
    if (!line || !editorRef.current) return;
    editorRef.current.revealLineInCenter(line);
    editorRef.current.setPosition({ lineNumber: line, column: 1 });
    editorRef.current.focus();
    pendingLineRef.current = null;
  }, [activeTabId, tabs]);

  const onEditorMount: OnMount = useCallback((editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;
    monacoRef.current = monacoInstance;
    editorInstance.onDidChangeCursorPosition((e: { position: { lineNumber: number; column: number } }) => {
      setCursorPosition({ line: e.position.lineNumber, column: e.position.column });
    });

    editorInstance.addAction({
      id: "add-to-chat",
      label: "Add Selection to Chat",
      keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyL],
      contextMenuGroupId: "9_cutcopypaste",
      contextMenuOrder: 5,
      run: (ed: typeof editorInstance) => {
        if (splitModeRef.current) return;
        const selection = ed.getSelection();
        if (!selection || selection.isEmpty()) return;
        const selectedText = ed.getModel()?.getValueInRange(selection) ?? "";
        const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
        if (!tab || !onAddToChatRef.current) return;
        onAddToChatRef.current(selectedText, tab.relativePath, selection.startLineNumber, selection.endLineNumber);
      },
    });

    editorInstance.addAction({
      id: "add-to-chat-pane-0",
      label: "Add to Chat 1",
      contextMenuGroupId: "9_cutcopypaste",
      contextMenuOrder: 6,
      run: (ed: typeof editorInstance) => {
        if (!splitModeRef.current) return;
        const selection = ed.getSelection();
        if (!selection || selection.isEmpty()) return;
        const selectedText = ed.getModel()?.getValueInRange(selection) ?? "";
        const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
        if (!tab || !onAddToChatRef.current) return;
        onAddToChatRef.current(selectedText, tab.relativePath, selection.startLineNumber, selection.endLineNumber, 0);
      },
    });

    editorInstance.addAction({
      id: "add-to-chat-pane-1",
      label: "Add to Chat 2",
      contextMenuGroupId: "9_cutcopypaste",
      contextMenuOrder: 7,
      run: (ed: typeof editorInstance) => {
        if (!splitModeRef.current) return;
        const selection = ed.getSelection();
        if (!selection || selection.isEmpty()) return;
        const selectedText = ed.getModel()?.getValueInRange(selection) ?? "";
        const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
        if (!tab || !onAddToChatRef.current) return;
        onAddToChatRef.current(selectedText, tab.relativePath, selection.startLineNumber, selection.endLineNumber, 1);
      },
    });

    editorInstance.addAction({
      id: "format-document",
      label: "Format Document",
      keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyF],
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 3,
      run: (ed: typeof editorInstance) => {
        ed.getAction("editor.action.formatDocument")?.run();
      },
    });

    editorInstance.addAction({
      id: "go-to-definition",
      label: "Go to Definition",
      keybindings: [monacoInstance.KeyCode.F12],
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1,
      run: (ed: typeof editorInstance) => {
        ed.getAction("editor.action.revealDefinition")?.run();
      },
    });

    editorInstance.addAction({
      id: "peek-definition",
      label: "Peek Definition",
      keybindings: [monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.F12],
      contextMenuGroupId: "navigation",
      contextMenuOrder: 2,
      run: (ed: typeof editorInstance) => {
        ed.getAction("editor.action.peekDefinition")?.run();
      },
    });
  }, []);

  const onDiffEditorMount: DiffOnMount = useCallback((diffEditor, monacoInstance) => {
    const modifiedEditor = diffEditor.getModifiedEditor();
    editorRef.current = modifiedEditor;
    monacoRef.current = monacoInstance;
    diffChangeDisposeRef.current?.dispose();
    diffChangeDisposeRef.current = modifiedEditor.onDidChangeModelContent(() => {
      updateActiveContent(modifiedEditor.getValue());
    });
  }, [updateActiveContent]);

  const clearLineDecorations = useCallback(() => {
    if (!editorRef.current || decorationIdsRef.current.length === 0) return;
    decorationIdsRef.current = editorRef.current.deltaDecorations(decorationIdsRef.current, []);
  }, []);

  const showDiff = activeTab?.showDiff ?? false;

  useEffect(() => {
    if (!activeTab || showDiff || !showLineHooks) {
      clearLineDecorations();
      return;
    }
    const editorInstance = editorRef.current;
    const monacoInstance = monacoRef.current;
    if (!editorInstance || !monacoInstance) return;
    const nextDecorations = lineChangeSummary.changedLines.map((lineNumber) => ({
      range: new monacoInstance.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        className: "code-workspace-changed-line",
        glyphMarginClassName: "code-workspace-changed-glyph",
      },
    }));
    decorationIdsRef.current = editorInstance.deltaDecorations(decorationIdsRef.current, nextDecorations);
  }, [activeTab, clearLineDecorations, lineChangeSummary.changedLines, showDiff, showLineHooks]);

  useEffect(() => {
    return () => {
      clearLineDecorations();
      diffChangeDisposeRef.current?.dispose();
    };
  }, [clearLineDecorations]);

  useEffect(() => {
    if (showDiff) return;
    diffChangeDisposeRef.current?.dispose();
    diffChangeDisposeRef.current = null;
  }, [showDiff]);

  const handleJumpToLine = useCallback((lineNumber: number) => {
    const editorInstance = editorRef.current;
    if (!editorInstance) return;
    editorInstance.revealLineInCenter(lineNumber);
    editorInstance.setPosition({ lineNumber, column: 1 });
    editorInstance.focus();
  }, []);

  const handleJumpToNextChange = useCallback(() => {
    const editorInstance = editorRef.current;
    if (!editorInstance || lineChangeSummary.changedLines.length === 0) return;
    const currentLine = editorInstance.getPosition()?.lineNumber ?? 1;
    const nextLine = lineChangeSummary.changedLines.find((line) => line > currentLine)
      ?? lineChangeSummary.changedLines[0];
    handleJumpToLine(nextLine);
  }, [handleJumpToLine, lineChangeSummary.changedLines]);

  const handleDragStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (floatingMaximized) return;
    const root = rootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const startRect = floatingRect;
    const startX = event.clientX;
    const startY = event.clientY;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const maxX = Math.max(12, rootRect.width - startRect.width - 12);
      const maxY = Math.max(12, rootRect.height - startRect.height - 12);
      setFloatingRect({
        ...startRect,
        x: clampNumber(startRect.x + dx, 12, maxX),
        y: clampNumber(startRect.y + dy, 12, maxY),
      });
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [floatingMaximized, floatingRect]);

  const handleResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (floatingMaximized) return;
    event.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const startRect = floatingRect;
    const startX = event.clientX;
    const startY = event.clientY;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const maxWidth = Math.max(460, rootRect.width - startRect.x - 12);
      const maxHeight = Math.max(280, rootRect.height - startRect.y - 12);
      setFloatingRect({
        ...startRect,
        width: clampNumber(startRect.width + dx, 460, maxWidth),
        height: clampNumber(startRect.height + dy, 280, maxHeight),
      });
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [floatingMaximized, floatingRect]);

  const renderEditor = useCallback((compact: boolean) => {
    if (!activeTab) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
          Open a file with <kbd className="rounded border border-foreground/15 px-1 py-0.5 text-[10px]">Cmd/Ctrl+P</kbd>
        </div>
      );
    }
    if (activeTab.loading) {
      return <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">Loading file...</div>;
    }
    if (activeTab.error) {
      return <div className="flex h-full items-center justify-center px-5 text-center text-xs text-destructive/80">{activeTab.error}</div>;
    }
    if (showDiff) {
      const originalContent = activeTab.gitHeadContent ?? activeTab.savedContent;
      if (originalContent === activeTab.content) {
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <GitCompare className="h-8 w-8 text-muted-foreground/25" />
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground/60">
                {activeTab.gitHeadContent !== null ? "No changes vs git HEAD" : "No git history available"}
              </p>
              <p className="text-[10px] text-muted-foreground/40">
                {activeTab.gitHeadContent !== null
                  ? "The file matches the last committed version"
                  : "This file is not tracked in git or HEAD has no record of it"}
              </p>
            </div>
          </div>
        );
      }
      return (
        <DiffEditor
          key={`diff-${activeTab.id}`}
          height="100%"
          language={getMonacoLanguage(activeTab.relativePath)}
          theme={getMonacoThemeForEditor()}
          original={originalContent}
          modified={activeTab.content}
          onMount={onDiffEditorMount}
          options={{
            renderSideBySide: true,
            useInlineViewWhenSpaceIsLimited: false,
            enableSplitViewResizing: true,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            minimap: { enabled: true },
            glyphMargin: false,
            fontSize: compact ? 12 : 13,
            fontFamily: EDITOR_FONT_FAMILY,
            lineHeight: compact ? 18 : 19,
            letterSpacing: 0,
            wordWrap: wordWrap ? "on" : "off",
            readOnly: false,
            originalEditable: false,
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
            padding: { top: 8, bottom: 8 },
          }}
        />
      );
    }
    return (
      <Editor
        key={`editor-${activeTab.id}`}
        height="100%"
        language={getMonacoLanguage(activeTab.relativePath)}
        theme={getMonacoThemeForEditor()}
        value={activeTab.content}
        onChange={updateActiveContent}
        onMount={onEditorMount}
        options={{
          minimap: { enabled: !compact },
          fontSize: compact ? 12 : 13,
          fontFamily: EDITOR_FONT_FAMILY,
          lineHeight: compact ? 18 : 19,
          letterSpacing: 0,
          lineNumbers: "on",
          wordWrap: wordWrap ? "on" : "off",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          glyphMargin: true,
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          stickyScroll: { enabled: true },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          renderWhitespace: "selection",
          showFoldingControls: "always",
          padding: { top: 8, bottom: 8 },
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
      />
    );
  }, [activeTab, onDiffEditorMount, onEditorMount, resolvedTheme, showDiff, updateActiveContent, wordWrap]);

  const statusText = useMemo(() => {
    if (!activeTab) return "No file selected";
    const language = getLanguageFromPath(activeTab.relativePath);
    const dirty = activeTab.content !== activeTab.savedContent;
    const posText = cursorPosition ? `Ln ${cursorPosition.line}, Col ${cursorPosition.column}` : null;
    const hasGitDiff = activeTab.gitHeadContent !== null;
    const changeText = lineChangeSummary.addedLines + lineChangeSummary.removedLines > 0
      ? `+${lineChangeSummary.addedLines} -${lineChangeSummary.removedLines}`
      : null;
    const parts = [
      language,
      "UTF-8",
      "LF",
      "Spaces: 2",
      hasGitDiff && changeText ? `git: ${changeText}` : !hasGitDiff && dirty && changeText ? changeText : dirty ? "unsaved" : "saved",
      posText,
    ].filter(Boolean);
    return parts.join(" • ");
  }, [activeTab, cursorPosition, lineChangeSummary.addedLines, lineChangeSummary.removedLines]);

  const getFileColor = useCallback((path: string): string => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const colors: Record<string, string> = {
      tsx: "#3b82f6", jsx: "#3b82f6", ts: "#eab308", js: "#eab308",
      css: "#a855f7", scss: "#a855f7", json: "#22c55e", md: "#6b7280",
      html: "#ef4444", py: "#3b82f6", rs: "#f97316", go: "#06b6d4",
    };
    return colors[ext] ?? "#6b7280";
  }, []);

  const breadcrumbs = useMemo(() => {
    if (!activeTab) return [];
    return activeTab.relativePath.split("/");
  }, [activeTab]);

  const renderTabRow = useCallback(() => (
    <div>
      {tabs.length > 0 && <div className="flex items-center gap-1 overflow-x-auto border-b border-foreground/[0.08] bg-background/70 px-2 py-1.5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const dirty = tab.content !== tab.savedContent;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTabId(tab.id)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); handleCloseTab(tab.id); } }}
              title={tab.relativePath}
              className={`group inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors ${
                isActive
                  ? "bg-foreground/[0.09] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: getFileColor(tab.relativePath) }} />
              <span className="max-w-[180px] truncate">{getFileLabel(tab.relativePath)}</span>
              {dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
              <span
                role="button"
                tabIndex={0}
                aria-label="Close tab"
                className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-foreground/10"
                onClick={(event) => {
                  event.stopPropagation();
                  handleCloseTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.stopPropagation();
                  handleCloseTab(tab.id);
                }}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          );
        })}
      </div>}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-1 border-b border-foreground/[0.04] px-3 py-1 text-[10px] text-muted-foreground/70">
          {breadcrumbs.map((segment, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/30">›</span>}
              <span className={i === breadcrumbs.length - 1 ? "text-foreground/70" : ""}>{segment}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  ), [activeTabId, breadcrumbs, getFileColor, handleCloseTab, tabs]);

  const dockedShellClassName = showDocked
    ? "relative flex min-h-0 flex-1 flex-col overflow-hidden"
    : "hidden";

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 w-full flex-1 flex-col">
      <div className={dockedShellClassName}>
        <div className={`@container flex items-center gap-2 border-b border-foreground/[0.08] pe-3 py-2 ${isDockedMaximized && !sidebarOpen && isMac ? "ps-[84px]" : "ps-3"}`}>
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground/[0.06]">
            <SquarePen className="h-3.5 w-3.5 text-foreground/65" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-foreground/85">Code Workspace</p>
            <p className="truncate text-[10px] text-muted-foreground/65">{activeTab?.relativePath ?? "No file selected"}</p>
          </div>
          <div className="hidden items-center gap-2 @[500px]:flex">
            <Button
              variant={showDiff ? "secondary" : "ghost"}
              size="sm"
              className={`h-7 gap-1 px-2 text-[10px] ${activeTab?.gitHeadContent !== null && !showDiff ? "text-amber-500 hover:text-amber-500" : ""}`}
              disabled={!activeTab || activeTab.loading}
              onClick={() => {
                if (!activeTabId) return;
                setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, showDiff: !t.showDiff } : t));
              }}
              title={
                activeTab?.gitHeadContent !== null
                  ? "Compare with git HEAD (changes detected)"
                  : "Diff — no git history loaded for this file"
              }
            >
              <GitCompare className="h-3 w-3" />
              {activeTab?.gitHeadContent !== null ? "Git diff" : "Diff"}
            </Button>
            <Button
              variant={wordWrap ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1 px-2 text-[10px]"
              onClick={() => setWordWrap((prev) => !prev)}
              title="Toggle word wrap"
            >
              <WrapText className="h-3 w-3" />
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-foreground/10 px-1.5 py-1 text-[10px] text-foreground/70 hover:border-foreground/20">
              <input
                type="checkbox"
                className="h-3 w-3 accent-foreground"
                checked={showLineHooks}
                onChange={(event) => setShowLineHooks(event.target.checked)}
              />
              Hooks
            </label>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px]"
              disabled={lineChangeSummary.changedLines.length === 0}
              onClick={handleJumpToNextChange}
            >
              Next change
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRequestQuickOpen} title="Quick Open (Cmd/Ctrl+P)">
              <MonitorUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setFloatingOpen((prev) => !prev)}
              title="Toggle floating editor"
            >
              <PanelTopClose className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onToggleDockedMaximize}
              title={isDockedMaximized ? "Restore split view" : "Maximize editor"}
            >
              {isDockedMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!activeTab || saving || activeTab.content === activeTab.savedContent}
              onClick={() => { void handleSave(); }}
              title="Save file"
            >
              <Save className="h-3.5 w-3.5" />
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 @[500px]:hidden">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!activeTab || activeTab.loading}
                onClick={() => {
                  if (!activeTabId) return;
                  setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, showDiff: !t.showDiff } : t));
                }}
              >
                <GitCompare className="h-3.5 w-3.5 me-2" />
                {showDiff ? "Hide diff" : activeTab?.gitHeadContent !== null ? "Git diff" : "Diff"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setWordWrap((prev) => !prev)}>
                <WrapText className="h-3.5 w-3.5 me-2" />
                {wordWrap ? "Disable word wrap" : "Word wrap"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowLineHooks((prev) => !prev)}>
                {showLineHooks ? "Hide hooks" : "Show hooks"}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={lineChangeSummary.changedLines.length === 0}
                onClick={handleJumpToNextChange}
              >
                Next change
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRequestQuickOpen}>
                <MonitorUp className="h-3.5 w-3.5 me-2" />
                Quick Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFloatingOpen((prev) => !prev)}>
                <PanelTopClose className="h-3.5 w-3.5 me-2" />
                Floating editor
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleDockedMaximize}>
                {isDockedMaximized ? <Minimize2 className="h-3.5 w-3.5 me-2" /> : <Maximize2 className="h-3.5 w-3.5 me-2" />}
                {isDockedMaximized ? "Restore split" : "Maximize"}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!activeTab || saving || activeTab.content === activeTab.savedContent}
                onClick={() => { void handleSave(); }}
              >
                <Save className="h-3.5 w-3.5 me-2" />
                Save
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {renderTabRow()}
        {showLineHooks && lineChangeSummary.hooks.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-foreground/[0.08] px-2 py-1.5">
            <span className="me-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              hooks
            </span>
            {lineChangeSummary.hooks.slice(0, 8).map((hook, index) => {
              const hookToneClass = hook.kind === "added"
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : hook.kind === "deleted"
                  ? "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300"
                  : "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
              const hookSymbol = hook.kind === "added"
                ? "+"
                : hook.kind === "deleted"
                  ? "-"
                  : "~";
              return (
                <button
                  key={`${hook.lineNumber}-${hook.kind}-${index}`}
                  type="button"
                  onClick={() => handleJumpToLine(hook.lineNumber)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors hover:bg-foreground/[0.08] ${hookToneClass}`}
                  title={`L${hook.lineNumber}\n- ${hook.beforeText || "(empty)"}\n+ ${hook.afterText || "(empty)"}`}
                >
                  <span className="font-semibold">{hookSymbol}</span>
                  <span className="max-w-[220px] truncate">L{hook.lineNumber} {getHookPreview(hook)}</span>
                </button>
              );
            })}
            {lineChangeSummary.hooks.length > 8 && (
              <span className="text-[10px] text-muted-foreground/65">
                +{lineChangeSummary.hooks.length - 8}
              </span>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1">{renderEditor(false)}</div>
        <div className="border-t border-foreground/[0.08] px-3 py-1.5 text-[11px] text-muted-foreground/65">
          {statusText}
        </div>
      </div>

      {floatingOpen && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div
            className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border border-foreground/15 bg-background shadow-[0_20px_60px_-25px_rgba(0,0,0,0.55)]"
            style={
              floatingMaximized
                ? { inset: 12 }
                : {
                    left: floatingRect.x,
                    top: floatingRect.y,
                    width: floatingRect.width,
                    height: floatingRect.height,
                  }
            }
          >
            <div
              className="flex cursor-move items-center gap-2 border-b border-foreground/[0.08] px-2 py-1.5"
              onMouseDown={handleDragStart}
            >
              <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Mini Editor</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] text-foreground/85">{activeTab?.relativePath ?? "No file selected"}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setFloatingMaximized((prev) => !prev)}
                title={floatingMaximized ? "Restore size" : "Maximize floating editor"}
              >
                {floatingMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setFloatingOpen(false)}
                title="Close floating editor"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            {renderTabRow()}
            <div className="min-h-0 flex-1">{renderEditor(true)}</div>
            <div className="border-t border-foreground/[0.08] px-2 py-1 text-[10px] text-muted-foreground/65">
              {statusText}
            </div>
            {!floatingMaximized && (
              <div
                className="absolute right-0 bottom-0 h-3 w-3 cursor-se-resize"
                onMouseDown={handleResizeStart}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
});
