import { memo, useMemo, createContext, useContext, type ReactNode } from "react";
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
import { useStreamingTextReveal } from "@/hooks/useStreamingTextReveal";
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

function parseFileHref(href: string): { filePath: string; line?: number } | null {
  if (!href) return null;

  try {
    const url = new URL(href);
    if (url.protocol !== "file:") return null;
    const filePath = decodeURIComponent(url.pathname);
    const hashLine = /^#L(\d+)$/i.exec(url.hash)?.[1];
    const line = hashLine ? Number(hashLine) : undefined;
    return { filePath, line };
  } catch {
    // Not an absolute URL; continue with path-like fallback.
  }

  if (
    href.startsWith("/") ||
    href.startsWith("./") ||
    href.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(href)
  ) {
    const [, pathPart, linePart] = href.match(/^(.*?)(?::(\d+))?$/) ?? [];
    if (pathPart) {
      return { filePath: pathPart, line: linePart ? Number(linePart) : undefined };
    }
  }

  return null;
}

const MD_COMPONENTS: Components = {
  a({ href, children, ...props }) {
    const onClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
      if (!href || href.startsWith("#")) return;
      event.preventDefault();
      const fileTarget = parseFileHref(href);
      if (fileTarget) {
        void window.claude.openInEditor(fileTarget.filePath, fileTarget.line);
        return;
      }
      void window.claude.openExternal(href);
    };

    return (
      <a
        {...props}
        href={href}
        onClick={onClick}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
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
  textShadow: "none",
  fontSize: "12px",
  padding: "12px",
};

/** Override oneDark's background on the inner <code> element */
const CODE_TAG_PROPS = { style: { background: "transparent", textShadow: "none" } };

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
              <div
                ref={proseRef}
                className="prose dark:prose-invert prose-sm max-w-none text-foreground [&_li::marker]:text-foreground dark:[&_li::marker]:text-foreground/70"
              >
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
