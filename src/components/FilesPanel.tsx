import { memo, startTransition, useMemo, useCallback, useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelHeader } from "@/components/PanelHeader";
import { OpenInEditorButton } from "./OpenInEditorButton";
import {
  ACCESS_ICON,
  ACCESS_COLOR,
  ACCESS_LABEL,
  formatRanges,
  getRelativePath,
} from "@/lib/file-access";
import {
  buildSessionCacheKey,
  computeFilePanelData,
  getCachedFilePanelData,
  type FilePanelData,
} from "@/lib/session/derived-data";
import type { EngineId, UIMessage } from "@/types";

interface FilesPanelProps {
  sessionId?: string | null;
  messages: UIMessage[];
  cwd?: string;
  activeEngine?: EngineId;
  onScrollToToolCall?: (messageId: string) => void;
  enabled?: boolean;
  headerControls?: React.ReactNode;
}

export const FilesPanel = memo(function FilesPanel({
  sessionId,
  messages,
  cwd,
  activeEngine,
  onScrollToToolCall,
  enabled = true,
  headerControls,
}: FilesPanelProps) {
  const [hasClaudeMd, setHasClaudeMd] = useState(false);
  const [data, setData] = useState<FilePanelData | null>(null);

  useEffect(() => {
    if (!enabled || activeEngine !== "claude" || !cwd) {
      setHasClaudeMd(false);
      return;
    }

    let cancelled = false;
    window.claude
      .readFile(`${cwd}/CLAUDE.md`)
      .then((result) => {
        if (cancelled) return;
        setHasClaudeMd(Boolean(!result.error && result.content != null));
      })
      .catch(() => {
        if (!cancelled) setHasClaudeMd(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeEngine, cwd, enabled]);

  const cacheSessionId = sessionId ?? "no-session";
  // Optimization: depend on messages.length and last message identity instead of
  // the full messages array reference, which changes on every streaming flush.
  // buildSessionCacheKey only reads messages.length, last id, and last timestamp.
  const lastMsg = messages[messages.length - 1];
  const msgLen = messages.length;
  const lastMsgId = lastMsg?.id;
  const lastMsgTs = lastMsg?.timestamp;
  const cacheKey = useMemo(
    () => buildSessionCacheKey(cacheSessionId, messages, `${cwd ?? ""}:${activeEngine ?? ""}:${hasClaudeMd ? "claude-md" : "no-claude-md"}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeEngine, cacheSessionId, cwd, hasClaudeMd, msgLen, lastMsgId, lastMsgTs],
  );

  useEffect(() => {
    if (!enabled) return;

    const cached = getCachedFilePanelData(cacheSessionId, cacheKey);
    if (cached) {
      setData(cached);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const next = computeFilePanelData(
        cacheSessionId,
        cacheKey,
        messages,
        cwd,
        activeEngine === "claude" && hasClaudeMd,
      );
      if (cancelled) return;
      startTransition(() => setData(next));
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeEngine, cacheKey, cacheSessionId, cwd, enabled, hasClaudeMd, messages]);

  const files = data?.files ?? [];

  const handleClick = useCallback((filePath: string) => {
    if (!onScrollToToolCall) return;
    const messageId = data?.lastToolCallIdByFile.get(filePath);
    if (messageId) onScrollToToolCall(messageId);
  }, [data, onScrollToToolCall]);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader icon={FileText} label="Open Files" iconClass="text-amber-600/70 dark:text-amber-200/50">
        {files.length > 0 && (
          <span className="text-[10px] tabular-nums text-foreground/35">{files.length}</span>
        )}
        {headerControls}
      </PanelHeader>

      {enabled && !data ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-4">
          <Loader2 className="h-3 w-3 animate-spin text-foreground/25" />
          <p className="text-center text-[10px] text-muted-foreground/40">
            Indexing…
          </p>
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-6">
          <FileText className="h-4 w-4 text-foreground/15" />
          <p className="text-center text-[10px] leading-relaxed text-muted-foreground/40">
            Accessed files will appear here
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col py-1">
            {files.map((file) => {
              const Icon = ACCESS_ICON[file.accessType];
              const color = ACCESS_COLOR[file.accessType];
              const label = ACCESS_LABEL[file.accessType];
              const { fileName, dirPath } = getRelativePath(file.path, cwd);
              const rangeText = formatRanges(file);

              return (
                <div
                  key={file.path}
                  className="group flex w-full items-center gap-2 px-3 py-1 text-start transition-colors hover:bg-foreground/[0.04] cursor-pointer"
                  onClick={() => handleClick(file.path)}
                >
                  <Icon className={`h-3 w-3 shrink-0 ${color}`} strokeWidth={1.75} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="truncate text-xs font-medium text-foreground/85 transition-colors duration-150 group-hover:text-foreground">
                            {fileName}
                          </span>
                          {rangeText && (
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
                              {rangeText}
                            </span>
                          )}
                        </div>
                        {dirPath && (
                          <div className="truncate text-[10px] text-muted-foreground/55">
                            {dirPath}
                          </div>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" sideOffset={8}>
                      <p className="text-xs">
                        {file.path} ({label.toLowerCase()}{rangeText ? `, ${rangeText}` : ""}{file.totalLines ? ` of ${file.totalLines}` : ""})
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <OpenInEditorButton filePath={file.path} />
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
});
