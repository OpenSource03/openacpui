import { Fragment, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from "react";
import { motion } from "motion/react";
import { Minus } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { InstalledAgent, UIMessage } from "@/types";
import { AgentIcon } from "./AgentIcon";
import { getAgentIcon } from "@/lib/engine-icons";
import { MessageBubble } from "./MessageBubble";
import { SummaryBlock } from "./SummaryBlock";
import { ToolCall } from "./ToolCall";
import { ToolGroupBlock } from "./ToolGroupBlock";
import { TurnChangesSummary } from "./TurnChangesSummary";
import { extractTurnSummaries } from "@/lib/turn-changes";
import type { TurnSummary } from "@/lib/turn-changes";
import { computeToolGroups, type ToolGroup, type ToolGroupInfo } from "@/lib/tool-groups";
import { TextShimmer } from "@/components/ui/text-shimmer";
import {
  BOTTOM_LOCK_THRESHOLD_PX,
  USER_SCROLL_INTENT_WINDOW_MS,
  getTopScrollProgress,
  isWithinBottomLockThreshold,
  shouldUnlockBottomLock,
} from "@/lib/chat-scroll";
import { CHAT_CONTENT_RESIZED_EVENT } from "@/lib/events";

// ── Row model ──

type RowDescriptor =
  | { kind: "message"; msg: UIMessage; originalIndex: number }
  | { kind: "tool_group"; group: ToolGroup; originalIndex: number; groupTurnSummary?: TurnSummary }
  | { kind: "turn_summary"; summary: TurnSummary }
  | { kind: "processing" };

const EMPTY_TOOL_GROUP_INFO: ToolGroupInfo = {
  groups: new Map(),
  groupedIndices: new Set(),
};

// ── Module-level pure functions (rerender-no-inline-components, rendering-hoist-jsx) ──

function buildRows(
  messages: UIMessage[],
  toolGroups: Map<number, ToolGroup>,
  groupedIndices: Set<number>,
  turnSummaryByEndIndex: Map<number, TurnSummary>,
  showProcessingIndicator: boolean,
): RowDescriptor[] {
  const rows: RowDescriptor[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "tool_call") {
      const group = toolGroups.get(i);
      if (group?.isFinalized) {
        // Collect turn summaries inside the group range
        let groupTurnSummary: TurnSummary | undefined;
        for (let gi = group.startIndex; gi <= group.endIndex; gi++) {
          const ts = turnSummaryByEndIndex.get(gi);
          if (ts) groupTurnSummary = ts;
        }
        rows.push({ kind: "tool_group", group, originalIndex: i, groupTurnSummary });
        continue;
      }
      if (groupedIndices.has(i)) continue;
      rows.push({ kind: "message", msg, originalIndex: i });
    } else if (msg.role === "tool_result") {
      continue;
    } else if (groupedIndices.has(i)) {
      continue;
    } else {
      rows.push({ kind: "message", msg, originalIndex: i });
    }

    // Append turn summary after this row if applicable
    const turnSummary = turnSummaryByEndIndex.get(i);
    if (turnSummary) {
      rows.push({ kind: "turn_summary", summary: turnSummary });
    }
  }

  if (showProcessingIndicator) {
    rows.push({ kind: "processing" });
  }

  return rows;
}

function estimateRowHeight(row: RowDescriptor): number {
  if (row.kind === "processing") return 40;
  if (row.kind === "turn_summary") return 52;
  if (row.kind === "tool_group") return 44;
  const msg = row.msg;
  if (msg.role === "system") return 32;
  if (msg.role === "summary") return 52;
  if (msg.role === "tool_call") return 44;
  if (msg.role === "user") return Math.max(48, Math.min(200, Math.ceil((msg.content?.length ?? 0) / 60) * 24));
  // assistant: estimate based on content length
  const lines = Math.ceil((msg.content?.length ?? 0) / 80);
  return Math.max(40, Math.min(600, lines * 22));
}

function getRowKey(row: RowDescriptor): string {
  if (row.kind === "processing") return "__processing__";
  if (row.kind === "turn_summary") return `ts-${row.summary.userMessageId}`;
  if (row.kind === "tool_group") return `group-${row.group.tools[0].id}`;
  return row.msg.id;
}

// ── ChatMessageRow (module-level, memo with custom comparator) ──

interface ChatMessageRowProps {
  row: RowDescriptor;
  showThinking: boolean;
  autoExpandTools: boolean;
  animatingGroupKeys: Set<string>;
  continuationIds: Set<string>;
  onRevert?: (checkpointId: string) => void;
  onFullRevert?: (checkpointId: string) => void;
  onSendQueuedNow?: (messageId: string) => void;
  onUnqueueQueuedMessage?: (messageId: string) => void;
}

const ChatMessageRow = memo(function ChatMessageRow({
  row,
  showThinking,
  autoExpandTools,
  animatingGroupKeys,
  continuationIds,
  onRevert,
  onFullRevert,
  onSendQueuedNow,
  onUnqueueQueuedMessage,
}: ChatMessageRowProps) {
  if (row.kind === "processing") {
    return (
      <div className="flex justify-start px-4 py-1.5">
        <div className="flex items-center gap-1.5 text-xs">
          <Minus className="h-3 w-3 text-foreground/40" />
          <TextShimmer as="span" className="italic opacity-60" duration={1.8} spread={1.5}>
            Planning next moves
          </TextShimmer>
        </div>
      </div>
    );
  }

  if (row.kind === "turn_summary") {
    return <TurnChangesSummary summary={row.summary} />;
  }

  if (row.kind === "tool_group") {
    const groupKey = row.group.tools[0].id;
    const isNewGroup = animatingGroupKeys.has(groupKey);
    return (
      <Fragment>
        <ToolGroupBlock
          tools={row.group.tools}
          messages={row.group.messages}
          showThinking={showThinking}
          autoExpandTools={autoExpandTools}
          animate={isNewGroup}
        />
        {row.groupTurnSummary ? <TurnChangesSummary summary={row.groupTurnSummary} /> : null}
      </Fragment>
    );
  }

  // row.kind === "message"
  const msg = row.msg;

  if (msg.role === "summary") {
    return (
      <div data-message-id={msg.id}>
        <SummaryBlock message={msg} />
      </div>
    );
  }

  if (msg.role === "tool_call") {
    return (
      <div data-message-id={msg.id}>
        <ToolCall message={msg} autoExpandTools={autoExpandTools} />
      </div>
    );
  }

  return (
    <div data-message-id={msg.id}>
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
  );
}, (prev, next) =>
  prev.row === next.row &&
  prev.showThinking === next.showThinking &&
  prev.autoExpandTools === next.autoExpandTools &&
  prev.animatingGroupKeys === next.animatingGroupKeys &&
  prev.continuationIds === next.continuationIds &&
  prev.onRevert === next.onRevert &&
  prev.onFullRevert === next.onFullRevert &&
  prev.onSendQueuedNow === next.onSendQueuedNow &&
  prev.onUnqueueQueuedMessage === next.onUnqueueQueuedMessage,
);

// ── ChatViewProps ──

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
  sessionId?: string;
  onRevert?: (checkpointId: string) => void;
  onFullRevert?: (checkpointId: string) => void;
  onTopScrollProgress?: (progress: number) => void;
  onSendQueuedNow?: (messageId: string) => void;
  onUnqueueQueuedMessage?: (messageId: string) => void;
  sendNextId?: string | null;
  agents?: InstalledAgent[];
  selectedAgent?: InstalledAgent | null;
  onAgentChange?: (agent: InstalledAgent | null) => void;
}

// ── ChatView (outer, handles empty state) ──

export const ChatView = memo(function ChatView(props: ChatViewProps) {
  const { messages, agents, selectedAgent, onAgentChange } = props;

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

  // Key by sessionId to force a clean remount on session/space switch.
  // This guarantees a fresh Virtualizer instance with no stale itemSizeCache,
  // measurementsCache, or ResizeObserver subscriptions from the previous session.
  return <ChatViewContent key={props.sessionId ?? "__empty__"} {...props} />;
});

// ── ChatViewContent (inner, module-level, virtualized rendering) ──

function ChatViewContent({
  messages, isProcessing, showThinking, autoGroupTools, avoidGroupingEdits,
  autoExpandTools, extraBottomPadding, scrollToMessageId, onScrolledToMessage,
  sessionId, onRevert, onFullRevert, onTopScrollProgress,
  onSendQueuedNow, onUnqueueQueuedMessage, sendNextId,
}: ChatViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Scroll state (refs, not state — rerender-use-ref-transient-values) ──
  const bottomLockedRef = useRef(true);
  const userScrollIntentRef = useRef(0);
  const lastRowCountRef = useRef(0);
  const scrollRafPending = useRef(false);
  // Store callback in ref to avoid effect re-subscriptions (advanced-event-handler-refs)
  const onTopScrollProgressRef = useRef(onTopScrollProgress);
  onTopScrollProgressRef.current = onTopScrollProgress;
  const lastTopProgressRef = useRef(-1);

  // ── Single-pass partition: queued vs non-queued (js-combine-iterations) ──
  const { nonQueuedMessages, queuedMessages } = useMemo(() => {
    const hasQueued = messages.some((m) => m.isQueued);
    if (!hasQueued) {
      return { nonQueuedMessages: messages, queuedMessages: [] as UIMessage[] };
    }
    const nonQueued: UIMessage[] = [];
    const queued: UIMessage[] = [];
    for (const m of messages) {
      (m.isQueued ? queued : nonQueued).push(m);
    }
    return { nonQueuedMessages: nonQueued, queuedMessages: queued };
  }, [messages]);

  // ── Continuation IDs (O(n) forward pass) ──
  const continuationIds = useMemo(() => {
    const ids = new Set<string>();
    let lastRole: string | null = null;
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
        if (lastRole !== null) {
          lastRole = lastRole === "user" ? "user" : lastRole;
        }
      }
    }
    return ids;
  }, [nonQueuedMessages, queuedMessages]);

  // ── Structural identity caching for expensive derived data ──
  const prevMsgStructureRef = useRef<{ length: number; lastId: string | undefined; lastToolResultCount: number }>({ length: 0, lastId: undefined, lastToolResultCount: 0 });
  const cachedTurnSummaryRef = useRef<Map<number, TurnSummary>>(new Map());
  const cachedToolGroupsRef = useRef<ToolGroupInfo>(EMPTY_TOOL_GROUP_INFO);
  const prevIsProcessingRef = useRef(isProcessing);
  const prevAutoGroupRef = useRef(autoGroupTools);
  const prevAvoidEditRef = useRef(avoidGroupingEdits);

  const msgStructure = useMemo(() => {
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

  // ── Turn summaries (rerender-derived-state-no-effect) ──
  const turnSummaryByEndIndex = useMemo(() => {
    if (!structureChanged && cachedTurnSummaryRef.current.size >= 0) {
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

  // ── Tool groups (js-index-maps, js-set-map-lookups) ──
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

  // ── Tool group animation tracking ──
  const finalizedGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const group of toolGroups.values()) {
      if (group.isFinalized && group.tools.length > 0) {
        keys.add(group.tools[0].id);
      }
    }
    return keys;
  }, [toolGroups]);

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

  const animatingGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const key of finalizedGroupKeys) {
      if (!knownGroupKeysRef.current.has(key) && seenUngroupedToolKeysRef.current.has(key)) {
        keys.add(key);
      }
    }
    return keys;
  }, [finalizedGroupKeys]);

  useEffect(() => {
    if (visibleUngroupedToolKeys.size === 0) return;
    const seen = seenUngroupedToolKeysRef.current;
    for (const key of visibleUngroupedToolKeys) seen.add(key);
  }, [visibleUngroupedToolKeys]);

  useEffect(() => {
    const known = knownGroupKeysRef.current;
    for (const key of finalizedGroupKeys) known.add(key);
  }, [finalizedGroupKeys]);

  // ── Processing indicator (useMemo for O(n) scan) ──
  const showProcessingIndicator = useMemo(() => {
    if (!isProcessing) return false;
    return !nonQueuedMessages.some((m) =>
      (m.role === "assistant" && m.isStreaming && (m.content || m.thinking)) ||
      (m.role === "tool_call" && !m.toolResult),
    );
  }, [isProcessing, nonQueuedMessages]);

  // ── Build rows (single O(n) pass — js-combine-iterations) ──
  const rows = useMemo(
    () => buildRows(nonQueuedMessages, toolGroups, groupedIndices, turnSummaryByEndIndex, showProcessingIndicator),
    [nonQueuedMessages, toolGroups, groupedIndices, turnSummaryByEndIndex, showProcessingIndicator],
  );

  // ── Virtualizer ──
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => estimateRowHeight(rows[index]),
    getItemKey: (index) => getRowKey(rows[index]),
    overscan: 5,
    // Row heights change via markdown margins, collapsibles, and tool-group
    // morph animations. Measure inside rAF so ResizeObserver updates align
    // with paint and don't race mid-transition.
    useAnimationFrameWithResizeObserver: true,
  });

  // ── Scroll handling (rerender-defer-reads, rerender-use-ref-transient-values) ──

  const publishTopProgress = useCallback((progress: number) => {
    const clamped = Math.max(0, Math.min(1, progress));
    const last = lastTopProgressRef.current;
    if (last < 0 || Math.abs(clamped - last) >= 0.01 || clamped === 0 || clamped === 1) {
      lastTopProgressRef.current = clamped;
      onTopScrollProgressRef.current?.(clamped);
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollRafPending.current) return;
    scrollRafPending.current = true;
    requestAnimationFrame(() => {
      scrollRafPending.current = false;
      const el = scrollContainerRef.current;
      if (!el) return;

      const { scrollTop, scrollHeight, clientHeight } = el;

      // Top scroll progress for fade overlay
      publishTopProgress(getTopScrollProgress(scrollTop));

      // Bottom lock detection (rerender-derived-state — boolean, not continuous value)
      const hasRecentUserIntent = Date.now() <= userScrollIntentRef.current;
      if (shouldUnlockBottomLock({ scrollTop, scrollHeight, clientHeight, hasRecentUserIntent, threshold: BOTTOM_LOCK_THRESHOLD_PX })) {
        bottomLockedRef.current = false;
        return;
      }
      if (isWithinBottomLockThreshold({ scrollTop, scrollHeight, clientHeight }, BOTTOM_LOCK_THRESHOLD_PX)) {
        bottomLockedRef.current = true;
      }
    });
  }, [publishTopProgress]);

  const markUserIntent = useCallback(() => {
    userScrollIntentRef.current = Date.now() + USER_SCROLL_INTENT_WINDOW_MS;
  }, []);

  // ── Auto-follow on new messages ──
  useEffect(() => {
    if (rows.length === lastRowCountRef.current) return;
    lastRowCountRef.current = rows.length;
    if (bottomLockedRef.current && rows.length > 0) {
      // Defer to next frame so virtualizer has measured
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
      });
    }
  }, [rows.length, virtualizer]);

  // ── Auto-follow during streaming (content height grows without row count change) ──
  useEffect(() => {
    if (!isProcessing || !bottomLockedRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (bottomLockedRef.current) {
        virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
      }
    });

    // Observe the inner content container for height changes
    const inner = el.firstElementChild;
    if (inner) observer.observe(inner);
    return () => observer.disconnect();
  }, [isProcessing, virtualizer, rows.length]);

  // ── Session switch — force scroll to bottom (rerender-dependencies — primitive dep) ──
  useLayoutEffect(() => {
    if (!sessionId) return;
    bottomLockedRef.current = true;
    userScrollIntentRef.current = 0;
    lastTopProgressRef.current = -1;
    lastRowCountRef.current = 0;
    requestAnimationFrame(() => {
      if (rows.length > 0) {
        virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
      }
      publishTopProgress(0);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Content resize (mermaid diagrams etc.) ──
  // Don't call virtualizer.measure() here — it nukes the entire itemSizeCache,
  // forcing all items back to estimates and causing layout jumps/overlaps.
  // The ResizeObserver on each item's measureElement ref already tracks individual
  // size changes (e.g. mermaid SVG rendering). We only need to maintain scroll lock.
  useEffect(() => {
    const handleContentResize = () => {
      if (bottomLockedRef.current && rows.length > 0) {
        requestAnimationFrame(() => {
          virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
        });
      }
    };
    window.addEventListener(CHAT_CONTENT_RESIZED_EVENT, handleContentResize);
    return () => window.removeEventListener(CHAT_CONTENT_RESIZED_EVENT, handleContentResize);
  }, [virtualizer, rows.length]);

  // ── Scroll-to-message (search navigation) ──
  useEffect(() => {
    if (!scrollToMessageId) return;

    const rowIndex = rows.findIndex((row) => {
      if (row.kind === "message") return row.msg.id === scrollToMessageId;
      if (row.kind === "tool_group") return row.group.tools.some((t) => t.id === scrollToMessageId);
      return false;
    });

    if (rowIndex >= 0) {
      bottomLockedRef.current = false;
      virtualizer.scrollToIndex(rowIndex, { align: "center" });

      // Flash highlight after scroll settles
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = scrollContainerRef.current?.querySelector(`[data-message-id="${scrollToMessageId}"]`);
          if (el) {
            el.classList.add("search-highlight");
            setTimeout(() => {
              el.classList.remove("search-highlight");
              onScrolledToMessage?.();
            }, 1500);
          } else {
            onScrolledToMessage?.();
          }
        }, 100);
      });
    } else {
      onScrolledToMessage?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToMessageId]);

  // ── Render ──

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollContainerRef}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={handleScroll}
      onWheel={markUserIntent}
      onTouchMove={markUserIntent}
      onPointerDown={markUserIntent}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize() + 56 + (extraBottomPadding ? 280 : 144)}px`,
          position: "relative",
        }}
      >
        {virtualItems.map((virtualRow) => (
          <div
            key={getRowKey(rows[virtualRow.index])}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            className="flow-root"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start + 56}px)`, // +56px for header space
            }}
          >
            <ChatMessageRow
              row={rows[virtualRow.index]}
              showThinking={showThinking}
              autoExpandTools={autoExpandTools}
              animatingGroupKeys={animatingGroupKeys}
              continuationIds={continuationIds}
              onRevert={onRevert}
              onFullRevert={onFullRevert}
              onSendQueuedNow={onSendQueuedNow}
              onUnqueueQueuedMessage={onUnqueueQueuedMessage}
            />
          </div>
        ))}
      </div>

      {/* Queued messages rendered below virtual list (always small count) */}
      {queuedMessages.length > 0 && (
        <div>
          {queuedMessages.map((msg) => (
            <div key={msg.id} data-message-id={msg.id}>
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
      )}
    </div>
  );
}
