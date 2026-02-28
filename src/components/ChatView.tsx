import { Fragment, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { Minus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { UIMessage } from "@/types";
import { MessageBubble } from "./MessageBubble";
import { SummaryBlock } from "./SummaryBlock";
import { ToolCall } from "./ToolCall";
import { TurnChangesSummary } from "./TurnChangesSummary";
import { extractTurnSummaries } from "@/lib/turn-changes";
import type { TurnSummary } from "@/lib/turn-changes";
import { TextShimmer } from "@/components/ui/text-shimmer";

interface ChatViewProps {
  messages: UIMessage[];
  isProcessing: boolean;
  showThinking: boolean;
  extraBottomPadding?: boolean;
  scrollToMessageId?: string;
  onScrolledToMessage?: () => void;
  /** Session ID — used to force-scroll to bottom on session switch */
  sessionId?: string;
  /** Called when user clicks "Revert files only" on a user message */
  onRevert?: (checkpointId: string) => void;
  /** Called when user clicks "Revert files + chat" on a user message */
  onFullRevert?: (checkpointId: string) => void;
  /** Called when user clicks "View changes" on an inline turn summary */
  onViewTurnChanges?: (turnIndex: number) => void;
  /** Reports whether the chat is scrolled away from the top (scrollTop > 4px) */
  onScrolledFromTop?: (scrolled: boolean) => void;
  /** Reports smooth top-scroll transition progress [0..1] for header/fade blending */
  onTopScrollProgress?: (progress: number) => void;
}

export const ChatView = memo(function ChatView({ messages, isProcessing, showThinking, extraBottomPadding, scrollToMessageId, onScrolledToMessage, sessionId, onRevert, onFullRevert, onViewTurnChanges, onScrolledFromTop, onTopScrollProgress }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef(0);
  const forceAutoScrollUntilRef = useRef(0);
  const autoFollowRef = useRef(true);
  const suppressScrollTrackingRef = useRef(0);
  const settleTimersRef = useRef<number[]>([]);
  // Ref avoids stale closure in the scroll handler
  const onScrolledFromTopRef = useRef(onScrolledFromTop);
  onScrolledFromTopRef.current = onScrolledFromTop;
  const onTopScrollProgressRef = useRef(onTopScrollProgress);
  onTopScrollProgressRef.current = onTopScrollProgress;
  const topProgressRafRef = useRef<number | null>(null);
  const pendingTopProgressRef = useRef(0);
  const lastTopProgressRef = useRef(-1);

  // Throttled auto-scroll: instant during streaming.
  // Keeps following while user is pinned to bottom; unlocks only after manual upward scroll.
  // During session switch, temporarily force auto-follow so long-chat reflow
  // (content-visibility / async block expansion) still settles at the true bottom.
  const scrollToBottom = useCallback((opts?: { force?: boolean }) => {
    const shouldForce = opts?.force || Date.now() < forceAutoScrollUntilRef.current;
    const now = Date.now();
    if (!shouldForce && now - scrollTimerRef.current < 250) return; // throttle ~4/sec
    scrollTimerRef.current = now;

    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;

    if (!shouldForce && !autoFollowRef.current) return;

    suppressScrollTrackingRef.current += 1;
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
    if (shouldForce) {
      viewport.scrollTop = viewport.scrollHeight;
    }
    window.requestAnimationFrame(() => {
      suppressScrollTrackingRef.current = Math.max(0, suppressScrollTrackingRef.current - 1);
    });
  }, []);

  const clearSettleTimers = useCallback(() => {
    for (const timer of settleTimersRef.current) {
      clearTimeout(timer);
    }
    settleTimersRef.current = [];
  }, []);

  const scheduleSettleToBottom = useCallback(() => {
    clearSettleTimers();
    // Re-attempt over ~1.2s to catch delayed layout growth in long/running sessions.
    const delays = [0, 32, 96, 180, 320, 520, 800, 1200];
    for (const delay of delays) {
      const timer = window.setTimeout(() => {
        scrollToBottom({ force: true });
      }, delay);
      settleTimersRef.current.push(timer);
    }
  }, [clearSettleTimers, scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Track whether user is near the bottom; this drives sticky auto-follow behavior.
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;

    const flushTopProgress = () => {
      topProgressRafRef.current = null;
      const progress = pendingTopProgressRef.current;
      const last = lastTopProgressRef.current;
      if (last < 0 || Math.abs(progress - last) >= 0.01 || progress === 0 || progress === 1) {
        lastTopProgressRef.current = progress;
        onTopScrollProgressRef.current?.(progress);
      }
    };

    const updateAutoFollow = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      // Always report scroll-from-top state (controls header shadow visibility)
      onScrolledFromTopRef.current?.(scrollTop > 4);
      // Smooth top ramp: slower range + smoothstep easing to avoid abrupt header/fade jumps.
      const normalized = Math.max(0, Math.min(1, scrollTop / 96));
      const easedProgress = normalized * normalized * (3 - 2 * normalized);
      pendingTopProgressRef.current = easedProgress;
      if (topProgressRafRef.current === null) {
        topProgressRafRef.current = window.requestAnimationFrame(flushTopProgress);
      }
      // Auto-follow tracking is suppressed during programmatic scrolls to
      // prevent them from unlocking sticky follow mode
      if (suppressScrollTrackingRef.current > 0) return;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      autoFollowRef.current = distanceFromBottom < 40;
    };

    updateAutoFollow();
    viewport.addEventListener("scroll", updateAutoFollow, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", updateAutoFollow);
      if (topProgressRafRef.current !== null) {
        window.cancelAnimationFrame(topProgressRafRef.current);
        topProgressRafRef.current = null;
      }
    };
  }, [messages.length]);

  // Force-scroll to bottom on session switch, bypassing the proximity guard
  useEffect(() => {
    if (!sessionId) return;
    scrollTimerRef.current = 0;
    autoFollowRef.current = true;
    forceAutoScrollUntilRef.current = Date.now() + 1800;
    scheduleSettleToBottom();
  }, [sessionId, scheduleSettleToBottom]);

  // ResizeObserver on scroll content: catches height changes from collapsible
  // expansion (ThinkingBlock, tool details, etc.) that don't trigger a messages update
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    const content = viewport?.firstElementChild;
    if (!content) return;

    const observer = new ResizeObserver(() => {
      scrollToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  useEffect(() => clearSettleTimers, [clearSettleTimers]);

  // Scroll to specific message (from search navigation)
  useEffect(() => {
    if (!scrollToMessageId) return;
    forceAutoScrollUntilRef.current = 0;
    autoFollowRef.current = false;
    clearSettleTimers();
    const el = scrollAreaRef.current?.querySelector(`[data-message-id="${scrollToMessageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Flash highlight
      el.classList.add("search-highlight");
      const timer = setTimeout(() => {
        el.classList.remove("search-highlight");
        onScrolledToMessage?.();
      }, 1500);
      return () => clearTimeout(timer);
    }
    // If element not found yet (messages still loading), try again
    const retry = setTimeout(() => {
      const retryEl = scrollAreaRef.current?.querySelector(`[data-message-id="${scrollToMessageId}"]`);
      if (retryEl) {
        retryEl.scrollIntoView({ behavior: "smooth", block: "center" });
        retryEl.classList.add("search-highlight");
        setTimeout(() => {
          retryEl.classList.remove("search-highlight");
          onScrolledToMessage?.();
        }, 1500);
      } else {
        onScrolledToMessage?.();
      }
    }, 500);
    return () => clearTimeout(retry);
  }, [scrollToMessageId, onScrolledToMessage, clearSettleTimers]);

  // Pre-compute continuation IDs in O(n) forward pass
  const continuationIds = useMemo(() => {
    const ids = new Set<string>();
    let lastRole: string | null = null;
    for (const msg of messages) {
      if (msg.role === "assistant") {
        if (lastRole === "assistant" || lastRole === "tool_call" || lastRole === "tool_result" || lastRole === "system" || lastRole === "summary") {
          ids.add(msg.id);
        }
        lastRole = "assistant";
      } else if (msg.role === "user") {
        lastRole = "user";
      } else {
        // tool_call, tool_result, system, summary: don't reset assistant chain
        if (lastRole !== null) {
          lastRole = lastRole === "user" ? "user" : lastRole;
        }
      }
    }
    return ids;
  }, [messages]);

  // Pre-compute per-turn change summaries, keyed by the last message index of each turn.
  // Only completed turns with file changes get a summary block rendered after them.
  const turnSummaryByEndIndex = useMemo(() => {
    const summaries = extractTurnSummaries(messages, isProcessing);
    const map = new Map<number, TurnSummary>();
    for (const s of summaries) {
      map.set(s.endMessageIndex, s);
    }
    return map;
  }, [messages, isProcessing]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-lg">Send a message to start</p>
          <p className="mt-1 text-sm text-muted-foreground/60">
            Your conversation will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
      <div className={`pt-14 ${extraBottomPadding ? "pb-56" : "pb-36"}`}>
        {messages.map((msg, index) => {
          // Determine the turn summary to render after this message (if any)
          const turnSummary = turnSummaryByEndIndex.get(index);

          if (msg.role === "tool_call") {
            return (
              <Fragment key={msg.id}>
                <div data-message-id={msg.id} className="message-item"><ToolCall message={msg} /></div>
                {turnSummary && (
                  <TurnChangesSummary summary={turnSummary} onViewInPanel={onViewTurnChanges} />
                )}
              </Fragment>
            );
          }
          if (msg.role === "tool_result") return null;
          if (msg.role === "summary") {
            return (
              <Fragment key={msg.id}>
                <div data-message-id={msg.id} className="message-item"><SummaryBlock message={msg} /></div>
                {turnSummary && (
                  <TurnChangesSummary summary={turnSummary} onViewInPanel={onViewTurnChanges} />
                )}
              </Fragment>
            );
          }

          return (
            <Fragment key={msg.id}>
              <div data-message-id={msg.id} className="message-item">
                <MessageBubble
                  message={msg}
                  showThinking={showThinking}
                  isContinuation={continuationIds.has(msg.id)}
                  onRevert={onRevert}
                  onFullRevert={onFullRevert}
                />
              </div>
              {turnSummary && (
                <TurnChangesSummary summary={turnSummary} onViewInPanel={onViewTurnChanges} />
              )}
            </Fragment>
          );
        })}
        {/* Session-level processing indicator: shows while model is working but not outputting text or running tools */}
        {isProcessing && !messages.some((m) =>
          (m.role === "assistant" && m.isStreaming && (m.content || m.thinking)) ||
          (m.role === "tool_call" && !m.toolResult)
        ) && (
          <div className="flex justify-start px-4 py-1.5">
            <div className="flex items-center gap-1.5 text-xs">
              <Minus className="h-3 w-3 text-foreground/40" />
              <TextShimmer as="span" className="italic opacity-60" duration={1.8} spread={1.5}>
                Planning next moves
              </TextShimmer>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
});
