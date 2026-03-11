import { Minus } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState, useRef, useEffect, useCallback } from "react";
import { TextShimmer } from "@/components/ui/text-shimmer";

interface ThinkingBlockProps {
  thinking: string;
  isStreaming?: boolean;
  thinkingComplete?: boolean;
}

interface AnimatedChunk {
  id: number;
  text: string;
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

export function ThinkingBlock({ thinking, isStreaming, thinkingComplete }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // Tracks whether user manually scrolled up in the inner thinking div
  const userScrolledRef = useRef(false);
  const isThinking = isStreaming && !thinkingComplete && thinking.length > 0;

  // Render thinking as stable prefix + appended animated chunks.
  // This keeps earlier chunk animations running even when new chunks arrive.
  const prevThinkingRef = useRef(thinking);
  const nextChunkIdRef = useRef(0);
  const [baseText, setBaseText] = useState(thinking);
  const [animatedChunks, setAnimatedChunks] = useState<AnimatedChunk[]>([]);

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
    const prev = prevThinkingRef.current;
    const curr = thinking;
    prevThinkingRef.current = curr;

    if (!isThinking) {
      setBaseText(curr);
      setAnimatedChunks([]);
      return;
    }

    if (!prev || !curr) {
      setBaseText(curr);
      setAnimatedChunks([]);
      return;
    }

    const prefixLen = commonPrefixLength(prev, curr);
    const appendedLen = curr.length - prefixLen;
    if (appendedLen <= 0) {
      setBaseText(curr);
      setAnimatedChunks([]);
      return;
    }

    // If upstream rewrites existing text, reset to avoid animating old regions.
    const changedInMiddle = prefixLen < prev.length;
    if (changedInMiddle) {
      setBaseText(curr);
      setAnimatedChunks([]);
      return;
    }

    const appended = curr.slice(prev.length);
    if (!appended) return;

    setAnimatedChunks((chunks) => [
      ...chunks,
      { id: nextChunkIdRef.current++, text: appended },
    ]);
  }, [thinking, isThinking]);

  // Coalesce completed animation chunks back into baseText every 500ms
  // to keep the animated <span> count bounded (~20-30 max)
  useEffect(() => {
    if (!isThinking) return;

    const COALESCE_INTERVAL = 500;
    const ANIMATION_DURATION = 400; // chunks older than this are "done"

    // Track when each chunk was added
    const chunkTimestamps = new Map<number, number>();

    const interval = setInterval(() => {
      const now = Date.now();

      setAnimatedChunks((chunks) => {
        if (chunks.length === 0) return chunks;

        // Record timestamps for new chunks
        for (const chunk of chunks) {
          if (!chunkTimestamps.has(chunk.id)) {
            chunkTimestamps.set(chunk.id, now);
          }
        }

        // Find the last completed chunk index
        let lastCompleted = -1;
        for (let i = 0; i < chunks.length; i++) {
          const ts = chunkTimestamps.get(chunks[i].id) ?? now;
          if (now - ts >= ANIMATION_DURATION) {
            lastCompleted = i;
          } else {
            break; // chunks are in order, so stop at first incomplete
          }
        }

        if (lastCompleted < 0) return chunks;

        // Merge completed chunks into baseText
        const completedText = chunks
          .slice(0, lastCompleted + 1)
          .map((c) => c.text)
          .join("");

        // Clean up timestamps for merged chunks
        for (let i = 0; i <= lastCompleted; i++) {
          chunkTimestamps.delete(chunks[i].id);
        }

        setBaseText((prev) => prev + completedText);
        return chunks.slice(lastCompleted + 1);
      });
    }, COALESCE_INTERVAL);

    return () => {
      clearInterval(interval);
      chunkTimestamps.clear();
    };
  }, [isThinking]);

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
            {baseText}
            {animatedChunks.map((chunk) => (
              <span key={chunk.id} className="stream-chunk-enter">{chunk.text}</span>
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
