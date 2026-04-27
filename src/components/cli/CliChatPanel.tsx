import { useEffect } from "react";
import { Loader2, PanelLeft, RotateCcw, Terminal as TerminalIcon, X } from "lucide-react";
import { TerminalInstance } from "@/components/ToolsPanel";
import { Button } from "@/components/ui/button";
import { isMac } from "@/lib/utils";
import type { ResolvedTheme } from "@/hooks/useTheme";
import type { CliSessionState } from "@shared/types/cli-engine";

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
  /** cwd the CLI is running in. Shown in the slim header. */
  cwd?: string | null;
  /** Sidebar toggle — preserves the only ChatHeader feature CLI users still need. */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Island layout mode (mac glass) — the header is taller in flat mode. */
  islandLayout: boolean;
}

/**
 * Trim an absolute path to a $HOME-relative form when possible. The
 * renderer can't read process.env (nodeIntegration is off + context
 * isolation), so we infer $HOME from the platform-specific
 * /Users/<name>/ or /home/<name>/ prefix on the path itself. Windows
 * paths start with a drive letter and don't have a tilde convention,
 * so they fall through to the absolute form.
 */
function shortenCwd(cwd: string | null | undefined): string {
  if (!cwd) return "";
  // macOS: /Users/<name>/...
  let m = cwd.match(/^(\/Users\/[^/]+)(\/|$)/);
  if (m) return "~" + cwd.slice(m[1].length);
  // Linux: /home/<name>/...
  m = cwd.match(/^(\/home\/[^/]+)(\/|$)/);
  if (m) return "~" + cwd.slice(m[1].length);
  return cwd;
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
  cwd,
  sidebarOpen,
  onToggleSidebar,
  islandLayout,
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
  const shortCwd = shortenCwd(cwd);
  return (
    <div className="relative flex h-full flex-col">
      {/*
        Slim header: sidebar toggle + cwd path. Replaces the regular
        ChatHeader which was hidden in CLI mode because it overlapped
        the CLI banner. Only renders the toggle when sidebar is closed
        (otherwise the sidebar's own toggle suffices), and indents on
        macOS to clear the traffic-light buttons in flat layout.
      */}
      <div
        className={`drag-region flex items-center gap-2 px-3 ${
          islandLayout ? "h-8" : "h-[3.25rem]"
        } ${!sidebarOpen && isMac ? (islandLayout ? "ps-[78px]" : "ps-[84px]") : ""}`}
      >
        {!sidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            className="no-drag h-7 w-7 text-muted-foreground/60 hover:text-foreground"
            onClick={onToggleSidebar}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        )}
        {shortCwd && (
          <span
            className="no-drag truncate font-mono text-[11px] text-foreground/45"
            title={cwd ?? undefined}
          >
            {shortCwd}
          </span>
        )}
      </div>
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
    </div>
  );
}
