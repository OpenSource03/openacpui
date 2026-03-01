import { useState } from "react";
import { Map, ChevronsUpDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "@/types";
import { extractResultText } from "@/components/lib/tool-formatting";
import { GenericContent } from "./GenericContent";

const REMARK_PLUGINS = [remarkGfm];

// ── EnterPlanMode: subtle mode-transition indicator ──

export function EnterPlanModeContent({ message }: { message: UIMessage }) {
  const resultText = message.toolResult ? extractResultText(message.toolResult) : "";

  return (
    <div className="rounded-md bg-foreground/[0.03] px-3 py-2 text-xs text-foreground/50">
      {resultText || "Exploring codebase and designing implementation approach."}
    </div>
  );
}

// ── ExitPlanMode: rendered plan markdown ──

const PLAN_COLLAPSED_HEIGHT = 400; // px — enough for a good preview before requiring expand

export function ExitPlanModeContent({ message }: { message: UIMessage }) {
  const [expanded, setExpanded] = useState(false);
  const plan = String(message.toolInput?.plan ?? "");
  const filePath = String(message.toolInput?.filePath ?? "");
  const fileName = filePath ? filePath.split("/").pop() : null;
  const isLong = plan.length > 2000;

  if (!plan) return <GenericContent message={message} />;

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      {/* Header bar with plan file name */}
      {fileName && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-foreground/[0.04] border-b border-border/40">
          <Map className="h-3 w-3 text-foreground/40" />
          <span className="text-[11px] text-foreground/50 font-mono truncate">{fileName}</span>
        </div>
      )}

      {/* Plan content — rendered as markdown */}
      <div
        className="relative"
        style={
          !expanded && isLong
            ? { maxHeight: PLAN_COLLAPSED_HEIGHT, overflow: "hidden" }
            : undefined
        }
      >
        <div className="px-4 py-3 prose dark:prose-invert prose-sm max-w-none text-foreground/80 text-[12.5px]">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{plan}</ReactMarkdown>
        </div>
        {/* Fade overlay when collapsed and content is long */}
        {!expanded && isLong && (
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        )}
      </div>

      {/* Expand/collapse toggle for long plans */}
      {isLong && (
        <div className="border-t border-border/40 px-3 py-1.5">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-medium text-foreground/40 hover:text-foreground/70 transition-colors"
          >
            <ChevronsUpDown className="h-3 w-3" />
            {expanded ? "Collapse" : "Show full plan"}
          </button>
        </div>
      )}
    </div>
  );
}
