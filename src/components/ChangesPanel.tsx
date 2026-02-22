import { memo, useState, useMemo, useEffect, useCallback } from "react";
import { Pencil, Plus, FileDiff, FileText, ChevronRight } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DiffViewer } from "./DiffViewer";
import { OpenInEditorButton } from "./OpenInEditorButton";
import { getLanguageFromPath } from "@/lib/languages";
import {
  extractTurnSummaries,
  extractAllFileChanges,
  groupChangesByFile,
} from "@/lib/turn-changes";
import type { FileChange, TurnSummary } from "@/lib/turn-changes";
import type { UIMessage } from "@/types";

// ── Constants ──

const CHANGE_ICON = { modified: Pencil, created: Plus } as const;
const CHANGE_COLOR = { modified: "text-amber-400", created: "text-emerald-400" } as const;

const WRITE_SYNTAX_STYLE: React.CSSProperties = {
  margin: 0,
  borderRadius: 0,
  fontSize: "11px",
  padding: "10px 12px",
  background: "transparent",
};

const WRITE_LINE_NUMBER_STYLE: React.CSSProperties = {
  color: "rgba(255,255,255,0.2)",
  fontSize: "10px",
  minWidth: "2em",
  paddingRight: "1em",
};

// ── Sub-components ──

/** Renders full file content for Write/NotebookEdit (new file creation). */
function WritePreview({ change }: { change: FileChange }) {
  const language = getLanguageFromPath(change.filePath);
  const content = change.content ?? "";

  if (!content) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground/50">
        Empty file
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <div className="group/write flex items-center gap-3 px-3 py-1.5 bg-foreground/[0.04] border-b border-border/40 shrink-0">
        <Plus className="h-3.5 w-3.5 text-emerald-400 shrink-0" strokeWidth={2} />
        <span className="text-foreground/80 truncate flex-1 text-xs font-mono">
          {change.filePath}
        </span>
        <OpenInEditorButton filePath={change.filePath} className="group-hover/write:text-foreground/25" />
      </div>
      <div className="overflow-y-auto flex-1 min-h-0 font-mono text-[12px] leading-[1.55] bg-black/20">
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          customStyle={WRITE_SYNTAX_STYLE}
          showLineNumbers
          lineNumberStyle={WRITE_LINE_NUMBER_STYLE}
          wrapLongLines
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

/** File row in the sidebar file list. */
const FileRow = memo(function FileRow({
  change,
  isSelected,
  onClick,
}: {
  change: FileChange;
  isSelected: boolean;
  onClick: () => void;
}) {
  const Icon = CHANGE_ICON[change.changeType];
  const color = CHANGE_COLOR[change.changeType];
  // Extract directory portion for dimmed display
  const dirParts = change.filePath.split("/");
  const dir = dirParts.length > 1 ? dirParts.slice(0, -1).join("/") + "/" : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-xs transition-colors cursor-pointer rounded-md ${
        isSelected
          ? "bg-foreground/[0.08] text-foreground"
          : "text-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground/80"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} strokeWidth={2} />
      <span className="flex-1 min-w-0 truncate">
        <span className="font-medium">{change.fileName}</span>
        {dir && (
          <span className="ms-1 text-muted-foreground/40 text-[10px]">{dir}</span>
        )}
      </span>
    </button>
  );
});

// ── Main component ──

type ViewMode = "per-turn" | "cumulative";

/** Unique key for a file change in the selection state. */
function changeKey(change: FileChange): string {
  return `${change.filePath}::${change.messageId}`;
}

interface ChangesPanelProps {
  messages: UIMessage[];
  isProcessing: boolean;
  /** When set, auto-select this turn index (from inline summary click). */
  focusTurnIndex?: number;
  onFocusTurnHandled?: () => void;
}

export const ChangesPanel = memo(function ChangesPanel({
  messages,
  isProcessing,
  focusTurnIndex,
  onFocusTurnHandled,
}: ChangesPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("per-turn");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(() => new Set());

  // Derive turn summaries and cumulative changes
  const turnSummaries = useMemo(
    () => extractTurnSummaries(messages, isProcessing),
    [messages, isProcessing],
  );
  const allChanges = useMemo(() => extractAllFileChanges(messages), [messages]);
  const groupedByFile = useMemo(() => groupChangesByFile(allChanges), [allChanges]);

  // Auto-expand all turns on first render / when turns change
  useEffect(() => {
    setExpandedTurns(new Set(turnSummaries.map((t) => t.turnIndex)));
  }, [turnSummaries]);

  // Handle external focus request (from inline summary "View changes" click)
  useEffect(() => {
    if (focusTurnIndex == null) return;
    setViewMode("per-turn");
    // Expand the target turn and select its first file
    setExpandedTurns((prev) => new Set([...prev, focusTurnIndex]));
    const targetTurn = turnSummaries.find((t) => t.turnIndex === focusTurnIndex);
    if (targetTurn?.changes.length) {
      setSelectedKey(changeKey(targetTurn.changes[0]));
    }
    onFocusTurnHandled?.();
  }, [focusTurnIndex, turnSummaries, onFocusTurnHandled]);

  // Auto-select first file if nothing selected and changes exist
  useEffect(() => {
    if (selectedKey) return;
    if (viewMode === "per-turn" && turnSummaries.length > 0) {
      const lastTurn = turnSummaries[turnSummaries.length - 1];
      if (lastTurn.changes.length > 0) {
        setSelectedKey(changeKey(lastTurn.changes[0]));
      }
    } else if (viewMode === "cumulative" && allChanges.length > 0) {
      setSelectedKey(changeKey(allChanges[0]));
    }
  }, [viewMode, turnSummaries, allChanges, selectedKey]);

  const toggleTurn = useCallback((turnIndex: number) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(turnIndex)) next.delete(turnIndex);
      else next.add(turnIndex);
      return next;
    });
  }, []);

  // Find the selected file change object
  const selectedChange = useMemo(() => {
    if (!selectedKey) return null;
    return allChanges.find((c) => changeKey(c) === selectedKey) ?? null;
  }, [allChanges, selectedKey]);

  const hasChanges = allChanges.length > 0;

  // ── Empty state ──
  if (!hasChanges) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40 shrink-0">
          <FileDiff className="h-4 w-4 text-muted-foreground/60" />
          <span className="text-sm font-medium text-foreground/80">Changes</span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center px-4">
            <FileText className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground/40">No file changes yet</p>
            <p className="text-xs text-muted-foreground/25 mt-1">
              File modifications will appear here after each turn
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 shrink-0">
        <FileDiff className="h-4 w-4 text-muted-foreground/60" />
        <span className="text-sm font-medium text-foreground/80">Changes</span>
        <div className="ms-auto flex items-center">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {/* Content: file list + diff area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* File list sidebar */}
        <div className="w-[38%] min-w-[140px] max-w-[260px] shrink-0 border-e border-border/30 overflow-hidden flex flex-col">
          <ScrollArea className="flex-1">
            <div className="py-1.5 px-1.5">
              {viewMode === "per-turn" ? (
                // Per-turn: grouped by turn with collapsible headers
                turnSummaries.map((turn) => (
                  <TurnGroup
                    key={turn.turnIndex}
                    turn={turn}
                    isExpanded={expandedTurns.has(turn.turnIndex)}
                    onToggle={() => toggleTurn(turn.turnIndex)}
                    selectedKey={selectedKey}
                    onSelect={setSelectedKey}
                  />
                ))
              ) : (
                // Cumulative: flat file list grouped by path
                [...groupedByFile.entries()].map(([filePath, changes]) => {
                  // Show the latest change for each file
                  const latest = changes[changes.length - 1];
                  return (
                    <FileRow
                      key={filePath}
                      change={latest}
                      isSelected={selectedKey === changeKey(latest)}
                      onClick={() => setSelectedKey(changeKey(latest))}
                    />
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Diff / content viewer */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {selectedChange ? (
            <ScrollArea className="h-full">
              <div className="p-0">
                {selectedChange.toolName === "Edit" ? (
                  <DiffViewer
                    oldString={selectedChange.oldString ?? ""}
                    newString={selectedChange.newString ?? ""}
                    filePath={selectedChange.filePath}
                  />
                ) : (
                  <WritePreview change={selectedChange} />
                )}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground/30">Select a file to view changes</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ── Turn group (collapsible section in per-turn mode) ──

function TurnGroup({
  turn,
  isExpanded,
  onToggle,
  selectedKey,
  onSelect,
}: {
  turn: TurnSummary;
  isExpanded: boolean;
  onToggle: () => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors cursor-pointer"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform duration-150 ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
        <span>Turn {turn.turnIndex + 1}</span>
        <span className="ms-auto text-muted-foreground/30">
          {turn.fileCount} file{turn.fileCount !== 1 ? "s" : ""}
        </span>
      </button>
      {isExpanded && (
        <div className="ms-1.5">
          {turn.changes.map((change) => (
            <FileRow
              key={changeKey(change)}
              change={change}
              isSelected={selectedKey === changeKey(change)}
              onClick={() => onSelect(changeKey(change))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── View mode toggle (segmented control) ──

function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex items-center rounded-md bg-foreground/[0.05] p-0.5">
      <button
        type="button"
        onClick={() => onChange("per-turn")}
        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all cursor-pointer ${
          mode === "per-turn"
            ? "bg-foreground/10 text-foreground/80 shadow-sm"
            : "text-muted-foreground/50 hover:text-muted-foreground/70"
        }`}
      >
        Per turn
      </button>
      <button
        type="button"
        onClick={() => onChange("cumulative")}
        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all cursor-pointer ${
          mode === "cumulative"
            ? "bg-foreground/10 text-foreground/80 shadow-sm"
            : "text-muted-foreground/50 hover:text-muted-foreground/70"
        }`}
      >
        All
      </button>
    </div>
  );
}
