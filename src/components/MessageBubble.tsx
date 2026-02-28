import { memo, useMemo, useRef, useEffect, useLayoutEffect, createContext, useContext, type ReactNode } from "react";
import { AlertCircle, Clock, File, Folder, Info, RotateCcw, Undo2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { guessLanguage } from "@/lib/languages";
import type { UIMessage } from "@/types";
import { ThinkingBlock } from "./ThinkingBlock";
import { CopyButton } from "./CopyButton";

// Stable references to avoid re-creating on every render
const REMARK_PLUGINS = [remarkGfm];
import type { Components } from "react-markdown";

/**
 * Context to distinguish fenced code blocks (inside <pre>) from inline `code`.
 * react-markdown v10 removed the `inline` prop from the code component —
 * this Context replaces it by having the `pre` component signal block context.
 */
const IsBlockCodeContext = createContext(false);

const MD_COMPONENTS: Components = {
  code: CodeBlock,
  // Strip the <pre> wrapper but signal block context to CodeBlock
  pre({ children }) {
    return (
      <IsBlockCodeContext.Provider value={true}>
        {children}
      </IsBlockCodeContext.Provider>
    );
  },
};
const SYNTAX_STYLE: React.CSSProperties = {
  margin: 0,
  borderRadius: 0,
  background: "transparent",
  fontSize: "12px",
  padding: "12px",
};

/** Override oneDark's background on the inner <code> element */
const CODE_TAG_PROPS = { style: { background: "transparent" } };

/** Strip `<file path="...">...</file>` and `<folder path="...">...</folder>` context blocks from user messages */
function stripFileContext(text: string): string {
  let result = text.replace(/<file path="[^"]*">[\s\S]*?<\/file>\s*/g, "");
  result = result.replace(/<folder path="[^"]*">[\s\S]*?<\/folder>\s*/g, "");
  return result.trim();
}

/** Render @path references as styled inline badges */
function renderWithMentions(text: string): ReactNode[] {
  // Match @path/to/file or @path/to/dir/
  const parts = text.split(/(@[\w./_-]+\/?)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@") && part.length > 1) {
      const filePath = part.slice(1);
      const isDir = filePath.endsWith("/");
      return (
        <span
          key={i}
          className="inline-flex items-baseline gap-0.5 rounded bg-accent/50 px-1 py-px font-mono text-xs text-accent-foreground"
        >
          {isDir ? (
            <Folder className="inline h-3 w-3 shrink-0 self-center text-blue-400" />
          ) : (
            <File className="inline h-3 w-3 shrink-0 self-center text-muted-foreground" />
          )}
          {filePath}
        </span>
      );
    }
    return part;
  });
}

/** Byte-level prefix match for detecting appended text vs mid-text rewrites. */
function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

/** Walk down rightmost children to find the deepest last text node. */
function getDeepLastTextNode(el: Node): Text | null {
  for (let n: Node | null = el.lastChild; n; n = n.lastChild) {
    if (n.nodeType === Node.TEXT_NODE) return n as Text;
    // Skip empty element tails (e.g. <br/>) — try the previous sibling
    if (!n.lastChild) {
      const prev = n.previousSibling;
      if (prev?.nodeType === Node.TEXT_NODE) return prev as Text;
      if (prev) { n = prev; continue; }
      return null;
    }
  }
  return el.nodeType === Node.TEXT_NODE ? (el as Text) : null;
}

/** Detects likely-incomplete markdown code delimiters during streaming. */
function hasUnbalancedBackticks(markdown: string): boolean {
  if (!markdown) return false;
  const parityByRun = new Map<number, number>();
  for (let i = 0; i < markdown.length;) {
    if (markdown.charCodeAt(i) !== 96) {
      i += 1;
      continue;
    }
    // Skip escaped backticks (`\``) so inline literals do not trip balancing.
    if (i > 0 && markdown.charCodeAt(i - 1) === 92) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < markdown.length && markdown.charCodeAt(j) === 96) j += 1;
    const runLen = j - i;
    parityByRun.set(runLen, (parityByRun.get(runLen) ?? 0) ^ 1);
    i = j;
  }
  for (const parity of parityByRun.values()) {
    if (parity === 1) return true;
  }
  return false;
}

function hasCodeAncestor(node: Node, stopAt: Element): boolean {
  let current: Node | null = node.parentNode;
  while (current && current !== stopAt) {
    if (current instanceof HTMLElement) {
      const tag = current.tagName;
      if (tag === "CODE" || tag === "PRE") return true;
    }
    current = current.parentNode;
  }
  return false;
}

interface InjectedSpanState {
  span: HTMLSpanElement;
  expectedPrevText: string;
  injectedText: string;
}

/**
 * Injects per-token fade-in animation into a ReactMarkdown container by
 * splitting the trailing text node in `useLayoutEffect` (before paint).
 *
 * On every React commit the sequence is:
 *  1. React updates text nodes with new content.
 *  2. `useLayoutEffect` runs synchronously (before the browser paints):
 *     a. Removes any previously injected `<span>` from the last frame.
 *     b. Compares the last block element's `textContent` to its previous value.
 *     c. If text was appended, splits the trailing text node into
 *        [old text | <span class="stream-chunk-enter">new text</span>].
 *  3. The browser paints — user sees old text at full opacity + new text fading in.
 *
 * Because cleanup and re-injection both happen before paint, the user never
 * sees the intermediate React-only state. React's reconciler simply overwrites
 * our truncated text node on the next commit (it still holds a valid ref to it).
 */
function useStreamingTextReveal(isStreaming: boolean | undefined, markdown: string) {
  const proseRef = useRef<HTMLDivElement>(null);
  const prevBlockTextRef = useRef("");
  const prevLastBlockRef = useRef<Element | null>(null);
  const injectedSpan = useRef<InjectedSpanState | null>(null);

  // Must run before paint so the user never sees un-animated text
  useLayoutEffect(() => {
    const cleanupInjectedSpan = () => {
      const injected = injectedSpan.current;
      if (!injected) return;
      const { span, expectedPrevText, injectedText } = injected;
      const prev = span.previousSibling;
      // Only merge when the node is still in the exact truncated state.
      // If React already restored full text, merging again would duplicate.
      if (prev && prev.nodeType === Node.TEXT_NODE) {
        const prevText = prev.textContent ?? "";
        if (prevText === expectedPrevText) {
          prev.textContent = prevText + injectedText;
        }
      }
      if (span.isConnected) span.remove();
      injectedSpan.current = null;
    };

    // Step 1: merge the injected span back into the preceding text node.
    // When the content string is identical between renders (e.g. the rAF flush
    // already set the final text before the `assistant` snapshot arrives),
    // React's reconciler skips updating the text node — but we truncated it
    // last frame. Merging restores the full value so no text is lost.
    cleanupInjectedSpan();

    if (!isStreaming || !proseRef.current) {
      prevBlockTextRef.current = "";
      prevLastBlockRef.current = null;
      return;
    }

    const container = proseRef.current;

    // Step 2: identify the last animatable block (skip code blocks / not-prose)
    let lastBlock: Element | null = null;
    for (let i = container.children.length - 1; i >= 0; i--) {
      const child = container.children[i] as HTMLElement;
      if (child.classList?.contains("not-prose")) continue;
      if (child.tagName === "PRE") continue;
      lastBlock = child;
      break;
    }
    if (!lastBlock) return;

    // Detect when the active block changes (new paragraph appeared)
    if (lastBlock !== prevLastBlockRef.current) {
      prevLastBlockRef.current = lastBlock;
      prevBlockTextRef.current = ""; // all text in the new block is "new"
    }

    const blockText = lastBlock.textContent ?? "";
    const prevText = prevBlockTextRef.current;
    prevBlockTextRef.current = blockText;

    // Streaming markdown can be structurally unstable around unmatched backticks.
    // Skip DOM splitting on those frames to avoid malformed inline-code transitions.
    const markdownTail = markdown.length > 1200 ? markdown.slice(-1200) : markdown;
    if (hasUnbalancedBackticks(markdownTail)) return;

    // Only animate pure appends — if text shrank or changed in the middle
    // (e.g. markdown syntax closing), skip this frame gracefully.
    if (blockText.length <= prevText.length) return;
    const prefixLen = commonPrefixLength(prevText, blockText);
    if (prefixLen < prevText.length) return;

    const addedText = blockText.slice(prefixLen);
    if (!addedText) return;

    // Step 3: find the deepest last text node inside the block
    const textNode = getDeepLastTextNode(lastBlock);
    if (!textNode || !textNode.parentNode) return;
    // Avoid splitting inside <code> where markdown structure can still shift.
    if (hasCodeAncestor(textNode, lastBlock)) return;

    const nodeText = textNode.textContent ?? "";
    // Safe path: appended block text must be entirely represented by the tail
    // of the deepest last text node. Otherwise this frame likely crossed a
    // markdown structure boundary and should not be surgically split.
    if (!nodeText.endsWith(addedText)) return;
    const splitAt = nodeText.length - addedText.length;
    const prefixText = nodeText.slice(0, splitAt);

    // Truncate the React-owned text node and append an animated span
    textNode.textContent = prefixText;
    const span = document.createElement("span");
    span.className = "stream-chunk-enter";
    span.textContent = addedText;
    textNode.parentNode.insertBefore(span, textNode.nextSibling);
    injectedSpan.current = {
      span,
      expectedPrevText: prefixText,
      injectedText: addedText,
    };
  });

  // Final cleanup when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      const injected = injectedSpan.current;
      if (injected) {
        const { span, expectedPrevText, injectedText } = injected;
        const prev = span.previousSibling;
        if (prev && prev.nodeType === Node.TEXT_NODE) {
          const prevText = prev.textContent ?? "";
          if (prevText === expectedPrevText) {
            prev.textContent = prevText + injectedText;
          }
        }
        if (span.isConnected) span.remove();
        injectedSpan.current = null;
      }
      prevBlockTextRef.current = "";
      prevLastBlockRef.current = null;
    }
  }, [isStreaming]);

  return proseRef;
}

interface MessageBubbleProps {
  message: UIMessage;
  showThinking?: boolean;
  isContinuation?: boolean;
  /** Called when user clicks "Revert files only" — restores files to state before this message */
  onRevert?: (checkpointId: string) => void;
  /** Called when user clicks "Revert files + chat" — restores files AND truncates conversation */
  onFullRevert?: (checkpointId: string) => void;
}

export const MessageBubble = memo(function MessageBubble({ message, showThinking = true, isContinuation, onRevert, onFullRevert }: MessageBubbleProps) {
  // All hooks must be called before any early returns (Rules of Hooks)
  const isUser = message.role === "user";
  const time = useMemo(() => new Date(message.timestamp).toLocaleTimeString(), [message.timestamp]);
  const displayContent = useMemo(() => isUser ? (message.displayContent ?? stripFileContext(message.content)) : message.content, [isUser, message.content, message.displayContent]);

  // Per-token fade-in animation via DOM surgery in useLayoutEffect.
  // Always renders ReactMarkdown (real-time markdown parsing) — the hook
  // splits trailing text nodes into [old | animated-new] before each paint.
  const proseRef = useStreamingTextReveal(
    message.role === "assistant" ? message.isStreaming : undefined,
    message.role === "assistant" ? message.content : "",
  );

  if (message.role === "system") {
    const isError = message.isError;
    return (
      <div className={cn(
        "mx-auto max-w-3xl px-4 py-1 text-center text-xs",
        isError ? "text-destructive" : "text-muted-foreground",
      )}>
        <div className="inline-flex items-center gap-1.5">
          {isError ? <AlertCircle className="h-3 w-3" /> : <Info className="h-3 w-3" />}
          {message.content}
        </div>
      </div>
    );
  }

  if (isUser) {
    const checkpointId = message.checkpointId;
    const canRevert = !!checkpointId && (!!onRevert || !!onFullRevert);
    return (
      <div className={cn("group/user flex justify-end px-4 py-1.5", message.isQueued && "opacity-60")}>
        <div className={cn("relative max-w-[80%]", canRevert && "pb-5")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn(
                "rounded-2xl rounded-tr-sm bg-foreground/[0.06] px-3.5 py-2 text-sm text-foreground wrap-break-word whitespace-pre-wrap",
                message.isQueued && "border border-dashed border-foreground/10",
              )}>
                {message.images && message.images.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {message.images.map((img) => (
                      <img
                        key={img.id}
                        src={`data:${img.mediaType};base64,${img.data}`}
                        alt={img.fileName ?? "attached image"}
                        className="max-h-48 rounded-lg"
                      />
                    ))}
                  </div>
                )}
                {renderWithMentions(displayContent)}
                {message.isQueued && (
                  <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Queued
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="text-xs">{time}</p>
            </TooltipContent>
          </Tooltip>
          {/* Revert dropdown — visible on hover, offers file-only or full (files + chat) revert */}
          {canRevert && (
            <div className="pointer-events-none absolute end-0 -bottom-0.5 w-max opacity-0 transition-opacity group-hover/user:opacity-100">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="pointer-events-auto flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-foreground/30 transition-colors hover:text-foreground/60">
                    <Undo2 className="h-3 w-3" />
                    Revert to here
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {onRevert && (
                    <DropdownMenuItem onClick={() => onRevert(checkpointId)}>
                      <Undo2 className="h-3.5 w-3.5 me-2" />
                      Revert files only
                    </DropdownMenuItem>
                  )}
                  {onFullRevert && (
                    <DropdownMenuItem onClick={() => onFullRevert(checkpointId)}>
                      <RotateCcw className="h-3.5 w-3.5 me-2" />
                      Revert files + chat
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className={`flex justify-start px-4 ${isContinuation ? "py-0.5" : "py-1.5"}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="min-w-0 max-w-[85%] wrap-break-word">
            {showThinking && message.thinking && (
              <ThinkingBlock
                thinking={message.thinking}
                isStreaming={message.isStreaming}
                thinkingComplete={message.thinkingComplete}
              />
            )}
            {message.content ? (
              <div ref={proseRef} className="prose prose-invert prose-sm max-w-none text-foreground">
                <ReactMarkdown
                  remarkPlugins={REMARK_PLUGINS}
                  components={MD_COMPONENTS}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="text-xs">{time}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}, (prev, next) =>
  prev.message.content === next.message.content &&
  prev.message.thinking === next.message.thinking &&
  prev.message.isStreaming === next.message.isStreaming &&
  prev.message.thinkingComplete === next.message.thinkingComplete &&
  prev.message.images === next.message.images &&
  prev.message.isError === next.message.isError &&
  prev.message.checkpointId === next.message.checkpointId &&
  prev.message.isQueued === next.message.isQueued &&
  prev.showThinking === next.showThinking &&
  prev.isContinuation === next.isContinuation &&
  prev.onRevert === next.onRevert &&
  prev.onFullRevert === next.onFullRevert,
);

/**
 * Handles both fenced code blocks and inline `code` spans.
 * Uses IsBlockCodeContext (from the `pre` component) to detect fenced blocks,
 * since react-markdown v10 removed the `inline` prop.
 */
function CodeBlock(props: React.HTMLAttributes<HTMLElement> & { node?: unknown }) {
  const { className, children } = props;
  const isBlock = useContext(IsBlockCodeContext);
  const match = /language-(\w+)/.exec(String(className ?? ""));
  const code = String(children).replace(/\n$/, "");

  // Fenced code block with language tag → syntax highlighted
  if (isBlock && match) {
    return (
      <div className="not-prose group/code relative my-2 rounded-lg bg-foreground/[0.03] overflow-hidden">
        <div className="flex items-center justify-between bg-foreground/[0.04] px-3 py-1">
          <span className="text-[11px] text-muted-foreground">{match[1]}</span>
          <CopyButton text={code} className="opacity-0 transition-opacity group-hover/code:opacity-100" />
        </div>
        <SyntaxHighlighter
          style={oneDark}
          language={match[1]}
          PreTag="div"
          customStyle={SYNTAX_STYLE}
          codeTagProps={CODE_TAG_PROPS}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    );
  }

  // Fenced code block without language tag → try auto-detect
  if (isBlock) {
    const guessedLang = guessLanguage(code);
    return (
      <div className="not-prose group/code relative my-2 rounded-lg bg-foreground/[0.03] overflow-hidden">
        <div className="flex items-center justify-between bg-foreground/[0.04] px-3 py-1">
          {guessedLang ? (
            <span className="text-[11px] text-muted-foreground">{guessedLang}</span>
          ) : (
            <span />
          )}
          <CopyButton text={code} className="opacity-0 transition-opacity group-hover/code:opacity-100" />
        </div>
        {guessedLang ? (
          <SyntaxHighlighter
            style={oneDark}
            language={guessedLang}
            PreTag="div"
            customStyle={SYNTAX_STYLE}
            codeTagProps={CODE_TAG_PROPS}
          >
            {code}
          </SyntaxHighlighter>
        ) : (
          <pre className="overflow-x-auto p-3 text-xs font-mono">
            <code>{code}</code>
          </pre>
        )}
      </div>
    );
  }

  // Inline code — not-prose prevents Typography backtick pseudo-elements
  return (
    <code className="not-prose rounded bg-foreground/[0.08] px-1.5 py-0.5 text-xs font-mono">
      {children}
    </code>
  );
}
