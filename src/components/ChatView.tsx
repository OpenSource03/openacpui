import { Fragment, useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import { motion } from "motion/react";
import { Minus } from "lucide-react";
import type { InstalledAgent, UIMessage } from "@/types";
import { AgentIcon } from "./AgentIcon";
import { getAgentIcon } from "@/lib/engine-icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./MessageBubble";
import { SummaryBlock } from "./SummaryBlock";
import { ToolCall } from "./ToolCall";
import { ToolGroupBlock } from "./ToolGroupBlock";
import { TurnChangesSummary } from "./TurnChangesSummary";
import { extractTurnSummaries } from "@/lib/turn-changes";
import type { TurnSummary } from "@/lib/turn-changes";
import { computeToolGroups, type ToolGroupInfo } from "@/lib/tool-groups";
import { TextShimmer } from "@/components/ui/text-shimmer";
import {
  BOTTOM_LOCK_THRESHOLD_PX,
  USER_SCROLL_INTENT_WINDOW_MS,
  getTopScrollProgress,
  isWithinBottomLockThreshold,
  shouldUnlockBottomLock,
} from "@/lib/chat-scroll";

const LARGE_CHAT_THRESHOLD = 300;
const SESSION_SWITCH_TAIL_COUNT = 80;
const INITIAL_RENDER_TAIL_COUNT = 180;
const PREPEND_CHUNK_SIZE = 200;
const PREPEND_TRIGGER_PX = 160;
const EMPTY_TOOL_GROUP_INFO: ToolGroupInfo = {
  groups: new Map(),
  groupedIndices: new Set(),
};


interface ChatViewProps {
  messages: UIMessage[];
  isProcessing: boolean;
  showThinking: boolean;
  autoGroupTools: boolean;
  avoidGroupingEdits: boolean;
  autoExpandTools: boolean;
  extraBottomPadding?: boolean;
  scrollToMessageId?: string;
  onScrolledToMessage?: () => void;
  /** Session ID — used to force-scroll to bottom on session switch */
  sessionId?: string;
  /** Called when user clicks "Revert files only" on a user message */
  onRevert?: (checkpointId: string) => void;
  /** Called when user clicks "Revert files + chat" on a user message */
  onFullRevert?: (checkpointId: string) => void;
  /** Reports whether the chat is scrolled away from the top (scrollTop > 4px) */
  onScrolledFromTop?: (scrolled: boolean) => void;
  /** Reports smooth top-scroll transition progress [0..1] for header/fade blending */
  onTopScrollProgress?: (progress: number) => void;
  /** Send this queued user message next (interrupting current turn at safe boundary) */
  onSendQueuedNow?: (messageId: string) => void;
  /** Remove this queued user message without sending it */
  onUnqueueQueuedMessage?: (messageId: string) => void;
  /** Message ID explicitly marked as "send next" by the user */
  sendNextId?: string | null;
  /** Available agents for the engine picker in the empty state */
  agents?: InstalledAgent[];
  /** Currently selected agent */
  selectedAgent?: InstalledAgent | null;
  /** Switch to a different agent/engine */
  onAgentChange?: (agent: InstalledAgent | null) => void;
}

export const ChatView = memo(function ChatView({ messages, isProcessing, showThinking, autoGroupTools, avoidGroupingEdits, autoExpandTools, extraBottomPadding, scrollToMessageId, onScrolledToMessage, sessionId, onRevert, onFullRevert, onScrolledFromTop, onTopScrollProgress, onSendQueuedNow, onUnqueueQueuedMessage, sendNextId, agents, selectedAgent, onAgentChange }: ChatViewProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomLockedRef = useRef(true);
  const userScrollIntentUntilRef = useRef(0);
  const suppressScrollTrackingRef = useRef(0);
  const observedContentHeightRef = useRef(0);
  const observedViewportHeightRef = useRef(0);
  const settleRafRef = useRef<number | null>(null);
  const scrollRafPending = useRef(false);
  // Ref avoids stale closure in the scroll handler
  const onScrolledFromTopRef = useRef(onScrolledFromTop);
  onScrolledFromTopRef.current = onScrolledFromTop;
  const onTopScrollProgressRef = useRef(onTopScrollProgress);
  onTopScrollProgressRef.current = onTopScrollProgress;
  const lastTopProgressRef = useRef(-1);
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const lastSessionIdRef = useRef<string | undefined | null>(sessionId);
  const [visibleStartIndex, setVisibleStartIndex] = useState(() =>
    messages.length > LARGE_CHAT_THRESHOLD
      ? Math.max(0, messages.length - SESSION_SWITCH_TAIL_COUNT)
      : 0,
  );

  const getViewport = useCallback(() => {
    if (viewportRef.current && !viewportRef.current.isConnected) {
      viewportRef.current = null;
    }
    if (!viewportRef.current) {
      viewportRef.current = scrollAreaRef.current?.querySelector<HTMLElement>(
        "[data-radix-scroll-area-viewport]",
      ) ?? null;
    }
    return viewportRef.current;
  }, []);

  const expandRenderedHistory = useCallback((nextStart?: number) => {
    if (visibleStartIndex === 0) return;
    const viewport = getViewport();
    if (viewport) {
      prependAnchorRef.current = {
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      };
    }
    setVisibleStartIndex((prev) => {
      if (prev === 0) return 0;
      return nextStart !== undefined
        ? Math.max(0, Math.min(prev, nextStart))
        : Math.max(0, prev - PREPEND_CHUNK_SIZE);
    });
  }, [getViewport, visibleStartIndex]);

  useEffect(() => {
    const didSessionChange = lastSessionIdRef.current !== sessionId;
    lastSessionIdRef.current = sessionId;

    if (didSessionChange) {
      setVisibleStartIndex(
        messages.length > LARGE_CHAT_THRESHOLD
          ? Math.max(0, messages.length - SESSION_SWITCH_TAIL_COUNT)
          : 0,
      );
      prependAnchorRef.current = null;
      return;
    }

    setVisibleStartIndex((prev) => {
      if (messages.length <= LARGE_CHAT_THRESHOLD) return 0;
      return Math.min(prev, Math.max(0, messages.length - INITIAL_RENDER_TAIL_COUNT));
    });
  }, [messages.length, sessionId]);

  useEffect(() => {
    if (messages.length <= LARGE_CHAT_THRESHOLD) return;
    const targetStart = Math.max(0, messages.length - INITIAL_RENDER_TAIL_COUNT);
    if (visibleStartIndex <= targetStart) return;

    let idleId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const expandToSteadyState = () => {
      expandRenderedHistory(targetStart);
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(expandToSteadyState, { timeout: 500 });
    } else {
      timerId = setTimeout(expandToSteadyState, 120);
    }

    return () => {
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [expandRenderedHistory, messages.length, visibleStartIndex]);

  const publishTopProgress = useCallback((progress: number) => {
    const clamped = Math.max(0, Math.min(1, progress));
    const last = lastTopProgressRef.current;
    if (last < 0 || Math.abs(clamped - last) >= 0.01 || clamped === 0 || clamped === 1) {
      lastTopProgressRef.current = clamped;
      onTopScrollProgressRef.current?.(clamped);
    }
  }, []);

  const syncViewportState = useCallback((viewport: HTMLElement) => {
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    onScrolledFromTopRef.current?.(scrollTop > 4);
    publishTopProgress(getTopScrollProgress(scrollTop));
    return { scrollTop, scrollHeight, clientHeight };
  }, [publishTopProgress]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    if (!anchor) return;

    const viewport = getViewport();
    if (!viewport) return;

    const delta = viewport.scrollHeight - anchor.scrollHeight;
    viewport.scrollTop = anchor.scrollTop + delta;
    syncViewportState(viewport);
    prependAnchorRef.current = null;
  }, [getViewport, syncViewportState, visibleStartIndex]);

  const visibleMessages = useMemo(
    () => visibleStartIndex === 0 ? messages : messages.slice(visibleStartIndex),
    [messages, visibleStartIndex],
  );

  const jumpToBottom = useCallback((opts?: { force?: boolean }) => {
    const shouldForce = opts?.force === true;
    if (!shouldForce && !bottomLockedRef.current) return;

    const viewport = getViewport();
    if (!viewport) return;

    const applyBottom = (targetViewport: HTMLElement) => {
      const targetScrollTop = Math.max(0, targetViewport.scrollHeight - targetViewport.clientHeight);
      if (shouldForce || Math.abs(targetViewport.scrollTop - targetScrollTop) > 1) {
        targetViewport.scrollTop = targetScrollTop;
      }
      syncViewportState(targetViewport);
    };

    suppressScrollTrackingRef.current += 1;
    applyBottom(viewport);
    window.requestAnimationFrame(() => {
      const nextViewport = getViewport();
      if (nextViewport) applyBottom(nextViewport);
      suppressScrollTrackingRef.current = Math.max(0, suppressScrollTrackingRef.current - 1);
    });
  }, [getViewport, syncViewportState]);

  const clearSettleTimers = useCallback(() => {
    if (settleRafRef.current !== null) {
      window.cancelAnimationFrame(settleRafRef.current);
      settleRafRef.current = null;
    }
  }, []);

  const scheduleSettleToBottom = useCallback((opts?: { force?: boolean }) => {
    const shouldForce = opts?.force === true;
    if (!shouldForce && !bottomLockedRef.current) return;
    clearSettleTimers();
    // Single rAF is sufficient — the ResizeObserver handles ongoing content growth
    settleRafRef.current = window.requestAnimationFrame(() => {
      settleRafRef.current = null;
      jumpToBottom({ force: shouldForce });
    });
  }, [clearSettleTimers, jumpToBottom]);

  useEffect(() => {
    scheduleSettleToBottom();
  }, [messages.length, isProcessing, scheduleSettleToBottom]);

  useLayoutEffect(() => {
    if (!sessionId) return;
    bottomLockedRef.current = true;
    userScrollIntentUntilRef.current = 0;
    lastTopProgressRef.current = -1;
    jumpToBottom({ force: true });
  }, [jumpToBottom, sessionId]);

  // Track whether user is near the bottom; this drives sticky auto-follow behavior.
  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    const updateAutoFollow = () => {
      const { scrollTop, scrollHeight, clientHeight } = syncViewportState(viewport);
      // Auto-follow tracking is suppressed during programmatic scrolls to
      // prevent them from unlocking sticky follow mode
      if (suppressScrollTrackingRef.current > 0) {
        if (isWithinBottomLockThreshold({ scrollTop, scrollHeight, clientHeight }, BOTTOM_LOCK_THRESHOLD_PX)) {
          bottomLockedRef.current = true;
        }
        return;
      }

      if (scrollTop <= PREPEND_TRIGGER_PX && visibleStartIndex > 0) {
        expandRenderedHistory();
      }

      const hasRecentUserIntent = Date.now() <= userScrollIntentUntilRef.current;
      if (shouldUnlockBottomLock({
        scrollTop,
        scrollHeight,
        clientHeight,
        hasRecentUserIntent,
        threshold: BOTTOM_LOCK_THRESHOLD_PX,
      })) {
        bottomLockedRef.current = false;
        clearSettleTimers();
        return;
      }

      if (isWithinBottomLockThreshold({ scrollTop, scrollHeight, clientHeight }, BOTTOM_LOCK_THRESHOLD_PX)) {
        bottomLockedRef.current = true;
      }
    };

    const markUserScrollIntent = () => {
      userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_WINDOW_MS;
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp"
        || event.key === "PageUp"
        || event.key === "Home"
        || (event.key === " " && event.shiftKey)
      ) {
        markUserScrollIntent();
      }
    };

    // Throttle scroll handler behind a rAF gate to avoid layout thrashing
    const throttledUpdateAutoFollow = () => {
      if (scrollRafPending.current) return;
      scrollRafPending.current = true;
      window.requestAnimationFrame(() => {
        scrollRafPending.current = false;
        updateAutoFollow();
      });
    };

    updateAutoFollow();
    viewport.addEventListener("wheel", markUserScrollIntent, { passive: true });
    viewport.addEventListener("touchmove", markUserScrollIntent, { passive: true });
    viewport.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
    viewport.addEventListener("keydown", handleKeydown);
    viewport.addEventListener("scroll", throttledUpdateAutoFollow, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", markUserScrollIntent);
      viewport.removeEventListener("touchmove", markUserScrollIntent);
      viewport.removeEventListener("pointerdown", markUserScrollIntent);
      viewport.removeEventListener("keydown", handleKeydown);
      viewport.removeEventListener("scroll", throttledUpdateAutoFollow);
    };
  }, [messages.length, clearSettleTimers, expandRenderedHistory, getViewport, syncViewportState, visibleStartIndex]);

  // Force-scroll to bottom again after session changes so late layout shifts
  // still settle at the bottom even after the immediate layout pass above.
  useEffect(() => {
    if (!sessionId) return;
    bottomLockedRef.current = true;
    userScrollIntentUntilRef.current = 0;
    scheduleSettleToBottom({ force: true });
  }, [sessionId, scheduleSettleToBottom]);

  // ResizeObserver on the scroll viewport + content: catches both content growth
  // and late layout changes that alter the visible viewport height on open.
  useEffect(() => {
    const viewport = getViewport();
    const content = contentRef.current;
    if (!viewport || !content) return;

    observedContentHeightRef.current = content.getBoundingClientRect().height;
    observedViewportHeightRef.current = viewport.clientHeight;

    const observer = new ResizeObserver((entries) => {
      const contentEntry = entries.find((entry) => entry.target === content);
      const viewportEntry = entries.find((entry) => entry.target === viewport);
      const nextHeight = contentEntry?.contentRect.height ?? content.getBoundingClientRect().height;
      const previousHeight = observedContentHeightRef.current;
      const nextViewportHeight = viewportEntry?.contentRect.height ?? viewport.clientHeight;
      const previousViewportHeight = observedViewportHeightRef.current;

      observedContentHeightRef.current = nextHeight;
      observedViewportHeightRef.current = nextViewportHeight;

      const contentHeightChanged = Math.abs(nextHeight - previousHeight) >= 1;
      const viewportHeightChanged = Math.abs(nextViewportHeight - previousViewportHeight) >= 1;
      if (!contentHeightChanged && !viewportHeightChanged) return;
      jumpToBottom();
    });
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [getViewport, jumpToBottom]);

  useEffect(() => clearSettleTimers, [clearSettleTimers]);

  // Scroll to specific message (from search navigation)
  useEffect(() => {
    if (!scrollToMessageId) return;
    const targetIndex = messages.findIndex((msg) => msg.id === scrollToMessageId);
    if (targetIndex >= 0 && targetIndex < visibleStartIndex) {
      expandRenderedHistory(Math.max(0, targetIndex - 24));
      return;
    }
    bottomLockedRef.current = false;
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
  }, [clearSettleTimers, expandRenderedHistory, messages, onScrolledToMessage, scrollToMessageId, visibleStartIndex]);

  // Single-pass partition: split visible messages into non-queued and queued.
  // Short-circuits when no queued messages exist (the common case) to preserve
  // referential equality and avoid downstream useMemo recomputations.
  const { nonQueuedMessages, queuedMessages } = useMemo(() => {
    const hasQueued = visibleMessages.some((m) => m.isQueued);
    if (!hasQueued) {
      return { nonQueuedMessages: visibleMessages, queuedMessages: [] as UIMessage[] };
    }
    const nonQueued: UIMessage[] = [];
    const queued: UIMessage[] = [];
    for (const m of visibleMessages) {
      (m.isQueued ? queued : nonQueued).push(m);
    }
    return { nonQueuedMessages: nonQueued, queuedMessages: queued };
  }, [visibleMessages]);

  // Pre-compute continuation IDs in O(n) forward pass
  const continuationIds = useMemo(() => {
    const ids = new Set<string>();
    let lastRole: string | null = null;
    // Use nonQueuedMessages + queuedMessages directly instead of a separate concat
    const allMessages = queuedMessages.length > 0
      ? [...nonQueuedMessages, ...queuedMessages]
      : nonQueuedMessages;
    for (const msg of allMessages) {
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
  }, [nonQueuedMessages, queuedMessages]);

  // Stable-identity cache for expensive derived computations.
  // During streaming, only the last message's content changes — the message list
  // structure (length + IDs) stays the same. We skip recomputation when the
  // structure hasn't changed since these functions only care about message roles
  // and tool results, not streaming text content.
  const prevMsgStructureRef = useRef<{ length: number; lastId: string | undefined; lastToolResultCount: number }>({ length: 0, lastId: undefined, lastToolResultCount: 0 });
  const cachedTurnSummaryRef = useRef<Map<number, TurnSummary>>(new Map());
  const cachedToolGroupsRef = useRef<ToolGroupInfo>(EMPTY_TOOL_GROUP_INFO);
  const prevIsProcessingRef = useRef(isProcessing);
  const prevAutoGroupRef = useRef(autoGroupTools);
  const prevAvoidEditRef = useRef(avoidGroupingEdits);

  // Check if the message structure actually changed (new messages added, tool results arrived, etc.)
  const msgStructure = useMemo(() => {
    // Count tool results to detect when a tool_call gets its result
    let toolResultCount = 0;
    for (let i = nonQueuedMessages.length - 1; i >= Math.max(0, nonQueuedMessages.length - 10); i--) {
      if (nonQueuedMessages[i].role === "tool_call" && nonQueuedMessages[i].toolResult) toolResultCount++;
    }
    return {
      length: nonQueuedMessages.length,
      lastId: nonQueuedMessages[nonQueuedMessages.length - 1]?.id,
      lastToolResultCount: toolResultCount,
    };
  }, [nonQueuedMessages]);

  const structureChanged =
    msgStructure.length !== prevMsgStructureRef.current.length ||
    msgStructure.lastId !== prevMsgStructureRef.current.lastId ||
    msgStructure.lastToolResultCount !== prevMsgStructureRef.current.lastToolResultCount ||
    isProcessing !== prevIsProcessingRef.current;

  // Pre-compute per-turn change summaries, keyed by the last message index of each turn.
  // Only completed turns with file changes get a summary block rendered after them.
  const turnSummaryByEndIndex = useMemo(() => {
    if (!structureChanged && cachedTurnSummaryRef.current.size >= 0) {
      // Structure unchanged (streaming content update only) — reuse cache
      if (prevMsgStructureRef.current.length > 0) return cachedTurnSummaryRef.current;
    }
    prevMsgStructureRef.current = msgStructure;
    prevIsProcessingRef.current = isProcessing;
    const summaries = extractTurnSummaries(nonQueuedMessages, isProcessing);
    const map = new Map<number, TurnSummary>();
    for (const s of summaries) {
      map.set(s.endMessageIndex, s);
    }
    cachedTurnSummaryRef.current = map;
    return map;
  }, [nonQueuedMessages, isProcessing, structureChanged, msgStructure]);

  // Pre-compute tool groups when enabled: contiguous tool_call sequences between
  // assistant text messages, also absorbing any in-between thinking-only rows.
  const { groups: toolGroups, groupedIndices } = useMemo(() => {
    if (!autoGroupTools) return EMPTY_TOOL_GROUP_INFO;
    const settingsChanged = autoGroupTools !== prevAutoGroupRef.current || avoidGroupingEdits !== prevAvoidEditRef.current;
    prevAutoGroupRef.current = autoGroupTools;
    prevAvoidEditRef.current = avoidGroupingEdits;
    if (!structureChanged && !settingsChanged && cachedToolGroupsRef.current !== EMPTY_TOOL_GROUP_INFO) {
      return cachedToolGroupsRef.current;
    }
    const result = computeToolGroups(nonQueuedMessages, isProcessing, avoidGroupingEdits);
    cachedToolGroupsRef.current = result;
    return result;
  }, [autoGroupTools, avoidGroupingEdits, nonQueuedMessages, isProcessing, structureChanged]);

  // Finalized group keys (first tool message ID), used to detect newly formed groups.
  const finalizedGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const group of toolGroups.values()) {
      if (group.isFinalized && group.tools.length > 0) {
        keys.add(group.tools[0].id);
      }
    }
    return keys;
  }, [toolGroups]);

  // Track group animation per viewed session.
  // A group only morphs if this view previously rendered its first tool_call
  // as a standalone message before the assistant finalized the group.
  const knownGroupKeysRef = useRef<Set<string>>(new Set());
  const seenUngroupedToolKeysRef = useRef<Set<string>>(new Set());
  const trackedSessionIdRef = useRef<string | undefined | null>(null);

  if (trackedSessionIdRef.current !== sessionId) {
    trackedSessionIdRef.current = sessionId;
    knownGroupKeysRef.current = new Set();
    seenUngroupedToolKeysRef.current = new Set();
  }

  const visibleUngroupedToolKeys = useMemo(() => {
    const keys = new Set<string>();
    nonQueuedMessages.forEach((msg, index) => {
      if (msg.role !== "tool_call") return;
      const group = toolGroups.get(index);
      if (group?.isFinalized || groupedIndices.has(index)) return;
      keys.add(msg.id);
    });
    return keys;
  }, [groupedIndices, nonQueuedMessages, toolGroups]);

  // Groups finalized in this render animate only if this view previously showed
  // their first tool as an individual tool_call before grouping.
  const animatingGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const key of finalizedGroupKeys) {
      if (
        !knownGroupKeysRef.current.has(key) &&
        seenUngroupedToolKeysRef.current.has(key)
      ) {
        keys.add(key);
      }
    }
    return keys;
  }, [finalizedGroupKeys]);

  // Record standalone tool_calls after commit so a later finalization can morph once.
  useEffect(() => {
    if (visibleUngroupedToolKeys.size === 0) return;
    const seen = seenUngroupedToolKeysRef.current;
    for (const key of visibleUngroupedToolKeys) {
      seen.add(key);
    }
  }, [visibleUngroupedToolKeys]);

  // Mark finalized groups as known after commit so they never re-animate.
  useEffect(() => {
    const known = knownGroupKeysRef.current;
    for (const key of finalizedGroupKeys) {
      known.add(key);
    }
  }, [finalizedGroupKeys]);

  // Memoized processing indicator check — avoids O(n) .some() scan inside JSX on every render
  const showProcessingIndicator = useMemo(() => {
    if (!isProcessing) return false;
    return !nonQueuedMessages.some((m) =>
      (m.role === "assistant" && m.isStreaming && (m.content || m.thinking)) ||
      (m.role === "tool_call" && !m.toolResult),
    );
  }, [isProcessing, nonQueuedMessages]);

  if (messages.length === 0) {
    const showAgentPicker = agents && agents.length > 1 && onAgentChange;

    return (
      <div className="flex flex-1 items-center justify-center">
        <motion.div
          className="flex flex-col items-center gap-5"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 0.68, 0, 1] }}
        >
          <div className="flex flex-col items-center gap-3">
            <h2
              className="text-3xl italic text-foreground/20"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
            >
              Send a message to start
            </h2>
            <p
              className="text-sm italic text-muted-foreground/30"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
            >
              Your conversation will appear here
            </p>
          </div>

          {showAgentPicker && (
            <motion.div
              className="flex items-center gap-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4, ease: [0.22, 0.68, 0, 1] }}
            >
              {agents.map((agent) => {
                const isSelected = agent.engine === "claude"
                  ? selectedAgent == null || selectedAgent.engine === "claude"
                  : selectedAgent?.id === agent.id;

                return (
                  <button
                    key={agent.id}
                    title={agent.name}
                    onClick={() => onAgentChange(agent.engine === "claude" ? null : agent)}
                    className={`rounded-full p-2 transition-all ${
                      isSelected
                        ? "bg-foreground/[0.06] ring-1 ring-foreground/[0.08] scale-110"
                        : "opacity-30 hover:opacity-60 hover:scale-105"
                    }`}
                  >
                    <AgentIcon
                      icon={getAgentIcon(agent)}
                      size={20}
                    />
                  </button>
                );
              })}
            </motion.div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
      <div ref={contentRef} className={`pt-14 ${extraBottomPadding ? "pb-[280px]" : "pb-36"}`}>
        {visibleStartIndex > 0 && (
          <div className="sticky top-14 z-[6] flex justify-center px-4 pb-2">
            <button
              type="button"
              className="rounded-full border border-border/50 bg-background/90 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground"
              onClick={() => expandRenderedHistory()}
            >
              Load {Math.min(PREPEND_CHUNK_SIZE, visibleStartIndex)} earlier messages
            </button>
          </div>
        )}
        {nonQueuedMessages.map((msg, index) => {
          // Determine the turn summary to render after this message (if any)
          const turnSummary = turnSummaryByEndIndex.get(index);

          if (msg.role === "tool_call") {
            // Check if this tool_call is part of a finalized group
            const group = toolGroups.get(index);
            if (group && group.isFinalized) {
              // This is the start of a finalized group — render ToolGroupBlock
              const groupKey = group.tools[0].id;
              const isNewGroup = animatingGroupKeys.has(groupKey);

              // Collect any turn summaries that fall within this group's range
              let groupTurnSummary: TurnSummary | undefined;
              for (let gi = group.startIndex; gi <= group.endIndex; gi++) {
                const ts = turnSummaryByEndIndex.get(gi);
                if (ts) groupTurnSummary = ts;
              }

              return (
                <Fragment key={`group-${groupKey}`}>
                  <ToolGroupBlock
                    tools={group.tools}
                    messages={group.messages}
                    showThinking={showThinking}
                    autoExpandTools={autoExpandTools}
                    animate={isNewGroup}
                  />
                  {groupTurnSummary && (
                    <TurnChangesSummary summary={groupTurnSummary} />
                  )}
                </Fragment>
              );
            }
            if (groupedIndices.has(index)) {
              // This tool_call is inside a finalized group but not the start — skip
              return null;
            }
            // Not in a finalized group — render individually (Feature 1 auto-collapse applies)
            return (
              <Fragment key={msg.id}>
                <div data-message-id={msg.id} className="message-item"><ToolCall message={msg} autoExpandTools={autoExpandTools} /></div>
                {turnSummary && (
                  <TurnChangesSummary summary={turnSummary} />
                )}
              </Fragment>
            );
          }
          if (groupedIndices.has(index)) return null;
          if (msg.role === "tool_result") return null;
          if (msg.role === "summary") {
            return (
              <Fragment key={msg.id}>
                <div data-message-id={msg.id} className="message-item"><SummaryBlock message={msg} /></div>
                {turnSummary && (
                  <TurnChangesSummary summary={turnSummary} />
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
                  onSendQueuedNow={onSendQueuedNow}
                  onUnqueueQueued={onUnqueueQueuedMessage}
                />
              </div>
              {turnSummary && (
                <TurnChangesSummary summary={turnSummary} />
              )}
            </Fragment>
          );
        })}
        {/* Session-level processing indicator: shows while model is working but not outputting text or running tools */}
        {showProcessingIndicator && (
          <div className="flex justify-start px-4 py-1.5">
            <div className="flex items-center gap-1.5 text-xs">
              <Minus className="h-3 w-3 text-foreground/40" />
              <TextShimmer as="span" className="italic opacity-60" duration={1.8} spread={1.5}>
                Planning next moves
              </TextShimmer>
            </div>
          </div>
        )}
        {queuedMessages.map((msg) => (
          <div key={msg.id} data-message-id={msg.id} className="message-item">
            <MessageBubble
              message={msg}
              isSendNextQueued={sendNextId === msg.id}
              showThinking={showThinking}
              isContinuation={continuationIds.has(msg.id)}
              onRevert={onRevert}
              onFullRevert={onFullRevert}
              onSendQueuedNow={onSendQueuedNow}
              onUnqueueQueued={onUnqueueQueuedMessage}
            />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
});
