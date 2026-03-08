import { memo, useState, useEffect, useLayoutEffect, useRef, useMemo, type CSSProperties } from "react";
import { Layers, ChevronRight, AlertCircle } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { UIMessage } from "@/types";
import { ToolCall } from "./ToolCall";
import { ThinkingBlock } from "./ThinkingBlock";
import { getToolLabel, getToolIcon } from "@/components/lib/tool-metadata";
import { formatCompactSummary } from "@/components/lib/tool-formatting";

interface ToolGroupBlockProps {
  tools: UIMessage[];
  messages: UIMessage[];
  showThinking?: boolean;
  /** When true (live streaming), runs a one-time tools -> group morph animation.
   *  When false (restored session), renders collapsed immediately. */
  animate: boolean;
}

const GROUP_HEADER_BASE_CLASS = "flex w-full items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-1.5 text-start text-[13px] text-muted-foreground";
const MORPH_BASE_MS = 640;
const MORPH_STAGGER_MS = 32;

function ToolGroupHeaderContent({
  count,
  toolSummary,
  isOpen,
}: {
  count: number;
  toolSummary: string;
  isOpen: boolean;
}) {
  return (
    <>
      <Layers className="h-3.5 w-3.5 shrink-0 text-foreground/35" />

      <span className="flex-1 min-w-0 truncate">
        <span className="font-medium text-foreground/75">
          {count} tool{count !== 1 ? "s" : ""}
        </span>
        <span className="ms-1.5 text-foreground/40">{toolSummary}</span>
      </span>

      <ChevronRight
        className={`h-3 w-3 shrink-0 text-foreground/30 transition-transform duration-200 ${
          isOpen ? "rotate-90" : ""
        }`}
      />
    </>
  );
}

export const ToolGroupBlock = memo(function ToolGroupBlock({
  tools,
  messages,
  showThinking = true,
  animate,
}: ToolGroupBlockProps) {
  // Lock animation decision at mount. Parent re-renders may flip `animate` to false
  // after first paint; we still want one morph animation for newly formed groups.
  const animateOnMount = useRef(animate).current;

  // Final grouped state is always collapsed by default.
  const [isOpen, setIsOpen] = useState(false);
  const [isMorphing, setIsMorphing] = useState(animateOnMount);
  const [morphStarted, setMorphStarted] = useState(false);
  const [morphHeight, setMorphHeight] = useState<number | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);

  const morphDurationMs = useMemo(
    () => MORPH_BASE_MS + Math.min(6, Math.max(0, tools.length - 1)) * MORPH_STAGGER_MS,
    [tools.length],
  );

  useEffect(() => {
    if (!isMorphing) {
      setMorphStarted(false);
      setMorphHeight(null);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIsMorphing(false);
    }
  }, [isMorphing]);

  useLayoutEffect(() => {
    if (!isMorphing) return;

    const shellEl = shellRef.current;
    const headerEl = headerRef.current;
    const toolsEl = toolsRef.current;
    if (!shellEl || !headerEl || !toolsEl) {
      setIsMorphing(false);
      return;
    }

    setMorphStarted(false);
    const startHeight = Math.max(toolsEl.offsetHeight, 1);
    const endHeight = Math.max(headerEl.offsetHeight, 1);
    setMorphHeight(startHeight);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setIsMorphing(false);
      setMorphStarted(false);
      setMorphHeight(null);
    };

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === shellEl && event.propertyName === "height") {
        finish();
      }
    };
    shellEl.addEventListener("transitionend", onTransitionEnd);

    const raf = window.requestAnimationFrame(() => {
      setMorphStarted(true);
      setMorphHeight(endHeight);
    });

    const fallbackTimer = window.setTimeout(finish, morphDurationMs + 180);

    return () => {
      shellEl.removeEventListener("transitionend", onTransitionEnd);
      window.cancelAnimationFrame(raf);
      clearTimeout(fallbackTimer);
    };
  }, [isMorphing, morphDurationMs]);

  // Build compact tool summary: "Read, Edit, Bash" or "Read, Edit, Bash +2 more"
  const toolSummary = useMemo(() => {
    const labels = tools.map(
      (t) => getToolLabel(t.toolName ?? "", "past") ?? t.toolName ?? "Tool",
    );
    if (labels.length <= 3) return labels.join(", ");
    return `${labels.slice(0, 3).join(", ")} +${labels.length - 3} more`;
  }, [tools]);

  const count = tools.length;
  const morphRows = useMemo(() => {
    return tools.map((tool) => {
      const toolName = tool.toolName ?? "";
      const isError = !!tool.toolError;
      const isRunning = !tool.toolResult && !isError;
      const Icon = isError ? AlertCircle : getToolIcon(toolName);
      const label = isError
        ? `Failed to ${getToolLabel(toolName, "failure") ?? "run tool"}`
        : ((getToolLabel(toolName, isRunning ? "active" : "past") ?? toolName) || (isRunning ? "Running" : "Tool"));
      const summary = formatCompactSummary(tool);
      return { id: tool.id, Icon, label, summary, isError };
    });
  }, [tools]);

  const groupedRows = useMemo(() => {
    return messages.filter((message) => {
      if (message.role === "tool_call") return true;
      return showThinking && message.role === "assistant" && !!message.thinking && !message.content;
    });
  }, [messages, showThinking]);

  if (isMorphing) {
    const shellStyle: CSSProperties = {
      "--tool-group-morph-duration": `${morphDurationMs}ms`,
    } as CSSProperties;
    if (morphHeight !== null) shellStyle.height = `${morphHeight}px`;

    return (
      <div className="px-4 py-0.5">
        <div className="min-w-0 max-w-[85%]">
          <div
            ref={shellRef}
            className="tool-group-morph-shell"
            style={shellStyle}
          >
            <div
              ref={headerRef}
              className={`tool-group-morph-header ${morphStarted ? "tool-group-morph-header-in" : ""}`}
            >
              <div className={GROUP_HEADER_BASE_CLASS}>
                <ToolGroupHeaderContent count={count} toolSummary={toolSummary} isOpen={false} />
              </div>
            </div>

            <div
              ref={toolsRef}
              className={`tool-group-morph-tools ${morphStarted ? "tool-group-morph-tools-out" : ""}`}
            >
              <div className="tool-group-morph-rows">
                {morphRows.map((row, index) => (
                  <div
                    key={row.id}
                    className={`tool-group-morph-row ${morphStarted ? "tool-group-morph-row-out" : ""}`}
                    style={{ "--tool-row-index": index } as CSSProperties}
                  >
                    <row.Icon className={`h-3.5 w-3.5 shrink-0 ${row.isError ? "text-red-400/70" : "text-foreground/35"}`} />
                    <span className={`shrink-0 whitespace-nowrap font-medium ${row.isError ? "text-red-400/70" : "text-foreground/75"}`}>
                      {row.label}
                    </span>
                    <span className="truncate text-foreground/40">{row.summary}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-0.5">
      <div className="min-w-0 max-w-[85%]">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          {/* Group header — collapsed by default; user controls open/close. */}
          <CollapsibleTrigger
            className={`group ${GROUP_HEADER_BASE_CLASS} cursor-pointer transition-colors hover:bg-muted/50`}
          >
            <ToolGroupHeaderContent count={count} toolSummary={toolSummary} isOpen={isOpen} />
          </CollapsibleTrigger>

          {/* Tool content — collapses via Radix animate-collapsible-up.
              Uses tool-group-collapse for a slower, smoother animation than default. */}
          <CollapsibleContent className="tool-group-collapse">
            <div className="mt-0.5">
              {groupedRows.map((message) => (
                message.role === "tool_call" ? (
                  <ToolCall key={message.id} message={message} compact />
                ) : (
                  <div key={message.id} className="py-1">
                    <ThinkingBlock
                      thinking={message.thinking ?? ""}
                      isStreaming={message.isStreaming}
                      thinkingComplete={message.thinkingComplete}
                    />
                  </div>
                )
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.tools === next.tools &&
  prev.messages === next.messages &&
  prev.showThinking === next.showThinking &&
  prev.animate === next.animate,
);
