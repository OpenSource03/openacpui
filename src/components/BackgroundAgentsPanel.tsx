import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  Loader2,
  ChevronRight,
  AlertCircle,
  X,
  Terminal,
  FileText,
  FileEdit,
  Search,
  FolderSearch,
  Globe,
  Wrench,
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
import type { BackgroundAgent, BackgroundAgentActivity, BackgroundAgentUsage } from "@/types";

const REMARK_PLUGINS = [remarkGfm];

interface BackgroundAgentsPanelProps {
  agents: BackgroundAgent[];
  onDismiss: (agentId: string) => void;
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
  Task: Bot,
};

function getToolIcon(toolName: string) {
  return TOOL_ICONS[toolName] ?? Wrench;
}

export function BackgroundAgentsPanel({ agents, onDismiss }: BackgroundAgentsPanelProps) {
  const runningCount = agents.filter((a) => a.status === "running").length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-foreground/50" />
          <span className="text-sm font-medium text-foreground/80">Agents</span>
          {runningCount > 0 && (
            <span className="ms-auto flex items-center gap-1.5 text-xs text-foreground/50">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="tabular-nums">{runningCount}</span>
            </span>
          )}
        </div>
      </div>

      {/* Separator */}
      <div className="border-t border-foreground/[0.08]" />

      {/* Scrollable agent list */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 py-2 space-y-1">
          {agents.map((agent) => (
            <AgentItem key={agent.toolUseId} agent={agent} onDismiss={onDismiss} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function AgentItem({
  agent,
  onDismiss,
}: {
  agent: BackgroundAgent;
  onDismiss: (agentId: string) => void;
}) {
  const isRunning = agent.status === "running";
  const isCompleted = agent.status === "completed";
  const isError = agent.status === "error";
  const [expanded, setExpanded] = useState(isRunning);

  const lastActivity = agent.activity[agent.activity.length - 1];

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div
        className={`rounded-md overflow-hidden ${
          isRunning ? "bg-foreground/[0.03]" : ""
        }`}
      >
        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-2 py-1.5 text-[13px] hover:text-foreground transition-colors cursor-pointer">
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-foreground/40 transition-transform duration-200 ${
              expanded ? "rotate-90" : ""
            }`}
          />
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 text-blue-400/70 animate-spin" />
          ) : isCompleted ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/60" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400/60" />
          )}
          <span className="truncate text-foreground/80">{agent.description}</span>
        </CollapsibleTrigger>

        {/* Live step indicator when collapsed & running */}
        {isRunning && !expanded && lastActivity && (
          <div className="px-2 ps-9 pb-1.5 text-xs text-foreground/40 truncate">
            <span className="animate-pulse">
              {lastActivity.toolName && (
                <span className="text-foreground/50">{lastActivity.toolName} </span>
              )}
              {lastActivity.summary}
            </span>
          </div>
        )}

        <CollapsibleContent>
          <div className="px-2 ps-9 pb-2 space-y-2">
            {/* Activity log (last 15) */}
            {agent.activity.length > 0 && (
              <div className="space-y-0.5">
                {agent.activity.slice(-15).map((activity, i) => (
                  <ActivityRow key={i} activity={activity} />
                ))}
              </div>
            )}

            {/* Live usage metrics */}
            {agent.usage && <UsageMetrics usage={agent.usage} />}

            {/* Result */}
            {(isCompleted || isError) && agent.result && (
              <AgentResult result={agent.result} />
            )}

            {/* Dismiss button */}
            {(isCompleted || isError) && (
              <div className="flex items-center pt-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="ms-auto h-5 w-5 text-foreground/40 hover:text-foreground/70"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(agent.agentId);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function AgentResult({ result }: { result: string }) {
  const [resultExpanded, setResultExpanded] = useState(false);
  const isLong = result.length > 200;

  return (
    <div className="rounded-md bg-foreground/[0.03] px-2.5 py-1.5">
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
          onClick={(e) => {
            e.stopPropagation();
            setResultExpanded((v) => !v);
          }}
        >
          {resultExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function ActivityRow({ activity }: { activity: BackgroundAgentActivity }) {
  if (activity.type === "tool_call") {
    const Icon = getToolIcon(activity.toolName ?? "");
    return (
      <div className="flex items-center gap-1.5 text-xs min-w-0">
        <Icon className="h-3 w-3 shrink-0 text-foreground/40" />
        <span className="shrink-0 text-foreground/60">{activity.toolName}</span>
        <span className="truncate text-foreground/40">{activity.summary}</span>
      </div>
    );
  }

  if (activity.type === "error") {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <AlertCircle className="h-3 w-3 shrink-0 text-red-400/50" />
        <span className="text-red-400/60">{activity.summary}</span>
      </div>
    );
  }

  // text type
  return (
    <div className="text-xs text-foreground/45 italic truncate">
      {activity.summary}
    </div>
  );
}

function UsageMetrics({ usage }: { usage: BackgroundAgentUsage }) {
  const tokens =
    usage.totalTokens >= 1000
      ? `${(usage.totalTokens / 1000).toFixed(1)}k`
      : String(usage.totalTokens);
  const duration =
    usage.durationMs >= 60_000
      ? `${(usage.durationMs / 60_000).toFixed(1)}m`
      : `${Math.round(usage.durationMs / 1000)}s`;

  return (
    <div className="flex items-center gap-2.5 text-[10px] text-foreground/35 tabular-nums pt-0.5">
      <span>{tokens} tokens</span>
      <span className="text-foreground/20">·</span>
      <span>{usage.toolUses} tools</span>
      <span className="text-foreground/20">·</span>
      <span>{duration}</span>
    </div>
  );
}
