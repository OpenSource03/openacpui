import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

interface CliComposerProps {
  /**
   * Stable key (typically sessionId) used to scope the draft in localStorage.
   * Switching keys saves the outgoing draft and restores any saved one for
   * the new key — same idiom as the SDK composer in `<InputBar>`.
   */
  draftKey: string;
  disabled: boolean;
  /** Called with the raw text on submit; layer above pastes into pty + "\r". */
  onSubmit: (text: string) => void;
}

const DRAFT_PREFIX = "harnss-cli-composer-draft-";

/**
 * One-shot ownership across StrictMode / dual-mounts so two instances of the
 * composer rendered against the same draftKey don't race on save. Pattern
 * mirrors `draftKeyOwners` in `<InputBar>`. The first instance to claim the
 * key in a given mount cycle owns persistence; the second renders the same
 * value but doesn't write back. Without this, React 19's double-invoke in
 * dev would clobber drafts on every mount.
 */
const draftOwners = new Set<string>();

/**
 * Overlay composer for CLI engine sessions. The CLI's own input prompt is
 * inside the pty; this composer sits above it and pastes the user's typed
 * text + `\r` on submit. Why an overlay rather than typing directly into
 * the pty:
 *
 *   1. Drafts persist across session switches (CLI doesn't have a "save
 *      what I'm typing" concept — once you switch sessions in iTerm, the
 *      half-typed prompt is gone).
 *   2. We can render IME composition the React way — pty input is one byte
 *      at a time and CJK IMEs frequently render badly inside CLI prompts.
 *   3. Paste of multi-line / image content goes through Harnss's existing
 *      affordances rather than CLI's fragile multi-line input mode.
 *
 * The CLI still owns its own slash-command picker, autocomplete, etc. —
 * the overlay only handles the *outgoing* user message. CLI output goes to
 * xterm uninterrupted.
 */
export function CliComposer({ draftKey, disabled, onSubmit }: CliComposerProps) {
  const [value, setValue] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const owner = !draftOwners.has(draftKey);
    if (owner) draftOwners.add(draftKey);
    setIsOwner(owner);

    let stored = "";
    try {
      stored = localStorage.getItem(DRAFT_PREFIX + draftKey) ?? "";
    } catch {
      stored = "";
    }
    setValue(stored);

    return () => {
      if (!owner) return;
      // Save current value on unmount. Read off the textarea ref since
      // setValue is async and stale closures would persist the wrong value
      // when rerouting between sessions in the same render cycle.
      const final = taRef.current?.value ?? "";
      try {
        if (final.length > 0) {
          localStorage.setItem(DRAFT_PREFIX + draftKey, final);
        } else {
          localStorage.removeItem(DRAFT_PREFIX + draftKey);
        }
      } catch {
        /* private mode / quota */
      }
      draftOwners.delete(draftKey);
    };
  }, [draftKey]);

  // Save on every keystroke as well — survives full-page reload mid-typing.
  useEffect(() => {
    if (!isOwner) return;
    try {
      if (value.length > 0) {
        localStorage.setItem(DRAFT_PREFIX + draftKey, value);
      } else {
        localStorage.removeItem(DRAFT_PREFIX + draftKey);
      }
    } catch {
      /* ignore */
    }
  }, [draftKey, isOwner, value]);

  const submit = useCallback(() => {
    if (disabled) return;
    // Don't trim before sending — the user may have intentionally typed
    // leading/trailing whitespace (e.g. continuing an indented block).
    // Only refuse to submit when the input is *only* whitespace.
    if (!value.trim()) return;
    onSubmit(value);
    setValue("");
    try {
      localStorage.removeItem(DRAFT_PREFIX + draftKey);
    } catch {
      /* ignore */
    }
  }, [disabled, draftKey, onSubmit, value]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter without modifier → submit; Shift+Enter → newline. Mirrors the
    // SDK composer's contract so users don't have to relearn keys.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }, [submit]);

  return (
    <div className="border-t border-foreground/[0.06] p-2">
      <div className="flex items-end gap-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-2.5 py-2 focus-within:border-foreground/[0.12]">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? "CLI not ready…" : isOwner ? "Type a message — Enter to send, Shift+Enter for newline" : "Read-only — open in primary window"}
          rows={1}
          readOnly={!isOwner}
          className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm text-foreground/90 placeholder:text-foreground/35 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/[0.06] text-foreground/70 transition-colors hover:bg-foreground/[0.10] hover:text-foreground disabled:opacity-30"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
