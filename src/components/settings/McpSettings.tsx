import { Plug, PanelRight, FolderOpen, Activity } from "lucide-react";

export function McpSettings() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
          <Plug className="h-7 w-7 text-foreground/80" />
        </div>
        <h2 className="mt-1 text-xl font-semibold text-foreground">MCP Servers</h2>
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          MCP servers are managed from the{" "}
          <Plug className="inline h-3.5 w-3.5 -translate-y-px text-foreground/70" />{" "}
          <span className="font-medium text-foreground">MCP Servers</span> panel in the right-side toolbar.
        </p>

        <div className="mt-4 w-full space-y-3 rounded-xl border border-border/50 bg-muted/20 px-5 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
            Why the toolbar?
          </h3>
          <div className="flex gap-3">
            <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/90">Per-project configuration</span>{" "}
              &mdash; each project has its own set of MCP servers, so they live alongside your project workspace.
            </p>
          </div>
          <div className="flex gap-3">
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/90">Live status monitoring</span>{" "}
              &mdash; servers can disconnect mid-session. The toolbar panel shows real-time connection status so you can spot and fix issues quickly.
            </p>
          </div>
          <div className="flex gap-3">
            <PanelRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/90">Always accessible</span>{" "}
              &mdash; add, remove, authenticate, and reconnect servers without leaving your chat.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
