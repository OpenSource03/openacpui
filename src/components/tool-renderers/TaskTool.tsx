import { useState } from "react";
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
import { getToolIcon } from "@/components/lib/tool-metadata";
import { getToolLabel } from "@/components/lib/tool-metadata";
import {
  formatTaskTitle,
  formatTaskRunningTitle,
  formatTaskSummary,
  formatLatestStep,
  formatStepSummary,
  formatDuration,
  formatTaskResult,
  formatInput,
  formatResult,
} from "@/components/lib/tool-formatting";
import { TextShimmer } from "@/components/ui/text-shimmer";

const REMARK_PLUGINS = [remarkGfm];

export function TaskTool({ message }: { message: UIMessage }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = message.subagentStatus === "running";
  const isCompleted = message.subagentStatus === "completed";
  const hasSteps = message.subagentSteps && message.subagentSteps.length > 0;
  const stepCount = message.subagentSteps?.length ?? 0;
  const showCard = isRunning || expanded;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className={showCard ? "rounded-md border border-foreground/[0.06] overflow-hidden" : ""}>
        <CollapsibleTrigger className={`group relative flex w-full items-center gap-2 text-[13px] hover:text-foreground transition-colors cursor-pointer overflow-hidden ${
          showCard ? "px-3 py-1.5" : "py-1"
        }`}>

          <div className="relative flex items-center gap-2 min-w-0 flex-1">
            {showCard && (
              <ChevronRight
                className={`h-3 w-3 shrink-0 text-foreground/30 transition-transform duration-200 ${
                  expanded ? "rotate-90" : ""
                }`}
              />
            )}
            <Bot className="h-3.5 w-3.5 shrink-0 text-foreground/35" />
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
            {stepCount > 0 && (
              <span className="shrink-0 text-foreground/40 text-xs">
                ({stepCount} step{stepCount !== 1 ? "s" : ""})
              </span>
            )}
          </div>

          {message.subagentDurationMs != null && (
            <span className="relative text-[11px] text-foreground/30 tabular-nums shrink-0">
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
          <div className="border-t border-foreground/[0.06] px-3 ps-8 py-1 text-xs text-foreground/30">
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
        <div className="ps-5 py-1.5">
          <p className="mb-1 text-[10px] font-medium text-foreground/30 uppercase tracking-wider">
            Prompt
          </p>
          <p className="max-h-20 overflow-auto text-xs text-foreground/60 whitespace-pre-wrap wrap-break-word">
            {String(message.toolInput.prompt ?? message.toolInput.description ?? "")}
          </p>
        </div>
      )}

      {/* Steps */}
      {message.subagentSteps && message.subagentSteps.length > 0 && (
        <div className="border-t border-foreground/[0.06] ps-5 py-1.5">
          <p className="mb-1.5 text-[10px] font-medium text-foreground/30 uppercase tracking-wider">
            Steps
          </p>
          <div>
            {message.subagentSteps.map((step) => (
              <SubagentStepRow key={step.toolUseId} step={step} />
            ))}
          </div>
        </div>
      )}

      {/* Result — rendered as markdown */}
      {message.subagentStatus === "completed" && message.toolResult?.content && (
        <TaskResultBlock content={message.toolResult.content} />
      )}
    </>
  );
}

/** Scrollable + expandable result block for Task/agent tool output */
const TASK_RESULT_COLLAPSED_HEIGHT = 320; // px — ~20 lines of prose before requiring expand

function TaskResultBlock({ content }: { content: string | Array<{ type: string; text: string }> }) {
  const [expanded, setExpanded] = useState(false);
  const formatted = formatTaskResult(content);
  const isLong = formatted.length > 2000; // heuristic: content likely exceeds collapsed height

  return (
    <div className="border-t border-foreground/[0.06] ps-5 py-1.5">
      <p className="mb-1 text-[10px] font-medium text-foreground/30 uppercase tracking-wider">
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
        <div className="prose dark:prose-invert prose-sm max-w-none text-foreground">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
            {formatted}
          </ReactMarkdown>
        </div>
        {/* Fade overlay when collapsed and content is long */}
        {!expanded && isLong && (
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        )}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex items-center gap-1 text-[10px] font-medium text-foreground/40 hover:text-foreground/70 transition-colors"
        >
          <ChevronsUpDown className="h-3 w-3" />
          {expanded ? "Collapse" : "Show full result"}
        </button>
      )}
    </div>
  );
}

function SubagentStepRow({ step }: { step: SubagentToolStep }) {
  const [open, setOpen] = useState(false);
  const hasResult = !!step.toolResult;
  const isError = !!step.toolError;
  const Icon = getToolIcon(step.toolName);

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
      <CollapsibleContent>
        <div className="ms-5 mt-0.5 mb-1 border-s border-foreground/10 ps-2.5 text-[11px]">
          <pre className="max-h-32 overflow-auto text-foreground/40 whitespace-pre-wrap wrap-break-word">
            {formatInput(step.toolInput)}
          </pre>
          {step.toolResult && (
            <>
              <div className="my-0.5 text-[10px] font-medium text-foreground/30 uppercase tracking-wider">
                Result
              </div>
              <pre className="max-h-32 overflow-auto text-foreground/40 whitespace-pre-wrap wrap-break-word">
                {formatResult(step.toolResult)}
              </pre>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
