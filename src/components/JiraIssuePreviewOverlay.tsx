/**
 * Jira issue preview overlay with morphing animation.
 * Mirrors FilePreviewOverlay's FLIP animation pattern.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, ExternalLink, Loader2, MessageSquare } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getInitials, getStatusColor, jiraWikiToMarkdown } from "@/lib/jira-utils";
import type { JiraIssue, JiraComment } from "@shared/types/jira";

const REMARK_PLUGINS = [remarkGfm];

// ── Overlay dimensions (same as FilePreviewOverlay) ──

const OVERLAY_WIDTH = 800;
const OVERLAY_MAX_HEIGHT_VH = 85;

// ── Props ──

interface JiraIssuePreviewOverlayProps {
  issue: JiraIssue | null;
  sourceRect: DOMRect | null;
  instanceUrl?: string;
  onClose: () => void;
}

// ── Component ──

export const JiraIssuePreviewOverlay = memo(function JiraIssuePreviewOverlay({
  issue,
  sourceRect,
  instanceUrl,
  onClose,
}: JiraIssuePreviewOverlayProps) {
  return createPortal(
    <AnimatePresence mode="wait">
      {issue && (
        <OverlayContent
          key={issue.key}
          issue={issue}
          sourceRect={sourceRect}
          instanceUrl={instanceUrl}
          onClose={onClose}
        />
      )}
    </AnimatePresence>,
    document.body,
  );
});

// ── Inner content (separate for AnimatePresence keying) ──

interface OverlayContentProps {
  issue: JiraIssue;
  sourceRect: DOMRect | null;
  instanceUrl?: string;
  onClose: () => void;
}

const OverlayContent = memo(function OverlayContent({
  issue,
  sourceRect,
  instanceUrl,
  onClose,
}: OverlayContentProps) {
  const [comments, setComments] = useState<JiraComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  // Load comments when overlay opens
  useEffect(() => {
    if (!instanceUrl) return;

    let cancelled = false;
    setLoadingComments(true);

    window.claude.jira
      .getComments({ instanceUrl, issueKey: issue.key })
      .then((result) => {
        if (!cancelled && !("error" in result)) setComments(result);
      })
      .catch(() => {
        // Silently fail — comments are optional
      })
      .finally(() => {
        if (!cancelled) setLoadingComments(false);
      });

    return () => { cancelled = true; };
  }, [instanceUrl, issue.key]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  // Compute FLIP transform from source rect
  const flipTransform = useMemo(() => {
    if (!sourceRect) return null;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const overlayW = Math.min(OVERLAY_WIDTH, viewportW - 48);
    const overlayH = Math.min(
      viewportH * (OVERLAY_MAX_HEIGHT_VH / 100),
      viewportH - 48,
    );

    const sourceX = sourceRect.left + sourceRect.width / 2;
    const sourceY = sourceRect.top + sourceRect.height / 2;

    return {
      x: sourceX - viewportW / 2,
      y: sourceY - viewportH / 2,
      scaleX: Math.max(sourceRect.width / overlayW, 0.02),
      scaleY: Math.max(sourceRect.height / overlayH, 0.02),
    };
  }, [sourceRect]);

  const morphTransform = flipTransform
    ? { x: flipTransform.x, y: flipTransform.y, scaleX: flipTransform.scaleX, scaleY: flipTransform.scaleY, opacity: 0 }
    : { scale: 0.92, opacity: 0 };

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const priorityColorClass = issue.priority
    ? issue.priority.name === "Highest" || issue.priority.name === "High"
      ? "border-red-500/40 text-red-500"
      : issue.priority.name === "Low" || issue.priority.name === "Lowest"
        ? "border-blue-500/40 text-blue-500"
        : "border-border text-muted-foreground"
    : "";

  const descriptionMarkdown = useMemo(
    () => (issue.description ? jiraWikiToMarkdown(issue.description) : ""),
    [issue.description],
  );

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-50 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={handleBackdropClick}
      />

      {/* Morphing overlay card */}
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
        onClick={handleBackdropClick}
      >
        <motion.div
          className="pointer-events-auto grid overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-2xl"
          style={{
            width: Math.min(OVERLAY_WIDTH, window.innerWidth - 48),
            maxHeight: `${OVERLAY_MAX_HEIGHT_VH}vh`,
            gridTemplateRows: "auto minmax(0, 1fr) auto",
          }}
          initial={morphTransform}
          animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, scale: 1, opacity: 1 }}
          exit={morphTransform}
          transition={{
            type: "spring",
            damping: 32,
            stiffness: 380,
            mass: 0.8,
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-foreground/[0.08] px-4 py-2.5">
            <span className="text-sm font-mono font-medium text-muted-foreground">{issue.key}</span>
            {issue.issueType && (
              <span className="text-xs text-muted-foreground/60">{issue.issueType.name}</span>
            )}
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => window.claude.openExternal(issue.url)}
                    className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md
                      text-muted-foreground/40 transition-colors duration-150
                      hover:text-foreground hover:bg-foreground/[0.06]
                      active:scale-90"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}>
                  <p className="text-xs">Open in Jira</p>
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md
                  text-muted-foreground/40 transition-colors duration-150
                  hover:text-foreground hover:bg-foreground/[0.06]
                  active:scale-90"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="min-h-0 overflow-y-auto">
            <div className="space-y-4 p-5 pb-6">
              {/* Summary */}
              <h2 className="text-lg font-semibold wrap-break-word">{issue.summary}</h2>

              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-xs font-medium border-0 ${getStatusColor(issue.status)}`}
                >
                  {issue.status}
                </Badge>
                {issue.priority && (
                  <Badge variant="outline" className={`text-xs ${priorityColorClass}`}>
                    {issue.priority.name}
                  </Badge>
                )}
                {issue.issueType && (
                  <Badge variant="outline" className="text-xs">
                    {issue.issueType.name}
                  </Badge>
                )}
              </div>

              {/* Assignee */}
              {issue.assignee && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Avatar size="sm" className="ring-1 ring-border/60">
                    {issue.assignee.avatarUrl && (
                      <AvatarImage
                        src={issue.assignee.avatarUrl}
                        alt={issue.assignee.displayName}
                      />
                    )}
                    <AvatarFallback className="text-[11px] font-semibold">
                      {getInitials(issue.assignee.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <span className="text-muted-foreground/60">Assigned to: </span>
                    {issue.assignee.displayName}
                  </div>
                </div>
              )}

              {/* Description */}
              {descriptionMarkdown ? (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">Description</h3>
                  <div className="prose dark:prose-invert prose-sm max-w-none text-foreground/80 wrap-break-word">
                    <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                      {descriptionMarkdown}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground/40 italic">No description provided</p>
              )}

              {/* Comments */}
              {(loadingComments || comments.length > 0) && (
                <section className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.025] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                      <MessageSquare className="h-3 w-3" />
                      Comments
                    </h3>
                    {!loadingComments && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground/70">
                        {comments.length}
                      </Badge>
                    )}
                  </div>

                  <Separator className="mb-3" />

                  {loadingComments ? (
                    <div className="flex items-center gap-2 py-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/40" />
                      <span className="text-xs text-muted-foreground/40">Loading comments...</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {comments.map((comment) => (
                          <div
                            key={comment.id}
                            className="rounded-lg border border-foreground/[0.08] bg-background/80 px-3 py-2.5"
                          >
                          <div className="mb-2 flex items-center gap-2">
                            <Avatar size="sm" className="ring-1 ring-border/60">
                              {comment.authorAvatarUrl && (
                                <AvatarImage src={comment.authorAvatarUrl} alt={comment.author} />
                              )}
                              <AvatarFallback className="text-[11px] font-semibold">
                                {getInitials(comment.author)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-foreground/75">{comment.author}</div>
                              {comment.created && (
                                <span className="text-[10px] text-muted-foreground/40">
                                  {new Date(comment.created).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="prose dark:prose-invert prose-xs max-w-none text-foreground/70 wrap-break-word">
                            <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                              {jiraWikiToMarkdown(comment.body)}
                            </ReactMarkdown>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center border-t border-foreground/[0.08] px-4 py-1.5">
            <span className="text-[11px] text-muted-foreground/50 truncate">{issue.url}</span>
          </div>
        </motion.div>
      </motion.div>
    </>
  );
});
