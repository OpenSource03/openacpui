import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";

interface ConfirmDialogProps {
  /** Controls dialog visibility */
  open: boolean;
  /** Called when dialog requests to close (backdrop click, escape, cancel) */
  onOpenChange: (open: boolean) => void;
  /** Called when the user confirms the action */
  onConfirm: () => void;
  /** Dialog title */
  title: string;
  /** Description / body — accepts React nodes for inline formatting */
  description: React.ReactNode;
  /** Label for the confirm button (default: "Confirm") */
  confirmLabel?: string;
  /** Label for the cancel button (default: "Cancel") */
  cancelLabel?: string;
  /** Variant for the confirm button (default: "destructive") */
  confirmVariant?: ButtonVariant;
}

/**
 * Reusable confirmation dialog built on ShadCN Dialog.
 * Suitable for delete confirmations, destructive actions, or any yes/no prompt.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "destructive",
}: ConfirmDialogProps) {
  const handleConfirm = useCallback(() => {
    onConfirm();
    onOpenChange(false);
  }, [onConfirm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} size="sm" onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
