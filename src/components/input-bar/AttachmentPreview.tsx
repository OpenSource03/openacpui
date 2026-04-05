import { memo } from "react";
import { Crosshair, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImageAttachment, GrabbedElement } from "@/types";

export interface AttachmentPreviewProps {
  attachments: ImageAttachment[];
  onRemoveAttachment: (id: string) => void;
  onEditAttachment: (attachment: ImageAttachment) => void;
  grabbedElements: GrabbedElement[];
  onRemoveGrabbedElement: (id: string) => void;
}

/** Image attachment thumbnails and grabbed DOM element context chips above the toolbar. */
export const AttachmentPreview = memo(function AttachmentPreview({
  attachments,
  onRemoveAttachment,
  onEditAttachment,
  grabbedElements,
  onRemoveGrabbedElement,
}: AttachmentPreviewProps) {
  const hasAttachments = attachments.length > 0;
  const hasGrabbedElements = grabbedElements.length > 0;

  if (!hasAttachments && !hasGrabbedElements) return null;

  return (
    <>
      {/* Image attachment thumbnails -- click to open annotation editor */}
      {hasAttachments && (
        <div className="flex flex-wrap gap-2.5 px-5 pb-2.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="group/att relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-border/30 shadow-sm ring-1 ring-inset ring-white/[0.04] transition-all duration-200 hover:shadow-md hover:border-border/50"
              onClick={() => onEditAttachment(att)}
            >
              <img
                src={`data:${att.mediaType};base64,${att.data}`}
                alt={att.fileName ?? "attachment"}
                className="h-full w-full object-cover transition-transform duration-200 group-hover/att:scale-105"
              />
              {/* Edit overlay icon -- bottom-right, visible on hover */}
              <div className="absolute bottom-0.5 end-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/att:opacity-100">
                <Pencil className="h-2.5 w-2.5" />
              </div>
              {/* Remove button -- top-right, stops propagation to prevent opening editor */}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveAttachment(att.id);
                }}
                className="absolute -end-1 -top-1 size-5 rounded-full bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-background/95 hover:text-foreground group-hover/att:opacity-100"
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Grabbed element preview chips (from browser inspector) */}
      {hasGrabbedElements && (
        <div className="flex flex-wrap gap-2.5 px-5 pb-2.5">
          {grabbedElements.map((ge) => (
            <div
              key={ge.id}
              className="group/grab relative flex items-center gap-2.5 rounded-xl border border-blue-500/15 bg-blue-500/5 px-3 py-2 shadow-sm transition-all duration-150 hover:border-blue-500/25 hover:bg-blue-500/8"
            >
              <Crosshair className="h-3.5 w-3.5 shrink-0 text-blue-400" />
              <div className="flex flex-col">
                <span className="text-[11px] font-mono font-medium text-foreground/80">
                  {"<"}
                  {ge.tag}
                  {">"}
                  {ge.attributes?.id && (
                    <span className="text-blue-400">#{ge.attributes.id}</span>
                  )}
                  {ge.classes?.length > 0 && (
                    <span className="text-foreground/40">
                      .{ge.classes.slice(0, 2).join(".")}
                    </span>
                  )}
                </span>
                {ge.textContent && (
                  <span className="max-w-48 truncate text-[10px] text-muted-foreground">
                    {ge.textContent.slice(0, 60)}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onRemoveGrabbedElement(ge.id)}
                className="absolute -end-1 -top-1 size-4 rounded-full bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-background/95 hover:text-foreground group-hover/grab:opacity-100"
              >
                <X className="size-2.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
});
