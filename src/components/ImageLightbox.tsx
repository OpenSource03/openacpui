import React from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { ImageAttachment } from "@/types";

interface ImageLightboxProps {
  image: ImageAttachment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Full-size read-only image viewer for images already sent in messages. */
export const ImageLightbox = React.memo(function ImageLightbox({
  image,
  open,
  onOpenChange,
}: ImageLightboxProps) {
  if (!image) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-[90vw] items-center justify-center border-none bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <DialogDescription className="sr-only">
          Full-size view of the attached image.
        </DialogDescription>
        <img
          src={`data:${image.mediaType};base64,${image.data}`}
          alt={image.fileName ?? "attached image"}
          className="max-h-[85vh] max-w-[88vw] rounded-lg object-contain"
        />
      </DialogContent>
    </Dialog>
  );
});
