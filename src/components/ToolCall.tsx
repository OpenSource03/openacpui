import { useEffect, useRef, memo } from "react";
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
import { TextShimmer } from "@/components/ui/text-shimmer";
import { TaskTool } from "./tool-renderers/TaskTool";
import { ExpandedToolContent } from "./tool-renderers/ExpandedToolContent";
import { useChatPersistedState } from "@/components/chat-ui-state";

// ── Main entry ──

interface ToolCallProps {
  message: UIMessage;
  compact?: boolean;
  autoExpandTools?: boolean;
  disableCollapseAnimation?: boolean;
}

export const ToolCall = memo(function ToolCall({
  message,
  compact,
  autoExpandTools = false,
  disableCollapseAnimation = false,
}: ToolCallProps) {
  const normalizedToolName = (message.toolName ?? "").toLowerCase();
  const isTask = normalizedToolName === "task" || normalizedToolName === "agent";
  const isWideTool = normalizedToolName === "edit" || normalizedToolName === "write" || normalizedToolName === "notebookedit";
  const content = isTask
    ? <TaskTool message={message} />
    : (
      <RegularTool
        message={message}
        autoExpandTools={autoExpandTools}
        disableCollapseAnimation={disableCollapseAnimation}
      />
    );

  // compact: skip outer padding wrapper (used inside ToolGroupBlock to avoid double padding)
  if (compact) return content;

  return (
    <div className="flex justify-start px-4 py-0.5">
      <div className={`min-w-0 max-w-[85%] ${isWideTool ? "w-full" : ""}`}>
        {content}
      </div>
    </div>
  );
}, (prev, next) =>
  prev.compact === next.compact &&
  prev.autoExpandTools === next.autoExpandTools &&
  prev.disableCollapseAnimation === next.disableCollapseAnimation &&
  prev.message.toolInput === next.message.toolInput &&
  prev.message.toolResult === next.message.toolResult &&
  prev.message.toolError === next.message.toolError &&
  prev.message.subagentSteps === next.message.subagentSteps &&
  prev.message.subagentStatus === next.message.subagentStatus,
);

// ── Regular tool (Read, Write, Edit, Bash, Grep, Glob, etc.) ──

function RegularTool({
  message,
  autoExpandTools,
  disableCollapseAnimation,
}: {
  message: UIMessage;
  autoExpandTools: boolean;
  disableCollapseAnimation: boolean;
}) {
  const isInteractive = message.toolName === "ExitPlanMode" || message.toolName === "AskUserQuestion";
  const isEditLike = message.toolName === "Edit" || message.toolName === "Write" || isInteractive;
  const isWideTool = message.toolName === "Edit" || message.toolName === "Write" || message.toolName === "NotebookEdit";
  const [expanded, setExpanded, hasStoredExpanded] = useChatPersistedState(
    `tool:${message.id}`,
    isEditLike,
  );
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
    if (!autoExpandTools) return () => clearTimeout(autoCollapseTimer.current);
    if (!hasResult || initialHadResult.current || isEditLike || hasStoredExpanded || userToggled.current) return;
    setExpanded(true);
    autoCollapseTimer.current = setTimeout(() => {
      if (!userToggled.current) setExpanded(false);
    }, 2000);
    return () => clearTimeout(autoCollapseTimer.current);
  }, [autoExpandTools, hasResult, hasStoredExpanded, isEditLike, setExpanded]);

  const handleOpenChange = (open: boolean) => {
    userToggled.current = true;
    clearTimeout(autoCollapseTimer.current);
    setExpanded(open);
  };

  const trigger = (
    <button
      type="button"
      onClick={() => handleOpenChange(!expanded)}
      className="group relative flex w-full items-center gap-2 py-1 text-[13px] hover:text-foreground transition-colors cursor-pointer overflow-hidden"
      aria-expanded={expanded}
    >
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
    </button>
  );

  // Fast path: conditional rendering — collapsed tools render ZERO heavy content.
  // Radix Collapsible is only used when collapse animation is needed (AgentTranscriptViewer).
  if (disableCollapseAnimation) {
    return (
      <div className={isWideTool ? "block w-full min-w-0" : undefined}>
        {trigger}
        {expanded && (
          <div className={`mt-1 mb-2 ${isWideTool ? "w-full min-w-0" : ""}`}>
            <ExpandedToolContent message={message} />
          </div>
        )}
      </div>
    );
  }

  return (
    <Collapsible
      open={expanded}
      onOpenChange={handleOpenChange}
      className={isWideTool ? "block w-full min-w-0" : undefined}
    >
      <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger>
      <CollapsibleContent className={isWideTool ? "w-full min-w-0" : undefined}>
        <div className={`mt-1 mb-2 ${isWideTool ? "w-full min-w-0" : ""}`}>
          <ExpandedToolContent message={message} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
