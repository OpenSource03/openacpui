/**
 * Shared shell for authentication dialogs.
 *
 * Wraps ShadCN Dialog for proper accessibility (focus trapping, Escape key,
 * ARIA attributes) and provides common auth-dialog chrome: title, description,
 * error banner, loading indicator, and cancel footer.
 *
 * Dialog-specific content (auth method buttons, forms, progress) goes in `children`.
 */

import { memo } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface AuthDialogShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  error?: string | null;
  loading?: boolean;
  loadingText?: string;
  /** Optional icon rendered to the left of the title row. */
  icon?: React.ReactNode;
  /**
   * Whether to show the cancel button in the footer. Defaults to `true`.
   * Set to `false` when the dialog content provides its own cancel/close actions.
   */
  showCancelButton?: boolean;
  children: React.ReactNode;
}

export const AuthDialogShell = memo(function AuthDialogShell({
  open,
  onClose,
  title,
  description,
  error,
  loading,
  loadingText,
  icon,
  showCancelButton = true,
  children,
}: AuthDialogShellProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-lg gap-0">
        <DialogHeader className={icon ? "flex-row items-start gap-3" : undefined}>
          {icon && (
            <div className="shrink-0 rounded-lg border border-border/60 bg-muted/40 p-2">
              {icon}
            </div>
          )}
          <div>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </div>
        </DialogHeader>

        {error && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && loadingText ? (
          <div className="mt-4 flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{loadingText}</p>
          </div>
        ) : (
          <div className="mt-4">{children}</div>
        )}

        {showCancelButton && (
          <DialogFooter className="mt-4">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
});
