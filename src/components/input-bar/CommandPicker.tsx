import { useState, useRef, useMemo, useCallback, memo } from "react";
import type { SlashCommand } from "@/types";
import { getSlashCommandReplacement } from "./input-bar-utils";

// ── Hook: slash command autocomplete state ──

export interface UseCommandAutocompleteOptions {
  availableSlashCommands: SlashCommand[];
  editableRef: React.RefObject<HTMLDivElement | null>;
}

export function useCommandAutocomplete({
  availableSlashCommands,
  editableRef,
}: UseCommandAutocompleteOptions) {
  const [showCommands, setShowCommands] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const commandListRef = useRef<HTMLDivElement>(null);

  // Memoized filtered results (was previously an un-memoized IIFE)
  const cmdResults = useMemo(() => {
    if (!showCommands || availableSlashCommands.length === 0) return [];
    const q = commandQuery.toLowerCase();
    if (!q) return availableSlashCommands.slice(0, 15);
    return availableSlashCommands
      .filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(q) ||
          cmd.description.toLowerCase().includes(q),
      )
      .slice(0, 15);
  }, [showCommands, availableSlashCommands, commandQuery]);

  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      setShowCommands(false);
      const el = editableRef.current;
      if (!el) return;

      el.textContent = getSlashCommandReplacement(cmd);

      // Move cursor to end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      el.focus();

      // Signal content changed (caller should update hasContent)
      return true;
    },
    [editableRef],
  );

  /** Detect slash command trigger from the editable's full text content. */
  const detectCommandTrigger = useCallback(
    (fullText: string) => {
      const slashMatch = fullText.trimStart().match(/^\/(\S*)$/);
      if (slashMatch && availableSlashCommands.length > 0) {
        setShowCommands(true);
        setCommandQuery(slashMatch[1]);
        setCommandIndex(0);
      } else if (showCommands) {
        setShowCommands(false);
      }
    },
    [showCommands, availableSlashCommands],
  );

  return {
    showCommands,
    setShowCommands,
    commandIndex,
    setCommandIndex,
    cmdResults,
    commandListRef,
    selectCommand,
    detectCommandTrigger,
  };
}

// ── Component: slash command picker dropdown ──

export interface CommandPickerProps {
  cmdResults: SlashCommand[];
  commandIndex: number;
  commandListRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (cmd: SlashCommand) => void;
  onHover: (index: number) => void;
}

/** Autocomplete dropdown for slash commands. */
export const CommandPicker = memo(function CommandPicker({
  cmdResults,
  commandIndex,
  commandListRef,
  onSelect,
  onHover,
}: CommandPickerProps) {
  if (cmdResults.length === 0) return null;

  return (
    <div
      ref={commandListRef}
      className="mx-2 mb-1 mt-2 max-h-64 overflow-y-auto rounded-lg border border-border/60 bg-popover p-1 shadow-lg"
    >
      {cmdResults.map((cmd, i) => (
        <button
          key={`${cmd.source}-${cmd.name}`}
          data-active={i === commandIndex}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm transition-colors ${
            i === commandIndex
              ? "bg-accent text-accent-foreground"
              : "text-popover-foreground hover:bg-muted/40"
          }`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(cmd);
          }}
          onMouseEnter={() => onHover(i)}
        >
          {cmd.iconUrl ? (
            <img
              src={cmd.iconUrl}
              alt=""
              className="h-4 w-4 shrink-0 rounded"
            />
          ) : (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
              {cmd.source.startsWith("codex") ? "$" : "/"}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-medium">
                {cmd.source.startsWith("codex") ? "$" : "/"}
                {cmd.name}
              </span>
              {cmd.argumentHint && (
                <span className="text-xs text-muted-foreground">
                  {cmd.argumentHint}
                </span>
              )}
            </div>
            {cmd.description && (
              <div className="truncate text-xs text-muted-foreground">
                {cmd.description}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
});
