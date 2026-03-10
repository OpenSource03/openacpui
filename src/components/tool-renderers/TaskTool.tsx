import { useState, useMemo } from "react";
import {
  Bot,
  ChevronRight,
  AlertCircle,
  ChevronsUpDown,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage, SubagentToolStep } from "@/types";
import { getToolIcon, getToolLabel } from "@/components/lib/tool-metadata";
import {
  formatTaskTitle,
  formatTaskRunningTitle,
  formatTaskSummary,
  formatLatestStep,
  formatStepSummary,
  formatDuration,
  formatTaskResult,
} from "@/components/lib/tool-formatting";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { ExpandedToolContent } from "./ExpandedToolContent";

const REMARK_PLUGINS = [remarkGfm];

/** Convert a SubagentToolStep to a UIMessage for standard tool renderers. */
function stepToUIMessage(step: SubagentToolStep): UIMessage {
  return {
    id: step.toolUseId,
    role: "tool_call",
    content: "",
    toolName: step.toolName,
    toolInput: step.toolInput,
    toolResult: step.toolResult,
    toolError: step.toolError,
    timestamp: 0,
  };
}

export function TaskTool({ message }: { message: UIMessage }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = message.subagentStatus === "running";
  const isCompleted = message.subagentStatus === "completed";
  const hasSteps = message.subagentSteps && message.subagentSteps.length > 0;
  const stepCount = message.subagentSteps?.length ?? 0;
  const showCard = isRunning || expanded;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className={showCard
        ? "rounded-lg border border-foreground/10 bg-foreground/[0.025] overflow-hidden"
        : ""
      }>
        <CollapsibleTrigger className={`group relative flex w-full items-center gap-2.5 text-[13px] hover:text-foreground transition-colors cursor-pointer overflow-hidden ${
          showCard ? "px-3.5 py-2" : "py-1"
        }`}>

          <div className="relative flex items-center gap-2.5 min-w-0 flex-1">
            {showCard && (
              <ChevronRight
                className={`h-3 w-3 shrink-0 text-foreground/25 transition-transform duration-200 ${
                  expanded ? "rotate-90" : ""
                }`}
              />
            )}

            {/* Icon with subtle pill background */}
            <div className={`flex items-center justify-center shrink-0 size-5 rounded-md ${
              isRunning
                ? "bg-foreground/[0.08] text-foreground/50"
                : "bg-foreground/[0.05] text-foreground/35"
            }`}>
              <Bot className="h-3 w-3" />
            </div>

            {/* Title */}
            {isCompleted && !expanded ? (
              <>
                <span className="shrink-0 font-medium text-foreground/75">Used agent</span>
                <span className="truncate text-foreground/40">{formatTaskSummary(message)}</span>
              </>
            ) : isRunning ? (
              <TextShimmer as="span" className="font-medium truncate" duration={1.8} spread={1.5}>
                {formatTaskRunningTitle(message)}
              </TextShimmer>
            ) : (
              <span className="font-medium truncate text-foreground/75">
                {formatTaskTitle(message)}
              </span>
            )}

            {/* Step count badge */}
            {stepCount > 0 && (
              <span className="shrink-0 inline-flex items-center rounded-full bg-foreground/[0.06] px-1.5 py-px text-[10px] font-medium text-foreground/40 tabular-nums">
                {stepCount} step{stepCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Duration pill */}
          {message.subagentDurationMs != null && (
            <span className="inline-flex items-center rounded-full bg-foreground/[0.04] px-1.5 py-px text-[10px] text-foreground/30 tabular-nums shrink-0">
              {formatDuration(message.subagentDurationMs)}
            </span>
          )}

          {isCompleted && !expanded && (
            <ChevronRight
              className="ms-auto h-3 w-3 shrink-0 text-foreground/30 opacity-0 group-hover:opacity-100 transition-all duration-200"
            />
          )}
        </CollapsibleTrigger>

        {/* Live step indicator when collapsed & running */}
        {isRunning && !expanded && hasSteps && (
          <div className="border-t border-foreground/[0.08] px-3.5 ps-12 py-1.5 text-xs text-foreground/35">
            <span className="animate-pulse">{formatLatestStep(message.subagentSteps!)}</span>
          </div>
        )}

        <CollapsibleContent>
          <TaskExpandedContent message={message} />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function TaskExpandedContent({ message }: { message: UIMessage }) {
  return (
    <>
      {/* Prompt */}
      {message.toolInput && (
        <div className="border-t border-foreground/[0.08] px-3.5 py-2.5">
          <p className="mb-1.5 text-[10px] font-semibold text-foreground/35 uppercase tracking-widest">
            Prompt
          </p>
          <div className="border-s-2 border-foreground/[0.08] ps-3">
            <p className="max-h-20 overflow-auto text-xs text-foreground/55 whitespace-pre-wrap wrap-break-word leading-relaxed">
              {String(message.toolInput.prompt ?? message.toolInput.description ?? "")}
            </p>
          </div>
        </div>
      )}

      {/* Steps — each step uses standard tool renderers when expanded */}
      {message.subagentSteps && message.subagentSteps.length > 0 && (
        <div className="border-t border-foreground/[0.08] px-3.5 py-2.5">
          <p className="mb-2 text-[10px] font-semibold text-foreground/35 uppercase tracking-widest">
            Steps
          </p>
          <div className="space-y-0.5">
            {message.subagentSteps.map((step) => (
              <SubagentStepRow key={step.toolUseId} step={step} />
            ))}
          </div>
        </div>
      )}

      {/* Result */}
      {message.subagentStatus === "completed" && message.toolResult?.content && (
        <TaskResultBlock content={message.toolResult.content} />
      )}
    </>
  );
}

// ── Result block ──

const TASK_RESULT_COLLAPSED_HEIGHT = 320;

function TaskResultBlock({ content }: { content: string | Array<{ type: string; text: string }> }) {
  const [expanded, setExpanded] = useState(false);
  const formatted = formatTaskResult(content);
  const isLong = formatted.length > 2000;

  return (
    <div className="border-t border-foreground/[0.08] px-3.5 py-2.5">
      <p className="mb-1.5 text-[10px] font-semibold text-foreground/35 uppercase tracking-widest">
        Result
      </p>
      <div
        className="relative"
        style={
          !expanded && isLong
            ? { maxHeight: TASK_RESULT_COLLAPSED_HEIGHT, overflow: "hidden" }
            : undefined
        }
      >
        <div className="prose dark:prose-invert prose-sm max-w-none text-foreground/80">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
            {formatted}
          </ReactMarkdown>
        </div>
        {!expanded && isLong && (
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        )}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-foreground/40 hover:text-foreground/70 transition-colors"
        >
          <ChevronsUpDown className="h-3 w-3" />
          {expanded ? "Collapse" : "Show full result"}
        </button>
      )}
    </div>
  );
}

// ── Step row — uses standard tool renderers when expanded ──

function SubagentStepRow({ step }: { step: SubagentToolStep }) {
  const [open, setOpen] = useState(false);
  const hasResult = !!step.toolResult;
  const isError = !!step.toolError;
  const Icon = getToolIcon(step.toolName);

  // Convert step to a UIMessage so standard tool renderers can render it
  const pseudoMessage = useMemo(() => stepToUIMessage(step), [step]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 py-0.5 text-xs hover:text-foreground transition-colors">
        {isError ? (
          <AlertCircle className="h-3 w-3 shrink-0 text-red-400/70" />
        ) : (
          <Icon className="h-3 w-3 shrink-0 text-foreground/35" />
        )}
        {!hasResult && !isError ? (
          <TextShimmer as="span" duration={1.8} spread={1.5}>
            {getToolLabel(step.toolName, "active") ?? step.toolName}
          </TextShimmer>
        ) : (
          <span className={isError ? "text-red-400/70" : "text-foreground/75"}>
            {isError
              ? `Failed to ${getToolLabel(step.toolName, "failure")}`
              : (getToolLabel(step.toolName, "past") ?? step.toolName)}
          </span>
        )}
        <span className="truncate text-foreground/40 ms-0.5">
          {formatStepSummary(step)}
        </span>
        {hasResult && (
          <ChevronRight
            className={`ms-auto h-2.5 w-2.5 shrink-0 text-foreground/30 opacity-0 group-hover:opacity-100 transition-all duration-200 ${
              open ? "rotate-90" : ""
            }`}
          />
        )}
      </CollapsibleTrigger>
      {hasResult && (
        <CollapsibleContent>
          <div className="ms-4 mt-1 mb-1.5">
            <ExpandedToolContent message={pseudoMessage} />
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
