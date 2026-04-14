import { Minus } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useRef, useEffect, useCallback, memo, createContext, useContext } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { useStreamingTextReveal } from "@/hooks/useStreamingTextReveal";
import { useChatPersistedState } from "@/components/chat-ui-state";
import { CHAT_COLLAPSIBLE_CONTENT_CLASS } from "@/components/lib/chat-layout";

// ── Markdown rendering for thinking blocks (matches assistant message style) ──

const THINKING_REMARK_PLUGINS = [remarkGfm];
const ThinkingBlockCodeContext = createContext(false);

function ThinkingCodeBlock(props: React.HTMLAttributes<HTMLElement> & { node?: unknown }) {
  const { className, children } = props;
  const isBlock = useContext(ThinkingBlockCodeContext);
  const code = String(children).replace(/\n$/, "");
  const match = /language-(\w+)/.exec(String(className ?? ""));

  if (isBlock) {
    return (
      <div className="my-1.5 overflow-x-auto rounded bg-foreground/[0.04] p-2">
        {match && <div className="mb-1 text-[10px] text-foreground/20">{match[1]}</div>}
        <pre className="text-[11px] font-mono"><code>{code}</code></pre>
      </div>
    );
  }

  return (
    <code className="not-prose rounded bg-foreground/[0.06] px-1 py-0.5 text-[11px] font-mono">
      {children}
    </code>
  );
}

const THINKING_MD_COMPONENTS: Components = {
  a({ href, children, ...props }) {
    const onClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
      if (!href || href.startsWith("#")) return;
      event.preventDefault();
      void window.claude.openExternal(href);
    };
    return <a {...props} href={href} onClick={onClick} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  pre({ children }) {
    return <ThinkingBlockCodeContext.Provider value={true}>{children}</ThinkingBlockCodeContext.Provider>;
  },
  code: ThinkingCodeBlock,
};

interface ThinkingBlockProps {
  thinking: string;
  isStreaming?: boolean;
  thinkingComplete?: boolean;
  storageKey?: string;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  thinking,
  isStreaming,
  thinkingComplete,
  storageKey,
}: ThinkingBlockProps) {
  const [open, setOpen] = useChatPersistedState(
    storageKey ?? "thinking",
    false,
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewRafRef = useRef(0);
  const contentRafRef = useRef(0);
  // Tracks whether user manually scrolled up in the inner thinking div
  const userScrolledRef = useRef(false);
  const isThinking = Boolean(isStreaming && !thinkingComplete && thinking.length > 0);
  const hasThinkingContent = thinking.length > 0;

  // Text reveal animation for both views — per-token fade-in via DOM surgery
  // (same technique as assistant messages in MessageBubble).
  // Each hook is only active when its view is visible; the other is a no-op.
  const expandedRevealRef = useStreamingTextReveal(
    open && isThinking ? true : undefined,
    thinking,
  );
  const previewRevealRef = useStreamingTextReveal(
    !open && isThinking ? true : undefined,
    thinking,
  );

  // Merge reveal refs with scroll refs using callback refs so both the
  // animation hook and the rAF scroll loop can access the same DOM element.
  const setExpandedRef = useCallback((el: HTMLDivElement | null) => {
    contentRef.current = el;
    (expandedRevealRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [expandedRevealRef]);

  const setPreviewRef = useCallback((el: HTMLDivElement | null) => {
    previewRef.current = el;
    (previewRevealRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [previewRevealRef]);

  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 40;
    userScrolledRef.current = !isNearBottom;
  }, []);

  // Continuous rAF loop for expanded view — smooth lerp scroll that respects
  // user scroll intent. Only auto-scrolls when user is near the bottom.
  useEffect(() => {
    if (!open || !hasThinkingContent) return;
    const el = contentRef.current;
    if (!el) return;

    cancelAnimationFrame(contentRafRef.current);

    const chase = () => {
      if (!userScrolledRef.current) {
        const target = el.scrollHeight - el.clientHeight;
        const diff = target - el.scrollTop;
        if (diff > 0.5) {
          el.scrollTop += Math.min(Math.max(diff * 0.1, 1.5), diff);
        }
      }
      contentRafRef.current = requestAnimationFrame(chase);
    };

    contentRafRef.current = requestAnimationFrame(chase);
    return () => cancelAnimationFrame(contentRafRef.current);
  }, [open, hasThinkingContent]);

  // Continuous rAF loop for collapsed preview — slow lerp scroll with 3D depth
  // effect. Perspective tilt + multi-stop mask create a "receding into distance"
  // illusion as text scrolls upward through the 3-line window.
  useEffect(() => {
    if (open || !hasThinkingContent) return;
    const el = previewRef.current;
    if (!el) return;

    cancelAnimationFrame(previewRafRef.current);

    const applyDepthEffect = () => {
      if (el.scrollTop > 2) {
        el.style.maskImage =
          "linear-gradient(to bottom, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.2) 20%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.8) 70%, black 100%)";
        el.style.transform = "perspective(300px) rotateX(4deg)";
      } else {
        el.style.maskImage = "none";
        el.style.transform = "none";
      }
    };

    const chase = () => {
      const target = el.scrollHeight - el.clientHeight;
      const diff = target - el.scrollTop;
      applyDepthEffect();
      if (diff > 0.5) {
        el.scrollTop += Math.min(Math.max(diff * 0.05, 1), diff);
      }
      previewRafRef.current = requestAnimationFrame(chase);
    };

    previewRafRef.current = requestAnimationFrame(chase);
    return () => cancelAnimationFrame(previewRafRef.current);
  }, [open, hasThinkingContent]);

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
    <Collapsible open={open} onOpenChange={handleOpenChange} className="mb-1">
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
      {/* 3-line 3D preview — only visible while actively thinking + collapsed */}
      {!open && isThinking && (
        <div
          ref={setPreviewRef}
          className="mt-0.5 overflow-hidden border-s border-dashed border-foreground/10 ps-3 py-0.5 text-xs text-foreground/40 will-change-transform [&_p+p]:mt-1 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_li]:ms-3 [&>:first-child]:mt-0 [&>:last-child]:mb-0"
          style={{
            maxHeight: 52,
            transformOrigin: "bottom center",
            transition: "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <ReactMarkdown remarkPlugins={THINKING_REMARK_PLUGINS} components={THINKING_MD_COMPONENTS}>
            {thinking}
          </ReactMarkdown>
        </div>
      )}
      {/* Full content when expanded */}
      {thinking.length > 0 && (
        <CollapsibleContent className={CHAT_COLLAPSIBLE_CONTENT_CLASS}>
          <div
            ref={setExpandedRef}
            onScroll={handleScroll}
            className="max-h-60 overflow-auto border-s-2 border-foreground/10 ps-3 py-1 text-xs text-foreground/40 [&_p+p]:mt-1.5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:ms-3 [&_strong]:text-foreground/50 [&>:first-child]:mt-0 [&>:last-child]:mb-0"
          >
            <ReactMarkdown remarkPlugins={THINKING_REMARK_PLUGINS} components={THINKING_MD_COMPONENTS}>
              {thinking}
            </ReactMarkdown>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}, (prev, next) =>
  prev.thinking === next.thinking &&
  prev.isStreaming === next.isStreaming &&
  prev.thinkingComplete === next.thinkingComplete &&
  prev.storageKey === next.storageKey,
);
