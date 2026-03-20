import { useEffect, useState } from "react";
import {
  Loader2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToolCall } from "@/components/ToolCall";
import { AgentIcon } from "@/components/AgentIcon";
import { ENGINE_ICONS } from "@/lib/engine-icons";
import { reportError } from "@/lib/analytics";
import type { UIMessage } from "@/types";

const CLAUDE_ICON = ENGINE_ICONS["claude"];
const REMARK_PLUGINS = [remarkGfm];

interface AgentTranscriptViewerProps {
  outputFile: string;
  agentDescription: string;
  onClose: () => void;
}

// ── JSONL entry shapes ──

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

interface TranscriptEntry {
  type: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
    stop_reason?: string | null;
  };
  [key: string]: unknown;
}

// ── Flattened display item ──

type DisplayItem =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; message: UIMessage };

/**
 * Modal dialog displaying the full JSONL transcript of a background agent.
 * Parses tool_use/tool_result pairs into UIMessage objects and renders them
 * using the same ToolCall component as the main chat — full BashContent,
 * ReadContent, EditContent, etc.
 */
export function AgentTranscriptViewer({ outputFile, agentDescription, onClose }: AgentTranscriptViewerProps) {
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.claude.readAgentOutput(outputFile);
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
        } else {
          const entries = (result.messages ?? []) as TranscriptEntry[];
          setItems(buildDisplayItems(entries));
        }
      } catch (err) {
        if (cancelled) return;
        const msg = reportError("TRANSCRIPT_LOAD", err);
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [outputFile]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl h-[70vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/50 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AgentIcon icon={CLAUDE_ICON} size={16} className="opacity-60" />
            Agent Transcript — {agentDescription}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="py-3 space-y-1">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-foreground/40">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading transcript…
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 px-5 py-4 text-sm text-red-400/70">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {!loading && !error && items.length === 0 && (
              <div className="py-8 text-center text-sm text-foreground/40">
                No transcript data available.
              </div>
            )}

            {items.map((item, i) => (
              <TranscriptItem key={i} item={item} />
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ── Render each display item ──

function TranscriptItem({ item }: { item: DisplayItem }) {
  switch (item.kind) {
    case "text":
      return <TextRow text={item.text} />;
    case "thinking":
      return <ThinkingRow text={item.text} />;
    case "tool":
      return (
        <div className="px-4 py-0.5">
          <ToolCall message={item.message} compact autoExpandTools={false} />
        </div>
      );
  }
}

function TextRow({ text }: { text: string }) {
  return (
    <div className="flex gap-2.5 px-5 py-1">
      <AgentIcon icon={CLAUDE_ICON} size={14} className="mt-1 shrink-0 opacity-50" />
      <div className="min-w-0 flex-1 prose dark:prose-invert prose-xs max-w-none text-[12px] text-foreground/70 wrap-break-word
        [&_p]:my-1 [&_p]:leading-relaxed
        [&_pre]:my-1 [&_pre]:rounded [&_pre]:bg-foreground/[0.04] [&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:text-[11px]
        [&_code]:text-[11px] [&_code]:text-foreground/60
        [&_ul]:my-1 [&_ul]:ps-4 [&_ol]:my-1 [&_ol]:ps-4
        [&_li]:my-0 [&_li]:text-[12px]
        [&_strong]:text-foreground/80">
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{text}</ReactMarkdown>
      </div>
    </div>
  );
}

function ThinkingRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.slice(0, 80) + (text.length > 80 ? "…" : "");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center gap-1.5 px-5 py-0.5 text-[11px] text-foreground/30 cursor-pointer hover:text-foreground/50 transition-colors">
          <ChevronRight className={`h-2.5 w-2.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="italic truncate">Thinking: {preview}</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mx-5 ms-9 px-2 py-1.5 text-[11px] text-foreground/35 italic whitespace-pre-wrap wrap-break-word border-s border-foreground/10">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Parse JSONL into display items ──

/**
 * Walks JSONL entries and builds display items:
 * - Text blocks → { kind: "text" }
 * - Thinking blocks → { kind: "thinking" }
 * - tool_use + matching tool_result → { kind: "tool", message: UIMessage }
 *
 * Tool pairing: first pass collects all tool_result blocks into a Map keyed
 * by tool_use_id, then tool_use blocks look up their result to build a
 * complete UIMessage that the ToolCall component can render with full fidelity.
 */
function buildDisplayItems(entries: TranscriptEntry[]): DisplayItem[] {
  // First pass: collect all tool_result blocks keyed by tool_use_id
  const resultMap = new Map<string, { content: unknown; isError: boolean }>();
  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_result" && block.tool_use_id) {
        const resultContent = typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? block.content
                .filter((b): b is ContentBlock => b?.type === "text" && typeof b.text === "string")
                .map((b) => b.text)
                .join("\n")
            : "";
        resultMap.set(block.tool_use_id, {
          content: resultContent,
          isError: !!block.is_error,
        });
      }
    }
  }

  // Second pass: build display items
  const items: DisplayItem[] = [];
  let toolCounter = 0;

  for (const entry of entries) {
    if (entry.type === "system" || entry.type === "result" || entry.type === "progress") continue;

    const content = entry.message?.content;
    if (!content) continue;

    // String content (simple user text, usually tool results — skip, they're paired)
    if (typeof content === "string") {
      // Only show non-tool-result user text
      if (entry.message?.role === "user" && !content.includes("tool_use_id")) {
        if (content.trim()) items.push({ kind: "text", text: content });
      }
      continue;
    }

    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || typeof block !== "object") continue;

      switch (block.type) {
        case "text":
          if (block.text?.trim()) {
            items.push({ kind: "text", text: block.text });
          }
          break;

        case "thinking":
          if (block.thinking?.trim()) {
            items.push({ kind: "thinking", text: block.thinking });
          }
          break;

        case "tool_use": {
          // Pair with result via tool_use_id
          const result = block.id ? resultMap.get(block.id) : undefined;
          const toolMsg: UIMessage = {
            id: `transcript-tool-${toolCounter++}`,
            role: "tool_call",
            content: "",
            toolName: block.name ?? "Tool",
            toolInput: (block.input ?? {}) as Record<string, unknown>,
            toolResult: result?.content ?? undefined,
            toolError: result?.isError ?? false,
            timestamp: Date.now(),
          };
          items.push({ kind: "tool", message: toolMsg });
          break;
        }

        // tool_result blocks are consumed via resultMap pairing, skip here
        case "tool_result":
          break;
      }
    }
  }

  return items;
}
