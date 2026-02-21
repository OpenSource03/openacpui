import { memo, useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, RefreshCw, X } from "lucide-react";

type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; percent: number }
  | { phase: "ready"; version: string };

export const UpdateBanner = memo(function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      window.claude.updater.onUpdateAvailable((info) => {
        setState({ phase: "available", version: info.version });
        setDismissed(false);
      }),
    );

    unsubs.push(
      window.claude.updater.onDownloadProgress((progress) => {
        setState({ phase: "downloading", percent: Math.round(progress.percent) });
      }),
    );

    unsubs.push(
      window.claude.updater.onUpdateDownloaded((info) => {
        setState({ phase: "ready", version: info.version });
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, []);

  const handleDownload = useCallback(() => {
    window.claude.updater.download();
    setState({ phase: "downloading", percent: 0 });
  }, []);

  const handleInstall = useCallback(() => {
    window.claude.updater.install();
  }, []);

  if (state.phase === "idle" || dismissed) return null;

  return (
    <div className="mx-2 mb-1.5">
      <div className="glass-outline group flex items-center gap-2 rounded-lg bg-sidebar-accent px-2.5 py-2 text-xs text-sidebar-foreground/80">
        {state.phase === "available" && (
          <>
            <ArrowDownToLine className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50" />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-sidebar-foreground/90">v{state.version}</span>
              <span className="text-sidebar-foreground/50"> available</span>
            </div>
            <button
              className="shrink-0 text-sidebar-foreground/30 opacity-0 transition-opacity hover:text-sidebar-foreground/60 group-hover:opacity-100"
              onClick={() => setDismissed(true)}
            >
              <X className="h-3 w-3" />
            </button>
            <button
              className="shrink-0 rounded px-2 py-0.5 font-medium text-sidebar-foreground/90 transition-colors hover:bg-sidebar-foreground/10"
              onClick={handleDownload}
            >
              Update
            </button>
          </>
        )}

        {state.phase === "downloading" && (
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sidebar-foreground/60">Downloading...</span>
              <span className="tabular-nums text-sidebar-foreground/50">{state.percent}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-sidebar-foreground/10">
              <div
                className="h-full rounded-full bg-sidebar-foreground/40 transition-[width] duration-300"
                style={{ width: `${state.percent}%` }}
              />
            </div>
          </div>
        )}

        {state.phase === "ready" && (
          <>
            <RefreshCw className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50" />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-sidebar-foreground/90">v{state.version}</span>
              <span className="text-sidebar-foreground/50"> ready</span>
            </div>
            <button
              className="shrink-0 text-sidebar-foreground/30 opacity-0 transition-opacity hover:text-sidebar-foreground/60 group-hover:opacity-100"
              onClick={() => setDismissed(true)}
            >
              <X className="h-3 w-3" />
            </button>
            <button
              className="shrink-0 rounded px-2 py-0.5 font-medium text-sidebar-foreground/90 transition-colors hover:bg-sidebar-foreground/10"
              onClick={handleInstall}
            >
              Restart
            </button>
          </>
        )}
      </div>
    </div>
  );
});
