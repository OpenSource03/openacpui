import { memo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ContextUsage } from "@/types";

// ── Token formatting helpers ──

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function getContextColor(percent: number): string {
  if (percent >= 80) return "text-red-600 dark:text-red-400";
  if (percent >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground/60";
}

function getContextStrokeColor(percent: number): string {
  if (percent >= 80) return "stroke-red-600 dark:stroke-red-400";
  if (percent >= 60) return "stroke-amber-600 dark:stroke-amber-400";
  return "stroke-foreground/40";
}

export interface ContextGaugeProps {
  contextUsage: ContextUsage;
  isCompacting: boolean;
  isProcessing: boolean;
  onCompact: () => void;
}

/** SVG ring gauge showing context window usage with a tooltip breakdown. */
export const ContextGauge = memo(function ContextGauge({
  contextUsage,
  isCompacting,
  isProcessing,
  onCompact,
}: ContextGaugeProps) {
  if (contextUsage.contextWindow <= 0) return null;

  const totalInput =
    contextUsage.inputTokens +
    contextUsage.cacheReadTokens +
    contextUsage.cacheCreationTokens;
  const percent = Math.min(100, (totalInput / contextUsage.contextWindow) * 100);
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (percent / 100) * circumference;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            if (!isProcessing) onCompact();
          }}
          className={`inline-flex shrink-0 cursor-pointer rounded-full hover:opacity-80 ${isProcessing ? "opacity-40 cursor-default" : ""} ${getContextColor(percent)}`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            className={isCompacting ? "animate-spin" : "-rotate-90"}
          >
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              className="stroke-muted-foreground/20 dark:stroke-muted/30"
              strokeWidth="2.5"
            />
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              className={
                isCompacting ? "stroke-foreground/60" : getContextStrokeColor(percent)
              }
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={isCompacting ? circumference * 0.7 : dashOffset}
            />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        <div className="space-y-1.5 text-xs">
          <div className="font-medium">
            {isCompacting ? "Compacting..." : `Context: ${percent.toFixed(1)}%`}
          </div>
          <div className="space-y-0.5 opacity-70">
            <div className="flex justify-between gap-4">
              <span>Input tokens</span>
              <span className="font-mono">
                {formatTokenCount(contextUsage.inputTokens)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Cache read</span>
              <span className="font-mono">
                {formatTokenCount(contextUsage.cacheReadTokens)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Cache creation</span>
              <span className="font-mono">
                {formatTokenCount(contextUsage.cacheCreationTokens)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Output tokens</span>
              <span className="font-mono">
                {formatTokenCount(contextUsage.outputTokens)}
              </span>
            </div>
          </div>
          <div className="flex justify-between gap-4 border-t border-background/20 pt-1">
            <span>Total / Window</span>
            <span className="font-mono">
              {formatTokenCount(totalInput)} /{" "}
              {formatTokenCount(contextUsage.contextWindow)}
            </span>
          </div>
          <div className="border-t border-background/20 pt-1.5 opacity-50">
            Click to compact context
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
});
