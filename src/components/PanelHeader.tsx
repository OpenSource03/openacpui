/**
 * Consistent panel header used across TodoPanel, BackgroundAgentsPanel,
 * McpPanel, FilesPanel, GitPanel, and ChangesPanel.
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
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {children && <div className="ms-auto flex items-center gap-1">{children}</div>}
      </div>
      {separator && <div className="border-t border-foreground/[0.08]" />}
    </>
  );
}
