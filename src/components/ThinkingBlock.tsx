import { Minus } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState, useRef, useEffect, useCallback } from "react";
import { TextShimmer } from "@/components/ui/text-shimmer";
import {
  advanceThinkingAnimationState,
  createThinkingAnimationState,
} from "@/lib/thinking-animation";

interface ThinkingBlockProps {
  thinking: string;
  isStreaming?: boolean;
  thinkingComplete?: boolean;
}

export function ThinkingBlock({ thinking, isStreaming, thinkingComplete }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // Tracks whether user manually scrolled up in the inner thinking div
  const userScrolledRef = useRef(false);
  const isThinking = isStreaming && !thinkingComplete && thinking.length > 0;

  // Keep the animation state simple and append-only. The v0.19.0 coalescing
  // timer introduced replay/duplication under rapid thinking updates.
  const [animationState, setAnimationState] = useState(() =>
    createThinkingAnimationState(thinking),
  );

  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 40;
    userScrolledRef.current = !isNearBottom;
  }, []);

  // Auto-scroll inner thinking div as content streams in (unless user scrolled up)
  useEffect(() => {
    if (!open || userScrolledRef.current) return;
    const el = contentRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [thinking, open]);

  useEffect(() => {
    setAnimationState((prev) =>
      advanceThinkingAnimationState(prev, thinking, isThinking),
    );
  }, [thinking, isThinking]);

  const handleOpenChange = useCallback((isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      userScrolledRef.current = false;
      // Scroll inner div to bottom after collapsible content renders
      requestAnimationFrame(() => {
        const el = contentRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, []);

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger className="flex items-center gap-1.5 py-1 text-xs text-foreground/40 hover:text-foreground/70 transition-colors">
        <Minus className={`h-3 w-3 ${isThinking ? "text-foreground/40" : "text-foreground/30"}`} />
        {isThinking ? (
          <TextShimmer as="span" className="italic opacity-60" duration={1.8} spread={1.5}>
            Thinking...
          </TextShimmer>
        ) : (
          <span className="italic text-foreground/40">Thought</span>
        )}
      </CollapsibleTrigger>
      {/* Only render expandable content when there's actual thinking text */}
      {thinking.length > 0 && (
        <CollapsibleContent>
          <div
            ref={contentRef}
            onScroll={handleScroll}
            className="mt-1 mb-2 max-h-60 overflow-auto border-s-2 border-foreground/10 ps-3 py-1 text-xs text-foreground/40 whitespace-pre-wrap"
          >
            {animationState.baseText}
            {animationState.animatedChunks.map((chunk) => (
              <span key={chunk.id} className="stream-chunk-enter">{chunk.text}</span>
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
