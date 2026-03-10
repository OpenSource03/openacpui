/**
 * Consistent panel header used across TodoPanel, BackgroundAgentsPanel,
 * McpPanel, FilesPanel, and GitPanel.
 *
 * Provides a standardized layout: [icon] [label] [...children (right side)]
 * followed by an optional separator.
 */

import type { LucideIcon } from "lucide-react";

interface PanelHeaderProps {
  icon: LucideIcon;
  label: string;
  /** Optional content rendered to the right of the label (badges, counts, buttons). */
  children?: React.ReactNode;
  /** Show a bottom border separator. Defaults to true. */
  separator?: boolean;
  /** Additional className for the header container (e.g. custom padding). */
  className?: string;
  /** Icon color class override. Defaults to "text-muted-foreground". */
  iconClass?: string;
}

export function PanelHeader({
  icon: Icon,
  label,
  children,
  separator = true,
  className = "px-3 pt-3 pb-2",
  iconClass = "text-muted-foreground",
}: PanelHeaderProps) {
  return (
    <>
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-foreground/[0.04]">
          <Icon className={`h-3 w-3 shrink-0 ${iconClass}`} />
        </div>
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground/80 uppercase">{label}</span>
        {children && <div className="ms-auto flex items-center gap-1.5">{children}</div>}
      </div>
      {separator && (
        <div className="mx-2">
          <div className="h-px bg-gradient-to-r from-foreground/[0.06] via-foreground/[0.1] to-foreground/[0.06]" />
        </div>
      )}
    </>
  );
}
