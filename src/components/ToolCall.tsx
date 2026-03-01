import { useState, memo } from "react";
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

// ── Main entry ──

export const ToolCall = memo(function ToolCall({ message }: { message: UIMessage }) {
  const isTask = message.toolName === "Task" || message.toolName === "Agent";

  return (
    <div className="flex justify-start px-4 py-0.5">
      <div className="min-w-0 max-w-[85%]">
        {isTask ? (
          <TaskTool message={message} />
        ) : (
          <RegularTool message={message} />
        )}
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
  const isEditLike = message.toolName === "Edit" || message.toolName === "Write" || message.toolName === "ExitPlanMode" || message.toolName === "AskUserQuestion";
  const [expanded, setExpanded] = useState(isEditLike);
  const hasResult = !!message.toolResult;
  const isRunning = !hasResult;
  const isError = !!message.toolError;
  const Icon = getToolIcon(message.toolName ?? "");
  const summary = formatCompactSummary(message);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
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
    default:
      // Check for specialized MCP tool renderers
      if (message.toolName && hasMcpRenderer(message.toolName)) {
        const mcpResult = <McpToolContent message={message} />;
        if (mcpResult) return mcpResult;
      }
      return <GenericContent message={message} />;
  }
}
