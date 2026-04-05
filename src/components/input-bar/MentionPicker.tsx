import { memo } from "react";
import { File, Folder } from "lucide-react";
import type { MentionEntry } from "./useMentionAutocomplete";

export interface MentionPickerProps {
  results: MentionEntry[];
  mentionIndex: number;
  mentionListRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (entry: MentionEntry) => void;
  onHover: (index: number) => void;
}

/** Autocomplete dropdown for @-mention file/folder references. */
export const MentionPicker = memo(function MentionPicker({
  results,
  mentionIndex,
  mentionListRef,
  onSelect,
  onHover,
}: MentionPickerProps) {
  if (results.length === 0) return null;

  return (
    <div
      ref={mentionListRef}
      className="mx-2 mb-1 mt-2 max-h-64 overflow-y-auto rounded-lg border border-border/60 bg-popover shadow-lg"
    >
      {results.map((entry, i) => (
        <button
          key={entry.path}
          data-active={i === mentionIndex}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm transition-colors ${
            i === mentionIndex
              ? "bg-accent text-accent-foreground"
              : "text-popover-foreground hover:bg-muted/40"
          }`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(entry);
          }}
          onMouseEnter={() => onHover(i)}
        >
          {entry.isDir ? (
            <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />
          ) : (
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-mono text-xs">{entry.path}</span>
        </button>
      ))}
    </div>
  );
});
