import React from "react";
import remarkGfm from "remark-gfm";

// ── Constants ──

/** Shared row styling for all MCP renderer list items */
export const MCP_ROW_CLASS = "rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors";

/** Shared remark plugins for Markdown rendering in MCP renderers */
export const REMARK_PLUGINS = [remarkGfm];

// ── Shared Components ──

/** Inline label + value pair used in detail views (e.g., Status: Done, Priority: High) */
export const Field = React.memo(function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-foreground/30 shrink-0">{label}</span>
      {children}
    </div>
  );
});

/** Count header above MCP result lists (e.g., "3 issues", "12 results") */
export const McpListHeader = React.memo(function McpListHeader({
  count,
  noun,
  plural,
}: {
  count: number;
  noun: string;
  /** Override for irregular plurals (e.g., "libraries"). Defaults to `noun + "s"`. */
  plural?: string;
}) {
  const label = count === 1 ? noun : (plural ?? `${noun}s`);
  return (
    <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
      {count} {label}
    </span>
  );
});

/** Empty-state placeholder for MCP result lists */
export const McpEmptyState = React.memo(function McpEmptyState({
  message,
}: {
  message: string;
}) {
  return <p className="text-foreground/40 py-2">{message}</p>;
});
