import { memo, useCallback, useRef, useEffect, useState } from "react";
import {
  Play,
  Square,
  X,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  Check,
  XCircle,
  Terminal,
  Save,
  Maximize2,
  Minimize2,
  Package,
  Boxes,
  Coffee,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelHeader } from "@/components/PanelHeader";
import { useExecutions, type DetectedRunner } from "@/hooks/useExecutions";
import { parseAnsi } from "@/lib/ansi-parser";

interface SavedRun {
  id: string;
  label: string;
  command: string;
}

function loadSavedRuns(projectKey: string): SavedRun[] {
  try {
    const raw = localStorage.getItem(`harnss-${projectKey}-saved-runs`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSavedRuns(projectKey: string, runs: SavedRun[]): void {
  localStorage.setItem(`harnss-${projectKey}-saved-runs`, JSON.stringify(runs));
}

function projectKeyFromCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

interface ExecutionsPanelProps {
  cwd?: string;
  enabled?: boolean;
}

function runnerIcon(source: string) {
  const s = source.toLowerCase();
  if (s.includes("cargo") || s.includes("rust")) return Zap;
  if (s.includes("maven") || s.includes("gradle") || s.includes("java")) return Coffee;
  if (s.includes("composer") || s.includes("php")) return Boxes;
  return Package;
}

function RunnerSection({
  runner,
  expanded,
  onToggle,
  onRun,
}: {
  runner: DetectedRunner;
  expanded: boolean;
  onToggle: () => void;
  onRun: (command: string, label: string) => void;
}) {
  const entries = Object.entries(runner.scripts);
  const Icon = runnerIcon(runner.source);
  return (
    <div className="border-b border-foreground/[0.06]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 transition-colors hover:bg-foreground/[0.03] cursor-pointer"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-foreground/45" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-foreground/45" />
        )}
        <Icon className="h-3 w-3 shrink-0 text-foreground/40" />
        <span className="text-[11px] font-semibold text-foreground/60">{runner.source}</span>
        <span className="rounded-full bg-foreground/[0.07] px-1.5 py-px text-[10px] font-medium tabular-nums text-foreground/45">
          {entries.length}
        </span>
      </button>
      {expanded && (
        <div className="pb-1.5">
          {entries.map(([name, cmd]) => (
            <div
              key={name}
              className="group flex items-center gap-1.5 px-3 py-[3px] text-[10px] transition-colors hover:bg-foreground/[0.03]"
            >
              <span className="shrink-0 font-medium text-foreground/70">{name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-foreground/35">{cmd}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden h-5 w-5 shrink-0 text-foreground/40 hover:text-foreground/70 group-hover:flex"
                    onClick={() => onRun(cmd, name)}
                  >
                    <Play className="h-2.5 w-2.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p className="text-xs">Run</p></TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const ExecutionsPanel = memo(function ExecutionsPanel({
  cwd,
  enabled = true,
}: ExecutionsPanelProps) {
  const exec = useExecutions(enabled ? cwd : undefined);
  const [expandedRunners, setExpandedRunners] = useState<Set<string>>(new Set());
  const [savedExpanded, setSavedExpanded] = useState(true);
  const [customCommand, setCustomCommand] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const [logsCollapsed, setLogsCollapsed] = useState(false);
  const [logsMaximized, setLogsMaximized] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  const projectKey = cwd ? projectKeyFromCwd(cwd) : "";

  useEffect(() => {
    if (projectKey) setSavedRuns(loadSavedRuns(projectKey));
  }, [projectKey]);

  useEffect(() => {
    if (exec.runners.length > 0) {
      setExpandedRunners(new Set(exec.runners.map((r) => r.source)));
    }
  }, [exec.runners]);

  const activeEntry = exec.activeExecutionId
    ? exec.executions.get(exec.activeExecutionId)
    : null;

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [activeEntry?.output]);

  const handleRun = useCallback(
    (command: string, label: string) => {
      if (!cwd) return;
      exec.runCommand(cwd, command, label);
    },
    [cwd, exec],
  );

  const handleRunCustom = useCallback(() => {
    if (!cwd || !customCommand.trim()) return;
    exec.runCommand(cwd, customCommand.trim());
    setCustomCommand("");
  }, [cwd, customCommand, exec]);

  const handleSaveRun = useCallback(() => {
    if (!customCommand.trim() || !projectKey) return;
    const run: SavedRun = {
      id: `run-${Date.now()}`,
      label: customLabel.trim() || customCommand.trim(),
      command: customCommand.trim(),
    };
    const next = [...savedRuns, run];
    setSavedRuns(next);
    persistSavedRuns(projectKey, next);
    setCustomCommand("");
    setCustomLabel("");
    setShowAddForm(false);
  }, [customCommand, customLabel, savedRuns, projectKey]);

  const handleDeleteSavedRun = useCallback(
    (id: string) => {
      const next = savedRuns.filter((r) => r.id !== id);
      setSavedRuns(next);
      persistSavedRuns(projectKey, next);
    },
    [savedRuns, projectKey],
  );

  const toggleRunner = useCallback((source: string) => {
    setExpandedRunners((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  const executionEntries = Array.from(exec.executions.values());

  if (!cwd) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader icon={Play} label="Executions" iconClass="text-amber-600/70 dark:text-amber-200/50" />
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/[0.05]">
            <Terminal className="h-3.5 w-3.5 text-foreground/25" />
          </div>
          <p className="text-[11px] text-foreground/40">No project open</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader icon={Play} label="Executions" iconClass="text-amber-600/70 dark:text-amber-200/50" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-foreground/[0.06]">
          <button
            type="button"
            onClick={() => setSavedExpanded((p) => !p)}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 transition-colors hover:bg-foreground/[0.03] cursor-pointer"
          >
            {savedExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-foreground/45" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-foreground/45" />
            )}
            <span className="text-[11px] font-semibold text-foreground/60">Custom Runs</span>
            {savedRuns.length > 0 && (
              <span className="rounded-full bg-foreground/[0.07] px-1.5 py-px text-[10px] font-medium tabular-nums text-foreground/45">
                {savedRuns.length}
              </span>
            )}
            <div className="flex-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0 text-foreground/40 hover:text-foreground/70"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAddForm((p) => !p);
                    if (!savedExpanded) setSavedExpanded(true);
                  }}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Add Run</p></TooltipContent>
            </Tooltip>
          </button>
          {savedExpanded && (
            <div className="pb-1.5">
              {showAddForm && (
                <div className="mx-3 mb-2 mt-1 space-y-1.5 rounded-md border border-foreground/[0.12] bg-foreground/[0.03] p-2.5">
                  <input
                    type="text"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    placeholder="Label (e.g. Dev Server)"
                    className="h-6 w-full rounded border border-input bg-background px-2 text-[10px] text-foreground/85 outline-none placeholder:text-foreground/40 focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <input
                    type="text"
                    value={customCommand}
                    onChange={(e) => setCustomCommand(e.target.value)}
                    placeholder="Command (e.g. npm run dev)"
                    className="h-6 w-full rounded border border-input bg-background px-2 font-mono text-[10px] text-foreground/85 outline-none placeholder:text-foreground/40 focus-visible:ring-1 focus-visible:ring-ring"
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveRun(); }}
                  />
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-2 text-[10px] text-foreground/50"
                      onClick={() => { setShowAddForm(false); setCustomCommand(""); setCustomLabel(""); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-2 text-[10px] text-foreground/70"
                      onClick={handleSaveRun}
                      disabled={!customCommand.trim()}
                    >
                      <Save className="me-1 h-2.5 w-2.5" />
                      Save
                    </Button>
                  </div>
                </div>
              )}
              {savedRuns.length === 0 && !showAddForm && (
                <div className="flex items-center gap-1.5 px-3 py-1">
                  <Save className="h-3 w-3 shrink-0 text-foreground/25" />
                  <p className="text-[10px] text-foreground/35">No saved runs yet — click + to add one</p>
                </div>
              )}
              {savedRuns.map((run) => (
                <div
                  key={run.id}
                  className="group flex items-center gap-1.5 px-3 py-[3px] text-[10px] transition-colors hover:bg-foreground/[0.03]"
                >
                  <span className="shrink-0 font-medium text-foreground/70">{run.label}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-foreground/35">{run.command}</span>
                  <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-5 w-5 text-foreground/40 hover:text-foreground/70" onClick={() => handleRun(run.command, run.label)}>
                          <Play className="h-2.5 w-2.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom"><p className="text-xs">Run</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-5 w-5 text-foreground/40 hover:text-red-500/70" onClick={() => handleDeleteSavedRun(run.id)}>
                          <Trash2 className="h-2.5 w-2.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom"><p className="text-xs">Delete</p></TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {exec.runners.map((runner) => (
          <RunnerSection
            key={runner.source}
            runner={runner}
            expanded={expandedRunners.has(runner.source)}
            onToggle={() => toggleRunner(runner.source)}
            onRun={handleRun}
          />
        ))}

        <div className="flex items-center gap-1 border-b border-foreground/[0.06] px-3 py-2">
          <input
            type="text"
            value={customCommand}
            onChange={(e) => setCustomCommand(e.target.value)}
            placeholder="Quick run a command..."
            className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-2 font-mono text-[10px] text-foreground/85 outline-none placeholder:text-foreground/40 focus-visible:ring-1 focus-visible:ring-ring"
            onKeyDown={(e) => { if (e.key === "Enter") handleRunCustom(); }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-foreground/40 hover:text-foreground/70"
            onClick={handleRunCustom}
            disabled={!customCommand.trim()}
          >
            <Play className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {executionEntries.length > 0 && (
        <>
          <div className="flex shrink-0 items-center border-y border-foreground/[0.06] bg-foreground/[0.02]">
            <div className="flex min-w-0 flex-1 gap-px overflow-x-auto px-1 pt-1">
              {executionEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => exec.setActiveExecutionId(entry.id)}
                  className={`group/tab flex max-w-[160px] items-center gap-1 rounded-t-md px-2 py-1 text-[10px] transition-colors cursor-pointer ${
                    exec.activeExecutionId === entry.id
                      ? "bg-background text-foreground/80 shadow-[inset_0_-2px_0_0] shadow-foreground/20"
                      : "text-foreground/45 hover:text-foreground/65 hover:bg-foreground/[0.03]"
                  }`}
                >
                  {entry.exitCode === null ? (
                    <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-amber-500" />
                  ) : entry.exitCode === 0 ? (
                    <Check className="h-2.5 w-2.5 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="h-2.5 w-2.5 shrink-0 text-red-500" />
                  )}
                  <span className="min-w-0 truncate">{entry.label}</span>
                  {entry.exitCode !== null && (
                    <button
                      type="button"
                      className="ms-auto hidden h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-foreground/30 hover:text-foreground/60 group-hover/tab:flex"
                      onClick={(e) => { e.stopPropagation(); exec.clearExecution(entry.id); }}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 px-1">
              {activeEntry?.exitCode === null && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-600"
                      onClick={() => { if (exec.activeExecutionId) exec.stopExecution(exec.activeExecutionId); }}
                    >
                      <Square className="h-3 w-3 fill-current" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom"><p className="text-xs">Stop</p></TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 text-foreground/30 hover:text-foreground/60"
                    onClick={() => setLogsCollapsed((p) => !p)}
                  >
                    {logsCollapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p className="text-xs">{logsCollapsed ? "Show Logs" : "Hide Logs"}</p></TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 text-foreground/30 hover:text-foreground/60"
                    onClick={() => setLogsMaximized((p) => !p)}
                  >
                    {logsMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p className="text-xs">{logsMaximized ? "Restore" : "Maximize Logs"}</p></TooltipContent>
              </Tooltip>
            </div>
          </div>

          {!logsCollapsed && (
            <pre
              ref={outputRef}
              className={`select-text overflow-auto bg-background p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all ${logsMaximized ? "fixed inset-4 z-50 rounded-xl border border-foreground/[0.1] bg-background shadow-2xl" : "min-h-0 flex-1"}`}
            >
              {logsMaximized && (
                <button
                  type="button"
                  className="absolute end-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-foreground/[0.08] text-foreground/50 hover:text-foreground/80 cursor-pointer"
                  onClick={() => setLogsMaximized(false)}
                >
                  <Minimize2 className="h-3 w-3" />
                </button>
              )}
              {activeEntry?.output ? (
                parseAnsi(activeEntry.output).map((span, i) => (
                  <span key={i} className={span.className || "text-foreground/80"} style={span.style}>{span.text}</span>
                ))
              ) : (
                <span className="text-foreground/30">No output yet...</span>
              )}
            </pre>
          )}
        </>
      )}

      {executionEntries.length === 0 && exec.runners.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.05]">
            <Terminal className="h-4 w-4 text-foreground/25" />
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <p className="text-[11px] font-medium text-foreground/40">No runners detected</p>
            <p className="text-[10px] text-foreground/25">Use Quick Run above to execute a command</p>
          </div>
        </div>
      )}
    </div>
  );
});
