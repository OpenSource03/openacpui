import { memo, useMemo, createContext, useContext, type ReactNode } from "react";
import { AlertCircle, File, Folder, Info, RotateCcw, Undo2 } from "lucide-react";
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

interface MessageBubbleProps {
  message: UIMessage;
  isContinuation?: boolean;
  /** Called when user clicks "Revert files only" — restores files to state before this message */
  onRevert?: (checkpointId: string) => void;
  /** Called when user clicks "Revert files + chat" — restores files AND truncates conversation */
  onFullRevert?: (checkpointId: string) => void;
}

export const MessageBubble = memo(function MessageBubble({ message, isContinuation, onRevert, onFullRevert }: MessageBubbleProps) {
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

  const isUser = message.role === "user";
  // toLocaleTimeString() is slow (~0.5ms) — memoize since timestamp never changes
  const time = useMemo(() => new Date(message.timestamp).toLocaleTimeString(), [message.timestamp]);
  // Prefer pre-computed displayContent; fall back to regex stripping for old persisted sessions
  const displayContent = useMemo(() => isUser ? (message.displayContent ?? stripFileContext(message.content)) : message.content, [isUser, message.content, message.displayContent]);

  if (isUser) {
    const checkpointId = message.checkpointId;
    const canRevert = !!checkpointId && (!!onRevert || !!onFullRevert);
    return (
      <div className="group/user flex justify-end px-4 py-1.5">
        <div className="max-w-[80%]">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="rounded-2xl rounded-tr-sm bg-foreground/[0.06] px-3.5 py-2 text-sm text-foreground wrap-break-word whitespace-pre-wrap">
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
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="text-xs">{time}</p>
            </TooltipContent>
          </Tooltip>
          {/* Revert dropdown — visible on hover, offers file-only or full (files + chat) revert */}
          {canRevert && (
            <div className="mt-0.5 flex justify-end opacity-0 transition-opacity group-hover/user:opacity-100">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-foreground/30 transition-colors hover:text-foreground/60">
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
            {message.thinking && (
              <ThinkingBlock
                thinking={message.thinking}
                isStreaming={message.isStreaming}
                thinkingComplete={message.thinkingComplete}
              />
            )}
            {message.content ? (
              <div className="prose prose-invert prose-sm max-w-none text-foreground">
                <ReactMarkdown
                  remarkPlugins={REMARK_PLUGINS}
                  components={MD_COMPONENTS}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            ) : message.isStreaming && !message.thinking ? (
              <span className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/40" />
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
