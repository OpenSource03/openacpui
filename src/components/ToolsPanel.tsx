import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Terminal as TerminalIcon, Plus, X, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelHeader } from "@/components/PanelHeader";
import type { TerminalTab } from "@/hooks/useSessionTerminals";
import type { ResolvedTheme } from "@/hooks/useTheme";

const DARK_TERMINAL_THEME = {
  background: "#00000000",
  foreground: "#c8c8c8",
  cursor: "#c8c8c8",
  cursorAccent: "#1a1a1a",
  selectionBackground: "rgba(255, 255, 255, 0.12)",
  selectionForeground: undefined,
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

const TERMINAL_BACKEND_RESIZE_DEBOUNCE_MS = 200;
const MIN_TERMINAL_BACKEND_COLS = 4;
const MIN_TERMINAL_BACKEND_ROWS = 2;

function getTerminalTheme(theme: ResolvedTheme) {
  return theme === "dark" ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
}

function scheduleTerminalResize(
  terminalId: string,
  cols: number,
  rows: number,
  lastReportedDimsRef: MutableRefObject<{ cols: number; rows: number } | null>,
  pendingResizeTimeoutRef: MutableRefObject<number | null>,
  delayMs = TERMINAL_BACKEND_RESIZE_DEBOUNCE_MS,
): void {
  if (cols < MIN_TERMINAL_BACKEND_COLS || rows < MIN_TERMINAL_BACKEND_ROWS) {
    return;
  }

  const lastReported = lastReportedDimsRef.current;
  if (lastReported && lastReported.cols === cols && lastReported.rows === rows) {
    return;
  }

  if (pendingResizeTimeoutRef.current != null) {
    window.clearTimeout(pendingResizeTimeoutRef.current);
  }

  pendingResizeTimeoutRef.current = window.setTimeout(() => {
    pendingResizeTimeoutRef.current = null;
    window.claude.terminal.resize(terminalId, cols, rows);
    lastReportedDimsRef.current = { cols, rows };
  }, delayMs);
}

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
  headerControls?: React.ReactNode;
}

export function ToolsPanel({
  spaceId,
  tabs,
  activeTabId,
  terminalsReady,
  onSetActiveTab,
  onCreateTerminal,
  onEnsureTerminal,
  onCloseTerminal,
  resolvedTheme,
  headerControls,
}: ToolsPanelProps) {
  const handleCreateTerminal = () => {
    if (!terminalsReady) return Promise.resolve();
    return onCreateTerminal();
  };

  useEffect(() => {
    if (terminalsReady && tabs.length === 0) {
      void onEnsureTerminal();
    }
  }, [spaceId, terminalsReady, tabs.length, onEnsureTerminal]);

  const hasTabs = tabs.length > 0;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader icon={TerminalIcon} label="Terminal" iconClass="text-emerald-600/70 dark:text-emerald-200/50">
        {hasTabs && (
          <span className="text-[10px] tabular-nums text-foreground/35">{tabs.length}</span>
        )}
        {headerControls}
      </PanelHeader>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`absolute inset-0 ${tab.id === activeTabId ? "visible" : "invisible"}`}
            >
              <TerminalInstance
                terminalId={tab.terminalId}
                isVisible={tab.id === activeTabId}
                resolvedTheme={resolvedTheme}
              />
            </div>
          ))}

          {!hasTabs && terminalsReady && (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.03]">
                <TerminalIcon className="h-5 w-5 text-emerald-600/70 dark:text-emerald-200/50" />
              </div>
              <button
                type="button"
                onClick={() => { void handleCreateTerminal(); }}
                className="group flex cursor-pointer items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium text-foreground/35 transition-all duration-200 hover:bg-foreground/[0.05] hover:text-foreground/60"
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

        {hasTabs && (
          <>
            <div className="my-2 w-px bg-foreground/[0.06]" />

            <div className="flex w-[38px] shrink-0 flex-col items-center py-1.5">
              <div className="flex flex-1 flex-col items-center gap-0.5 overflow-y-auto scrollbar-none">
                {tabs.map((tab, index) => {
                  const isActive = tab.id === activeTabId;
                  return (
                    <Tooltip key={tab.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onSetActiveTab(tab.id)}
                          className={`group/term relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-all duration-150 ${
                            isActive
                              ? "bg-foreground/[0.08] text-foreground"
                              : "text-foreground/30 hover:bg-foreground/[0.04] hover:text-foreground/60"
                          }`}
                        >
                          <span className="text-[10px] font-semibold leading-none tabular-nums">
                            {index + 1}
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              void onCloseTerminal(tab.id);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.stopPropagation();
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

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => { void handleCreateTerminal(); }}
                    className="mt-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-foreground/25 transition-all duration-150 hover:bg-foreground/[0.05] hover:text-foreground/50 active:scale-90"
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
    </div>
  );
}

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
  const lastReportedDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  const pendingResizeTimeoutRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let unsubData: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;

    (async () => {
      const snapshotPromise = window.claude.terminal.snapshot(terminalId);

      unsubData = window.claude.terminal.onData(({ terminalId: id, data, seq }) => {
        if (id !== terminalId || disposed) return;
        if (!hydratedRef.current) {
          pendingChunksRef.current.push({ seq, data });
          return;
        }
        if (seq <= lastSeqRef.current) return;
        lastSeqRef.current = seq;
        xtermRef.current?.write(data);
      });

      unsubExit = window.claude.terminal.onExit(({ terminalId: id }) => {
        if (id !== terminalId || disposed) return;
        if (xtermRef.current) {
          xtermRef.current.options.disableStdin = true;
        }
      });

      const snapshot = await snapshotPromise;
      if (disposed || !containerRef.current) return;

      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (disposed || !containerRef.current) return;

      const initialCols = snapshot.cols ?? 80;
      const initialRows = snapshot.rows ?? 24;
      const fitAddon = new FitAddon();
      const term = new Terminal({
        cols: initialCols,
        rows: initialRows,
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
      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
      lastReportedDimsRef.current = snapshot.cols && snapshot.rows
        ? { cols: snapshot.cols, rows: snapshot.rows }
        : null;

      term.onData((data) => {
        if (suppressInputRef.current) return;
        window.claude.terminal.write(terminalId, data);
      });

      if (snapshot.output) {
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

      term.open(containerRef.current);

      requestAnimationFrame(() => {
        if (disposed) return;
        try {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            scheduleTerminalResize(
              terminalId,
              dims.cols,
              dims.rows,
              lastReportedDimsRef,
              pendingResizeTimeoutRef,
            );
          }
        } catch {
          // Container may not be sized yet.
        }
      });

      setReady(true);
    })();

    return () => {
      disposed = true;
      setReady(false);
      unsubData?.();
      unsubExit?.();
      if (pendingResizeTimeoutRef.current != null) {
        window.clearTimeout(pendingResizeTimeoutRef.current);
        pendingResizeTimeoutRef.current = null;
      }
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      lastSeqRef.current = 0;
      pendingChunksRef.current = [];
      hydratedRef.current = false;
      suppressInputRef.current = false;
      lastReportedDimsRef.current = null;
    };
  }, [terminalId]);

  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.theme = getTerminalTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (!ready || !isVisible) return;

    const fit = () => {
      try {
        fitAddonRef.current?.fit();
        const dims = fitAddonRef.current?.proposeDimensions();
        if (dims) {
          scheduleTerminalResize(
            terminalId,
            dims.cols,
            dims.rows,
            lastReportedDimsRef,
            pendingResizeTimeoutRef,
          );
        }
      } catch {
        // Ignore transient layout frames.
      }
    };

    requestAnimationFrame(fit);

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(fit);
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [isVisible, ready, terminalId]);

  return (
    <div
      ref={containerRef}
      className="terminal-container h-full w-full px-2 py-1 [&_.xterm]:h-full [&_.xterm]:!bg-transparent [&_.xterm-viewport]:!bg-transparent [&_.xterm-screen]:!bg-transparent"
    />
  );
}
