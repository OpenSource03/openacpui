import { useState, useEffect, useRef, memo } from "react";
import {
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { UIMessage } from "@/types";
import { getToolIcon, getToolLabel } from "@/components/lib/tool-metadata";
import { formatCompactSummary } from "@/components/lib/tool-formatting";
import { McpToolContent, hasMcpRenderer } from "./McpToolContent";
import { TextShimmer } from "@/components/ui/text-shimmer";

// ── Tool renderers (extracted) ──
import { BashContent } from "./tool-renderers/BashContent";
import { WriteContent } from "./tool-renderers/WriteContent";
import { EditContent } from "./tool-renderers/EditContent";
import { ReadContent } from "./tool-renderers/ReadContent";
import { SearchContent } from "./tool-renderers/SearchContent";
import { WebSearchContent } from "./tool-renderers/WebSearchContent";
import { WebFetchContent } from "./tool-renderers/WebFetchContent";
import { TaskTool } from "./tool-renderers/TaskTool";
import { TodoWriteContent } from "./tool-renderers/TodoWriteContent";
import { EnterPlanModeContent, ExitPlanModeContent } from "./tool-renderers/PlanContent";
import { AskUserQuestionContent } from "./tool-renderers/AskUserQuestion";
import { GenericContent } from "./tool-renderers/GenericContent";
import { ToolSearchContent } from "./tool-renderers/ToolSearchContent";

// ── Main entry ──

export const ToolCall = memo(function ToolCall({ message, compact }: { message: UIMessage; compact?: boolean }) {
  const normalizedToolName = (message.toolName ?? "").toLowerCase();
  const isTask = normalizedToolName === "task" || normalizedToolName === "agent";
  const content = isTask ? <TaskTool message={message} /> : <RegularTool message={message} />;

  // compact: skip outer padding wrapper (used inside ToolGroupBlock to avoid double padding)
  if (compact) return content;

  return (
    <div className="flex justify-start px-4 py-0.5">
      <div className="min-w-0 max-w-[85%]">
        {content}
      </div>
    </div>
  );
}, (prev, next) =>
  prev.message.toolInput === next.message.toolInput &&
  prev.message.toolResult === next.message.toolResult &&
  prev.message.toolError === next.message.toolError &&
  prev.message.subagentSteps === next.message.subagentSteps &&
  prev.message.subagentStatus === next.message.subagentStatus,
);

// ── Regular tool (Read, Write, Edit, Bash, Grep, Glob, etc.) ──

function RegularTool({ message }: { message: UIMessage }) {
  const isInteractive = message.toolName === "ExitPlanMode" || message.toolName === "AskUserQuestion";
  const isEditLike = message.toolName === "Edit" || message.toolName === "Write" || isInteractive;
  const [expanded, setExpanded] = useState(isEditLike);
  const hasResult = !!message.toolResult;
  const isRunning = !hasResult;
  const isError = !!message.toolError;
  const Icon = getToolIcon(message.toolName ?? "");
  const summary = formatCompactSummary(message);

  // Track whether toolResult was present at mount (persisted session → skip auto-expand)
  const initialHadResult = useRef(hasResult);
  // Track whether user manually toggled the collapsible (cancel auto-collapse)
  const userToggled = useRef(false);
  const autoCollapseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-expand on result arrival, then auto-collapse after 2s
  useEffect(() => {
    if (!hasResult || initialHadResult.current || isEditLike || userToggled.current) return;
    setExpanded(true);
    autoCollapseTimer.current = setTimeout(() => {
      if (!userToggled.current) setExpanded(false);
    }, 2000);
    return () => clearTimeout(autoCollapseTimer.current);
  }, [hasResult, isEditLike]);

  const handleOpenChange = (open: boolean) => {
    userToggled.current = true;
    clearTimeout(autoCollapseTimer.current);
    setExpanded(open);
  };

  return (
    <Collapsible open={expanded} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger className="group relative flex w-full items-center gap-2 py-1 text-[13px] hover:text-foreground transition-colors cursor-pointer overflow-hidden">

        <div className="relative flex items-center gap-2 min-w-0">
          {isError ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400/70" />
          ) : (
            <Icon className="h-3.5 w-3.5 shrink-0 text-foreground/35" />
          )}
          {isRunning ? (
            <TextShimmer as="span" className="shrink-0 whitespace-nowrap font-medium" duration={1.8} spread={1.5}>
              {getToolLabel(message.toolName ?? "", "active") ?? message.toolName ?? "Running"}
            </TextShimmer>
          ) : (
            <span className={`shrink-0 whitespace-nowrap font-medium ${isError ? "text-red-400/70" : "text-foreground/75"}`}>
              {isError
                ? `Failed to ${getToolLabel(message.toolName ?? "", "failure")}`
                : (getToolLabel(message.toolName ?? "", "past") ?? message.toolName)}
            </span>
          )}
          <span className="truncate text-foreground/40">{summary}</span>
        </div>

        {hasResult && (
          <ChevronRight
            className={`ms-auto h-3 w-3 shrink-0 text-foreground/30 opacity-0 group-hover:opacity-100 transition-all duration-200 ${
              expanded ? "rotate-90" : ""
            }`}
          />
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-1 mb-2">
          <ExpandedToolContent message={message} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Expanded content router ──

function ExpandedToolContent({ message }: { message: UIMessage }) {
  switch (message.toolName) {
    case "Bash":
      return <BashContent message={message} />;
    case "Write":
      return <WriteContent message={message} />;
    case "Edit":
      return <EditContent message={message} />;
    case "Read":
      return <ReadContent message={message} />;
    case "Grep":
    case "Glob":
      return <SearchContent message={message} />;
    case "TodoWrite":
      return <TodoWriteContent message={message} />;
    case "EnterPlanMode":
      return <EnterPlanModeContent message={message} />;
    case "ExitPlanMode":
      return <ExitPlanModeContent message={message} />;
    case "WebSearch":
      return <WebSearchContent message={message} />;
    case "WebFetch":
      return <WebFetchContent message={message} />;
    case "AskUserQuestion":
      return <AskUserQuestionContent message={message} />;
    case "ToolSearch":
      return <ToolSearchContent message={message} />;
    default:
      // Check for specialized MCP tool renderers
      if (message.toolName && hasMcpRenderer(message.toolName)) {
        const mcpResult = <McpToolContent message={message} />;
        if (mcpResult) return mcpResult;
      }
      return <GenericContent message={message} />;
  }
}
