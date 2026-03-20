import { useState, useCallback, useRef, useEffect } from "react";
import {
  Bot,
  CheckCircle2,
  Loader2,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  X,
  Square,
  FileSearch,
  Terminal,
  FileText,
  FileEdit,
  Search,
  FolderSearch,
  Globe,
  Wrench,
  Clock,
  Zap,
  Hash,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PanelHeader } from "@/components/PanelHeader";
import { AgentTranscriptViewer } from "@/components/AgentTranscriptViewer";
import type { BackgroundAgent, BackgroundAgentActivity, BackgroundAgentUsage } from "@/types";

const REMARK_PLUGINS = [remarkGfm];

interface BackgroundAgentsPanelProps {
  agents: BackgroundAgent[];
  onDismiss: (agentId: string) => void;
  onStopAgent: (agentId: string, taskId: string) => void;
}

const TOOL_ICONS: Record<string, typeof Terminal> = {
  Bash: Terminal,
  Read: FileText,
  Write: FileEdit,
  Edit: FileEdit,
  Grep: Search,
  Glob: FolderSearch,
  WebSearch: Globe,
  WebFetch: Globe,
};

function getToolIcon(toolName: string) {
  return TOOL_ICONS[toolName] ?? Wrench;
}

export function BackgroundAgentsPanel({ agents, onDismiss, onStopAgent }: BackgroundAgentsPanelProps) {
  const runningCount = agents.filter((a) => a.status === "running" || a.status === "stopping").length;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        icon={Bot}
        label="Agents"
        className="px-4 pt-4 pb-3"
        iconClass="text-foreground/50"
      >
        {runningCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-foreground/50">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="tabular-nums">{runningCount}</span>
          </span>
        )}
      </PanelHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 py-2 space-y-2">
          {agents.map((agent) => (
            <AgentCard
              key={agent.toolUseId}
              agent={agent}
              onDismiss={onDismiss}
              onStopAgent={onStopAgent}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Agent Card ──

function AgentCard({
  agent,
  onDismiss,
  onStopAgent,
}: {
  agent: BackgroundAgent;
  onDismiss: (agentId: string) => void;
  onStopAgent: (agentId: string, taskId: string) => void;
}) {
  const isRunning = agent.status === "running";
  const isStopping = agent.status === "stopping";
  const isActive = isRunning || isStopping;
  const isCompleted = agent.status === "completed";
  const isError = agent.status === "error";
  const [expanded, setExpanded] = useState(isRunning);
  const [showTranscript, setShowTranscript] = useState(false);

  const handleStop = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (agent.taskId) onStopAgent(agent.agentId, agent.taskId);
    },
    [agent.agentId, agent.taskId, onStopAgent],
  );

  // Status accent colors
  const statusAccent = isStopping
    ? "border-s-amber-400/50"
    : isRunning
      ? "border-s-blue-400/40"
      : isCompleted
        ? "border-s-emerald-500/40"
        : "border-s-red-400/40";

  return (
    <>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className={`rounded-md overflow-hidden border-s-2 ${statusAccent} bg-foreground/[0.02]`}>
          {/* Header row */}
          <div className="flex items-center gap-1 pe-1">
            <CollapsibleTrigger asChild>
              <div className="group flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px] transition-colors hover:text-foreground cursor-pointer">
                <ChevronRight
                  className={`h-3 w-3 shrink-0 text-foreground/30 transition-transform duration-200 ${
                    expanded ? "rotate-90" : ""
                  }`}
                />
                <StatusIcon status={agent.status} />
                <span className="truncate text-foreground/80 font-medium">
                  {isStopping && <span className="text-amber-500/70">Stopping… </span>}
                  {agent.description}
                </span>
              </div>
            </CollapsibleTrigger>

            <div className="flex items-center gap-0.5 shrink-0">
              {isRunning && agent.taskId && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-foreground/30 hover:text-red-400/80"
                  onClick={handleStop}
                  title="Stop agent"
                >
                  <Square className="h-2.5 w-2.5" />
                </Button>
              )}
              {(isCompleted || isError) && agent.outputFile && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-foreground/30 hover:text-foreground/70"
                  onClick={(e) => { e.stopPropagation(); setShowTranscript(true); }}
                  title="View full transcript"
                >
                  <FileSearch className="h-3 w-3" />
                </Button>
              )}
              {(isCompleted || isError) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-foreground/30 hover:text-foreground/70"
                  onClick={(e) => { e.stopPropagation(); onDismiss(agent.agentId); }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          {/* Progress summary — AI-generated description of what the agent is doing */}
          {isActive && agent.progressSummary && (
            <div className="px-3 ps-8 pb-1.5 text-[11px] text-foreground/40 italic truncate">
              {agent.progressSummary}
            </div>
          )}

          {/* Current tool — real-time indicator from tool_progress events */}
          {isRunning && agent.currentTool && (
            <CurrentToolBadge name={agent.currentTool.name} elapsed={agent.currentTool.elapsedSeconds} />
          )}

          {/* Collapsed preview — show last activity when collapsed & running */}
          {isRunning && !expanded && !agent.currentTool && agent.activity.length > 0 && (
            <CollapsedPreview activity={agent.activity[agent.activity.length - 1]} />
          )}

          {/* Expanded content */}
          <CollapsibleContent>
            <div className="px-2 ps-5 pb-2 space-y-2">
              {/* Activity timeline */}
              {agent.activity.length > 0 && (
                <ActivityTimeline activities={agent.activity} isRunning={isRunning} />
              )}

              {/* Usage metrics bar */}
              {agent.usage && <UsageBar usage={agent.usage} />}

              {/* Result */}
              {(isCompleted || isError) && agent.result && (
                <AgentResult result={agent.result} isError={isError} />
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {showTranscript && agent.outputFile && (
        <AgentTranscriptViewer
          outputFile={agent.outputFile}
          agentDescription={agent.description}
          onClose={() => setShowTranscript(false)}
        />
      )}
    </>
  );
}

// ── Status icon ──

function StatusIcon({ status }: { status: BackgroundAgent["status"] }) {
  switch (status) {
    case "stopping":
      return <Loader2 className="h-3.5 w-3.5 shrink-0 text-amber-400/70 animate-spin" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 shrink-0 text-blue-400/60 animate-spin" />;
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/60" />;
    default:
      return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400/60" />;
  }
}

// ── Current tool badge ──

function CurrentToolBadge({ name, elapsed }: { name: string; elapsed: number }) {
  const Icon = getToolIcon(name);
  return (
    <div className="mx-3 ms-8 mb-1.5 flex items-center gap-1.5 rounded bg-foreground/[0.04] px-2 py-1 text-[11px]">
      <Icon className="h-3 w-3 shrink-0 text-blue-400/50 animate-pulse" />
      <span className="text-foreground/55 font-medium">{name}</span>
      <span className="text-foreground/30 tabular-nums ms-auto">{Math.round(elapsed)}s</span>
    </div>
  );
}

// ── Collapsed preview ──

function CollapsedPreview({ activity }: { activity: BackgroundAgentActivity }) {
  return (
    <div className="px-3 ps-8 pb-1.5 text-[11px] text-foreground/35 truncate animate-pulse">
      {activity.toolName && <span className="text-foreground/45">{activity.toolName} </span>}
      {activity.summary}
    </div>
  );
}

// ── Activity timeline (auto-scrolling) ──

function ActivityTimeline({ activities, isRunning }: { activities: BackgroundAgentActivity[]; isRunning: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new activities arrive on running agents
  useEffect(() => {
    if (isRunning && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [activities.length, isRunning]);

  return (
    <div className="max-h-52 overflow-y-auto space-y-px scrollbar-none rounded">
      {activities.map((activity, i) => (
        <ActivityItem key={i} activity={activity} isLast={i === activities.length - 1 && isRunning} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

// ── Activity item (expandable for tool calls) ──

function ActivityItem({ activity, isLast }: { activity: BackgroundAgentActivity; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (activity.type === "tool_call") {
    const Icon = getToolIcon(activity.toolName ?? "");
    const hasSummary = activity.summary && activity.summary !== activity.toolName;

    return (
      <div
        className={`rounded transition-colors ${
          isLast ? "bg-foreground/[0.03]" : "hover:bg-foreground/[0.02]"
        }`}
      >
        <button
          type="button"
          className="flex items-center gap-1.5 w-full text-start px-2 py-1 text-[11px] min-w-0 cursor-pointer"
          onClick={() => hasSummary && setExpanded((v) => !v)}
        >
          <Icon className={`h-3 w-3 shrink-0 ${isLast ? "text-blue-400/50" : "text-foreground/30"}`} />
          <span className={`shrink-0 font-medium ${isLast ? "text-foreground/60" : "text-foreground/50"}`}>
            {activity.toolName}
          </span>
          {!expanded && hasSummary && (
            <span className="truncate text-foreground/30 flex-1">{activity.summary}</span>
          )}
          {hasSummary && (
            expanded
              ? <ChevronDown className="h-2.5 w-2.5 shrink-0 text-foreground/20 ms-auto" />
              : <ChevronRight className="h-2.5 w-2.5 shrink-0 text-foreground/20 ms-auto" />
          )}
        </button>
        {expanded && hasSummary && (
          <div className="px-2 ps-7 pb-1.5 text-[10px] text-foreground/35 whitespace-pre-wrap wrap-break-word leading-relaxed">
            {activity.summary}
          </div>
        )}
      </div>
    );
  }

  if (activity.type === "error") {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded bg-red-500/[0.04]">
        <AlertCircle className="h-3 w-3 shrink-0 text-red-400/50" />
        <span className="text-red-400/60 truncate">{activity.summary}</span>
      </div>
    );
  }

  // text type
  return (
    <div className="px-2 py-1 text-[11px] text-foreground/35 italic truncate">
      {activity.summary}
    </div>
  );
}

// ── Usage bar (compact metrics) ──

function UsageBar({ usage }: { usage: BackgroundAgentUsage }) {
  const tokens =
    usage.totalTokens >= 1000
      ? `${(usage.totalTokens / 1000).toFixed(1)}k`
      : String(usage.totalTokens);
  const duration =
    usage.durationMs >= 60_000
      ? `${(usage.durationMs / 60_000).toFixed(1)}m`
      : `${Math.round(usage.durationMs / 1000)}s`;

  return (
    <div className="flex items-center gap-3 text-[10px] text-foreground/30 tabular-nums px-1 pt-1">
      <span className="flex items-center gap-1">
        <Zap className="h-2.5 w-2.5" />
        {tokens}
      </span>
      <span className="flex items-center gap-1">
        <Hash className="h-2.5 w-2.5" />
        {usage.toolUses}
      </span>
      <span className="flex items-center gap-1">
        <Clock className="h-2.5 w-2.5" />
        {duration}
      </span>
    </div>
  );
}

// ── Agent result ──

function AgentResult({ result, isError }: { result: string; isError?: boolean }) {
  const [resultExpanded, setResultExpanded] = useState(false);
  const isLong = result.length > 200;

  return (
    <div className={`rounded-md px-2.5 py-1.5 ${
      isError ? "bg-red-500/[0.04]" : "bg-foreground/[0.03]"
    }`}>
      <div
        className={`prose dark:prose-invert prose-xs max-w-none text-[11px] text-foreground/60 wrap-break-word
          [&_p]:my-1 [&_p]:leading-relaxed
          [&_pre]:my-1 [&_pre]:rounded [&_pre]:bg-foreground/[0.04] [&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:text-[10px]
          [&_code]:text-[10px] [&_code]:text-foreground/60
          [&_ul]:my-1 [&_ul]:ps-4 [&_ol]:my-1 [&_ol]:ps-4
          [&_li]:my-0 [&_li]:text-[11px]
          [&_strong]:text-foreground/80
          [&_h1]:text-xs [&_h1]:my-1 [&_h2]:text-xs [&_h2]:my-1 [&_h3]:text-[11px] [&_h3]:my-1
          ${!resultExpanded && isLong ? "line-clamp-4" : ""}`}
      >
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{result}</ReactMarkdown>
      </div>
      {isLong && (
        <button
          type="button"
          className="mt-1 text-[10px] text-foreground/40 hover:text-foreground/60 transition-colors cursor-pointer"
          onClick={(e) => { e.stopPropagation(); setResultExpanded((v) => !v); }}
        >
          {resultExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
