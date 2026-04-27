import { useEffect } from "react";
import { Loader2, RotateCcw, Terminal as TerminalIcon, X } from "lucide-react";
import { TerminalInstance } from "@/components/ToolsPanel";
import type { ResolvedTheme } from "@/hooks/useTheme";
import type { CliSessionState } from "@shared/types/cli-engine";
import { CliComposer } from "./CliComposer";

interface CliChatPanelProps {
  state: CliSessionState | null;
  resolvedTheme: ResolvedTheme;
  /**
   * Called once on the first non-empty `terminal:data` chunk after spawn —
   * flips state.ready, removing the "Starting claude…" overlay. The panel
   * owns this subscription rather than `useCliSession` because xterm
   * reattach happens here.
   */
  onPtyDataObserved: (terminalId: string) => void;
  /**
   * Called by the panel when the user wants to retry / fork after a failed
   * spawn or a normal exit. Wired to whichever path created the session
   * (start vs resume) up at the layout layer.
   */
  onRetry: () => void;
  /** Called when the user clicks the "Close" affordance after exit. */
  onClose: () => void;
  /**
   * Composer "send" — pastes raw text into the live pty followed by `\r`.
   * No CLI-side queueing; if the pty isn't ready, we drop the call.
   */
  onSendToPty: (text: string) => void;
  /** Persistence key for the composer draft (typically the session id). */
  draftKey: string;
}

/**
 * Full-screen chat surface for the CLI engine. The actual conversation
 * lives in the embedded xterm — this component just wraps it with the
 * starting/error/exited states and the overlay composer (Phase 3).
 *
 * No structured message rendering, no tool-call cards: that's the
 * tradeoff for getting full CLI fidelity (slash commands, login flow,
 * permission prompts, plugins) for free.
 */
export function CliChatPanel({
  state,
  resolvedTheme,
  onPtyDataObserved,
  onRetry,
  onClose,
  onSendToPty,
  draftKey,
}: CliChatPanelProps) {
  // Subscribe to terminal:data scoped to our terminalId so we can flip
  // state.ready=true on the first chunk. This is what releases the
  // "Starting claude…" overlay and reveals the xterm. The actual writes
  // into xterm are done by TerminalInstance's own listener — we're just
  // observing the first byte.
  const terminalId = state?.terminalId;
  useEffect(() => {
    if (!terminalId) return;
    let observed = false;
    const unsubscribe = window.claude.terminal.onData(({ terminalId: id, data }) => {
      if (observed || id !== terminalId || !data) return;
      observed = true;
      onPtyDataObserved(terminalId);
    });
    return unsubscribe;
  }, [terminalId, onPtyDataObserved]);

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-foreground/40">No CLI session active.</p>
      </div>
    );
  }

  if (state.status === "starting" || (state.status === "running" && !state.ready)) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-2.5">
            <Loader2 className="h-5 w-5 animate-spin text-foreground/40" />
            <span className="text-xs text-foreground/40">Starting claude…</span>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
            <TerminalIcon className="h-5 w-5 text-red-400" />
          </div>
          <p className="text-sm font-medium text-foreground/80">Failed to start claude</p>
          <p className="text-xs text-foreground/55">{state.errorMessage ?? "Unknown error"}</p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-md bg-foreground/[0.06] px-3 py-1.5 text-xs hover:bg-foreground/[0.10]"
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-foreground/55 hover:bg-foreground/[0.04] hover:text-foreground/85"
            >
              <X className="h-3 w-3" />
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // running (ready) | exited — same render path; xterm is in charge.
  // After exit, TerminalInstance leaves the buffer scrollable but disables
  // stdin (driven by the underlying terminal:exit event).
  return (
    <div className="relative flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <TerminalInstance
          terminalId={state.terminalId}
          isVisible={true}
          resolvedTheme={resolvedTheme}
        />
      </div>
      {state.status === "exited" && (
        <div className="flex items-center gap-2 border-t border-foreground/[0.06] px-3 py-1.5 text-[11px] text-foreground/55">
          <span>Process exited (code {state.exitCode ?? "?"})</span>
          <button
            type="button"
            onClick={onRetry}
            className="ms-auto flex items-center gap-1 rounded px-2 py-0.5 hover:bg-foreground/[0.04] hover:text-foreground/85"
          >
            <RotateCcw className="h-3 w-3" />
            Restart
          </button>
        </div>
      )}
      <CliComposer
        draftKey={draftKey}
        disabled={state.status !== "running"}
        onSubmit={onSendToPty}
      />
    </div>
  );
}
