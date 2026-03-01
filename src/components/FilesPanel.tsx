import { memo, useMemo, useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelHeader } from "@/components/PanelHeader";
import { OpenInEditorButton } from "./OpenInEditorButton";
import {
  ACCESS_ICON,
  ACCESS_COLOR,
  ACCESS_LABEL,
  getToolAccess,
  extractFilePath,
  extractFiles,
  formatRanges,
  getRelativePath,
} from "@/lib/file-access";
import type { EngineId, UIMessage } from "@/types";

interface FilesPanelProps {
  messages: UIMessage[];
  cwd?: string;
  activeEngine?: EngineId;
  onScrollToToolCall?: (messageId: string) => void;
}

export const FilesPanel = memo(function FilesPanel({
  messages,
  cwd,
  activeEngine,
  onScrollToToolCall,
}: FilesPanelProps) {
  const [hasClaudeMd, setHasClaudeMd] = useState(false);

  useEffect(() => {
    if (activeEngine !== "claude" || !cwd) {
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
  }, [activeEngine, cwd]);

  const files = useMemo(
    () => extractFiles(messages, cwd, activeEngine === "claude" && hasClaudeMd),
    [messages, cwd, activeEngine, hasClaudeMd],
  );

  const handleClick = useCallback(
    (filePath: string) => {
      if (!onScrollToToolCall) return;
      // Find the last tool_call message that references this file
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== "tool_call" || !msg.toolName || !msg.toolInput) continue;
        const access = getToolAccess(msg.toolName);
        if (!access) continue;
        const path = extractFilePath(msg.toolName, msg.toolInput);
        if (path === filePath) {
          onScrollToToolCall(msg.id);
          return;
        }
      }
    },
    [messages, onScrollToToolCall],
  );

  return (
    <div className="flex h-full flex-col">
      <PanelHeader icon={FileText} label="Open Files" separator={false} className="h-10 shrink-0 border-b border-border/50 px-3">
        {files.length > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">
            {files.length}
          </Badge>
        )}
      </PanelHeader>

      {files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-xs text-muted-foreground/70">
            Files accessed during this session will appear here
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
                  className="group flex w-full items-center gap-2 px-3 py-1.5 text-start transition-colors hover:bg-foreground/[0.05] cursor-pointer"
                  onClick={() => handleClick(file.path)}
                >
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} strokeWidth={1.5} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="truncate text-xs font-medium text-foreground/90">
                            {fileName}
                          </span>
                          {rangeText && (
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                              {rangeText}
                            </span>
                          )}
                        </div>
                        {dirPath && (
                          <div className="truncate text-[10px] text-muted-foreground/70">
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
