import { memo, useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, Plus, X, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TerminalTab } from "@/hooks/useSpaceTerminals";
import type { ResolvedTheme } from "@/hooks/useTheme";

// ── Terminal color themes ──

const DARK_TERMINAL_THEME = {
  background: "#00000000",
  foreground: "#c8c8c8",
  cursor: "#c8c8c8",
  cursorAccent: "#1a1a1a",
  selectionBackground: "rgba(255, 255, 255, 0.12)",
  selectionForeground: undefined,
  // Muted, desaturated palette for dark backgrounds
  black: "#1a1a1a",
  red: "#c47070",
  green: "#7aab7a",
  yellow: "#bba86e",
  blue: "#7090b5",
  magenta: "#a07aa8",
  cyan: "#6ea5a5",
  white: "#c8c8c8",
  brightBlack: "#555555",
  brightRed: "#d48a8a",
  brightGreen: "#95c495",
  brightYellow: "#d0c48e",
  brightBlue: "#8daac8",
  brightMagenta: "#b898bf",
  brightCyan: "#8dbfbf",
  brightWhite: "#e8e8e8",
};

const LIGHT_TERMINAL_THEME = {
  background: "#00000000",
  foreground: "#383838",
  cursor: "#383838",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(0, 0, 0, 0.10)",
  selectionForeground: undefined,
  // Muted, desaturated palette for light backgrounds
  black: "#383838",
  red: "#a3403b",
  green: "#3a7a3a",
  yellow: "#8a6d2e",
  blue: "#3560a0",
  magenta: "#7a3a82",
  cyan: "#2a7575",
  white: "#d0d0d0",
  brightBlack: "#666666",
  brightRed: "#c24038",
  brightGreen: "#4a9a4a",
  brightYellow: "#a08040",
  brightBlue: "#4878b8",
  brightMagenta: "#9050a0",
  brightCyan: "#3a9090",
  brightWhite: "#f0f0f0",
};

function getTerminalTheme(theme: ResolvedTheme) {
  return theme === "dark" ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
}

// ── Props ──

interface ToolsPanelProps {
  spaceId: string;
  tabs: TerminalTab[];
  activeTabId: string | null;
  terminalsReady: boolean;
  onSetActiveTab: (tabId: string | null) => void;
  onCreateTerminal: () => Promise<void>;
  onEnsureTerminal: () => Promise<void>;
  onCloseTerminal: (tabId: string) => Promise<void>;
  resolvedTheme: ResolvedTheme;
}

export const ToolsPanel = memo(function ToolsPanel({
  spaceId,
  tabs,
  activeTabId,
  terminalsReady,
  onSetActiveTab,
  onCreateTerminal,
  onEnsureTerminal,
  onCloseTerminal,
  resolvedTheme,
}: ToolsPanelProps) {
  const handleCreateTerminal = () => {
    if (!terminalsReady) return Promise.resolve();
    return onCreateTerminal();
  };

  // Auto-create first terminal
  useEffect(() => {
    if (terminalsReady && tabs.length === 0) {
      void onEnsureTerminal();
    }
  }, [spaceId, terminalsReady, tabs.length, onEnsureTerminal]);

  const hasTabs = tabs.length > 0;

  return (
    <div className="flex h-full">
      {/* ── Terminal viewport ── */}
      <div className="relative min-h-0 min-w-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 ${tab.id === activeTabId ? "visible" : "invisible"}`}
          >
            <TerminalInstance terminalId={tab.terminalId} isVisible={tab.id === activeTabId} resolvedTheme={resolvedTheme} />
          </div>
        ))}

        {/* Empty states */}
        {!hasTabs && terminalsReady && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.03]">
              <TerminalIcon className="h-5 w-5 text-emerald-600/70 dark:text-emerald-200/50" />
            </div>
            <button
              type="button"
              onClick={() => { void handleCreateTerminal(); }}
              className="group flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium text-foreground/35 transition-all duration-200 hover:bg-foreground/[0.05] hover:text-foreground/60 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110" />
              New Terminal
            </button>
          </div>
        )}
        {!hasTabs && !terminalsReady && (
          <div className="flex h-full flex-col items-center justify-center gap-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-foreground/20" />
            <span className="text-xs text-foreground/30">Restoring terminals...</span>
          </div>
        )}
      </div>

      {/* ── Side panel — terminal list ── */}
      {hasTabs && (
        <>
          {/* Vertical divider */}
          <div className="my-2 w-px bg-foreground/[0.06]" />

          <div className="flex w-[38px] shrink-0 flex-col items-center py-1.5">
            {/* Terminal entries */}
            <div className="flex flex-1 flex-col items-center gap-0.5 overflow-y-auto scrollbar-none">
              {tabs.map((tab, index) => {
                const isActive = tab.id === activeTabId;
                return (
                  <Tooltip key={tab.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onSetActiveTab(tab.id)}
                        className={`group/term relative flex h-7 w-7 items-center justify-center rounded-md transition-all duration-150 cursor-pointer ${
                          isActive
                            ? "bg-foreground/[0.08] text-foreground"
                            : "text-foreground/30 hover:text-foreground/60 hover:bg-foreground/[0.04]"
                        }`}
                      >
                        <span className="text-[10px] font-semibold tabular-nums leading-none">
                          {index + 1}
                        </span>
                        {/* Close button — top-right corner on hover */}
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onCloseTerminal(tab.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              void onCloseTerminal(tab.id);
                            }
                          }}
                          className="absolute -top-0.5 -end-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-foreground/10 text-foreground/50 opacity-0 transition-opacity hover:bg-foreground/20 hover:text-foreground group-hover/term:opacity-100"
                        >
                          <X className="h-2 w-2" />
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" sideOffset={6}>
                      <p className="text-xs font-medium">{tab.label}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>

            {/* New terminal button — at bottom of side panel */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => { void handleCreateTerminal(); }}
                  className="mt-1 flex h-7 w-7 items-center justify-center rounded-md text-foreground/25 transition-all duration-150 hover:bg-foreground/[0.05] hover:text-foreground/50 cursor-pointer active:scale-90"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                <p className="text-xs font-medium">New Terminal</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
});

function TerminalInstance({
  terminalId,
  isVisible,
  resolvedTheme,
}: {
  terminalId: string;
  isVisible: boolean;
  resolvedTheme: ResolvedTheme;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const lastSeqRef = useRef(0);
  const pendingChunksRef = useRef<Array<{ seq: number; data: string }>>([]);
  const hydratedRef = useRef(false);
  const suppressInputRef = useRef(false);
  const [ready, setReady] = useState(false);

  // Initialize xterm
  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let unsubData: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (disposed) return;

      const fitAddon = new FitAddon();
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 12,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Menlo, monospace",
        lineHeight: 1.35,
        letterSpacing: 0,
        allowProposedApi: true,
        allowTransparency: true,
        scrollback: 5000,
        theme: getTerminalTheme(resolvedTheme),
      });

      term.loadAddon(fitAddon);
      term.open(containerRef.current!);

      // Defer fit to next frame to ensure dimensions are available
      requestAnimationFrame(() => {
        if (disposed) return;
        try {
          fitAddon.fit();
        } catch {
          // Container may not be sized yet
        }
      });

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Wire up input → PTY
      term.onData((data) => {
        if (suppressInputRef.current) return;
        window.claude.terminal.write(terminalId, data);
      });

      // Subscribe before fetching a snapshot so we can queue chunks that arrive
      // while the terminal is remounting and replay them after hydration.
      unsubData = window.claude.terminal.onData(({ terminalId: id, data, seq }) => {
        if (id !== terminalId || disposed) return;
        if (!hydratedRef.current) {
          pendingChunksRef.current.push({ seq, data });
          return;
        }
        if (seq <= lastSeqRef.current) return;
        lastSeqRef.current = seq;
        term.write(data);
      });

      unsubExit = window.claude.terminal.onExit(({ terminalId: id }) => {
        if (id !== terminalId || disposed) return;
        term.options.disableStdin = true;
      });

      const snapshot = await window.claude.terminal.snapshot(terminalId);
      if (disposed) return;

      if (snapshot.output) {
        // Restoring historical terminal output into a fresh xterm instance can
        // re-trigger terminal capability responses. Suppress onData while the
        // snapshot is replayed so old escape-sequence replies do not leak into
        // the live PTY as random input after a space switch.
        suppressInputRef.current = true;
        try {
          term.write(snapshot.output);
        } finally {
          suppressInputRef.current = false;
        }
      }
      lastSeqRef.current = snapshot.seq ?? 0;
      term.options.disableStdin = !!snapshot.exited;
      hydratedRef.current = true;

      const missedChunks = pendingChunksRef.current
        .filter((chunk) => chunk.seq > lastSeqRef.current)
        .sort((a, b) => a.seq - b.seq);
      pendingChunksRef.current = [];
      for (const chunk of missedChunks) {
        lastSeqRef.current = chunk.seq;
        term.write(chunk.data);
      }

      // Report initial size to PTY
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        window.claude.terminal.resize(terminalId, dims.cols, dims.rows);
      }

      setReady(true);
    })();

    return () => {
      disposed = true;
      unsubData?.();
      unsubExit?.();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      lastSeqRef.current = 0;
      pendingChunksRef.current = [];
      hydratedRef.current = false;
      suppressInputRef.current = false;
    };
  }, [terminalId]);

  // Update terminal theme when resolvedTheme changes (live terminals)
  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.theme = getTerminalTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Refit on visibility change or container resize
  useEffect(() => {
    if (!ready || !isVisible) return;

    const fit = () => {
      try {
        fitAddonRef.current?.fit();
        const dims = fitAddonRef.current?.proposeDimensions();
        if (dims) {
          window.claude.terminal.resize(terminalId, dims.cols, dims.rows);
        }
      } catch {
        // ignore
      }
    };

    // Fit on visibility change
    requestAnimationFrame(fit);

    // Observe container resize
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(fit);
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [ready, isVisible, terminalId]);

  return (
    <div
      ref={containerRef}
      className="terminal-container h-full w-full px-2 py-1 [&_.xterm]:h-full [&_.xterm]:!bg-transparent [&_.xterm-viewport]:!bg-transparent [&_.xterm-screen]:!bg-transparent"
    />
  );
}
