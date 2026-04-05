import { useEffect, useRef, useMemo, memo } from "react";
import { ChevronRight, AlertCircle } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { UIMessage } from "@/types";
import { getToolIcon, getToolLabel, getToolColor } from "@/components/lib/tool-metadata";
import { formatCompactSummary } from "@/components/lib/tool-formatting";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { TaskTool } from "./tool-renderers/TaskTool";
import { ExpandedToolContent } from "./tool-renderers/ExpandedToolContent";
import { useChatPersistedState } from "@/components/chat-ui-state";
import { ToolGlyph } from "@/components/lib/ToolGlyph";
import {
  CHAT_COLLAPSIBLE_CONTENT_CLASS,
  CHAT_ROW_CLASS,
  CHAT_ROW_WIDTH_CLASS,
} from "@/components/lib/chat-layout";
import { getToolDiffStats } from "@/lib/diff/diff-stats";

// ── Main entry ──

interface ToolCallProps {
  message: UIMessage;
  compact?: boolean;
  autoExpandTools?: boolean;
  expandEditToolCallsByDefault?: boolean;
  showToolIcons?: boolean;
  coloredToolIcons?: boolean;
  disableCollapseAnimation?: boolean;
}

export const ToolCall = memo(function ToolCall({
  message,
  compact,
  autoExpandTools = false,
  expandEditToolCallsByDefault = true,
  showToolIcons = true,
  coloredToolIcons = false,
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
        expandEditToolCallsByDefault={expandEditToolCallsByDefault}
        showToolIcons={showToolIcons}
        coloredToolIcons={coloredToolIcons}
        disableCollapseAnimation={disableCollapseAnimation}
      />
    );

  // compact: skip outer padding wrapper (used inside ToolGroupBlock to avoid double padding)
  if (compact) return content;

  return (
    <div className={`flex justify-start ${CHAT_ROW_CLASS}`}>
      <div className={`${CHAT_ROW_WIDTH_CLASS} ${isWideTool ? "w-full" : ""}`}>
        {content}
      </div>
    </div>
  );
}, (prev, next) =>
  prev.compact === next.compact &&
  prev.autoExpandTools === next.autoExpandTools &&
  prev.expandEditToolCallsByDefault === next.expandEditToolCallsByDefault &&
  prev.showToolIcons === next.showToolIcons &&
  prev.coloredToolIcons === next.coloredToolIcons &&
  prev.disableCollapseAnimation === next.disableCollapseAnimation &&
  prev.message.toolInput === next.message.toolInput &&
  prev.message.toolResult === next.message.toolResult &&
  prev.message.toolError === next.message.toolError &&
  prev.message.subagentSteps === next.message.subagentSteps &&
  prev.message.subagentStatus === next.message.subagentStatus,
);

// ── Regular tool (Read, Write, Edit, Bash, Grep, Glob, etc.) ──

interface RegularToolProps {
  message: UIMessage;
  autoExpandTools: boolean;
  expandEditToolCallsByDefault: boolean;
  showToolIcons: boolean;
  coloredToolIcons: boolean;
  disableCollapseAnimation: boolean;
}

const RegularTool = memo(function RegularTool({
  message,
  autoExpandTools,
  expandEditToolCallsByDefault,
  showToolIcons,
  coloredToolIcons,
  disableCollapseAnimation,
}: RegularToolProps) {
  const isInteractive = message.toolName === "ExitPlanMode" || message.toolName === "AskUserQuestion";
  const isEditToolCall = message.toolName === "Edit" || message.toolName === "Write";
  const defaultExpanded = isEditToolCall && expandEditToolCallsByDefault;
  const skipAutoExpandOnResult = isEditToolCall || isInteractive;
  const isWideTool = message.toolName === "Edit" || message.toolName === "Write" || message.toolName === "NotebookEdit";
  const [expanded, setExpanded, hasStoredExpanded] = useChatPersistedState(
    `tool:${message.id}`,
    defaultExpanded,
  );
  const hasResult = !!message.toolResult;
  const isRunning = !hasResult;
  const isError = !!message.toolError;
  const Icon = getToolIcon(message.toolName ?? "");
  const summary = formatCompactSummary(message);
  const isEditOrWrite = message.toolName === "Edit" || message.toolName === "Write" || message.toolName === "NotebookEdit";
  const diffStats = useMemo(
    () => (isEditOrWrite && hasResult ? getToolDiffStats(message) : null),
    [isEditOrWrite, hasResult, message],
  );

  // Track whether toolResult was present at mount (persisted session → skip auto-expand)
  const initialHadResult = useRef(hasResult);
  // Track whether user manually toggled the collapsible (cancel auto-collapse)
  const userToggled = useRef(false);
  const autoCollapseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-expand on result arrival, then auto-collapse after 2s
  useEffect(() => {
    if (!autoExpandTools) return () => clearTimeout(autoCollapseTimer.current);
    if (!hasResult || initialHadResult.current || skipAutoExpandOnResult || hasStoredExpanded || userToggled.current) return;
    setExpanded(true);
    autoCollapseTimer.current = setTimeout(() => {
      if (!userToggled.current) setExpanded(false);
    }, 2000);
    return () => clearTimeout(autoCollapseTimer.current);
  }, [autoExpandTools, hasResult, hasStoredExpanded, setExpanded, skipAutoExpandOnResult]);

  const handleOpenChange = (open: boolean) => {
    userToggled.current = true;
    clearTimeout(autoCollapseTimer.current);
    setExpanded(open);
  };

  const trigger = (
    <button
      type="button"
      onClick={() => handleOpenChange(!expanded)}
      className="group relative flex w-full items-center gap-2 py-1 text-start text-[13px] leading-4 text-muted-foreground hover:text-foreground transition-colors cursor-pointer overflow-hidden"
      aria-expanded={expanded}
    >
      <div className="relative flex min-w-0 flex-1 items-center gap-[6.4px]">
        {showToolIcons && (isError ? (
          <ToolGlyph Icon={AlertCircle} className="text-red-400/70" />
        ) : (
          <ToolGlyph Icon={Icon} className={coloredToolIcons ? getToolColor(message.toolName ?? "") : "text-foreground/40"} />
        ))}
        {isRunning ? (
          <TextShimmer as="span" className="shrink-0 whitespace-nowrap font-medium" duration={1.8} spread={1.5}>
            {getToolLabel(message.toolName ?? "", "active") ?? message.toolName ?? "Running"}
          </TextShimmer>
        ) : (
          <span className={`shrink-0 whitespace-nowrap font-medium ${isError ? "text-red-400/70" : "text-foreground/60"}`}>
            {isError
              ? `Failed to ${getToolLabel(message.toolName ?? "", "failure")}`
              : (getToolLabel(message.toolName ?? "", "past") ?? message.toolName)}
          </span>
        )}
        <span className="min-w-0 truncate text-foreground/40">{summary}</span>
        {diffStats && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] tabular-nums">
            {diffStats.added > 0 && <span className="text-emerald-400/70">+{diffStats.added}</span>}
            {diffStats.removed > 0 && <span className="text-red-400/70">-{diffStats.removed}</span>}
          </span>
        )}
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
          <div className={`${CHAT_COLLAPSIBLE_CONTENT_CLASS} ${isWideTool ? "w-full min-w-0" : ""}`}>
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
      <CollapsibleContent className={`${CHAT_COLLAPSIBLE_CONTENT_CLASS} ${isWideTool ? "w-full min-w-0" : ""}`}>
        <div className={isWideTool ? "w-full min-w-0" : undefined}>
          <ExpandedToolContent message={message} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}, (prev, next) =>
  prev.autoExpandTools === next.autoExpandTools &&
  prev.expandEditToolCallsByDefault === next.expandEditToolCallsByDefault &&
  prev.showToolIcons === next.showToolIcons &&
  prev.coloredToolIcons === next.coloredToolIcons &&
  prev.disableCollapseAnimation === next.disableCollapseAnimation &&
  prev.message.toolInput === next.message.toolInput &&
  prev.message.toolResult === next.message.toolResult &&
  prev.message.toolError === next.message.toolError,
);
