/**
 * Shared Jira utilities used across JiraBoardPanel, JiraIssuePreviewOverlay,
 * and MCP renderers. Single source of truth for common formatting and lookups.
 */

import type { JiraIssue } from "@shared/types/jira";

// ── Initials ──

/** Extract up to two initials from a display name. */
export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// ── Status colors (for MCP renderers & preview overlay) ──

export const STATUS_COLORS: Record<string, string> = {
  "to do": "bg-muted text-muted-foreground",
  open: "bg-muted text-muted-foreground",
  backlog: "bg-muted text-muted-foreground",
  "in progress": "bg-blue-500/15 text-blue-400",
  "in review": "bg-purple-500/15 text-purple-400",
  done: "bg-emerald-500/15 text-emerald-400",
  closed: "bg-emerald-500/15 text-emerald-400",
  resolved: "bg-emerald-500/15 text-emerald-400",
};

export function getStatusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? "bg-muted text-muted-foreground";
}

// ── Board column category tones (kanban board styling) ──

interface CategoryTone {
  stripe: string;
  pill: string;
  column: string;
}

export function getCategoryTone(category?: JiraIssue["statusCategory"]): CategoryTone {
  switch (category) {
    case "todo":
      return {
        stripe: "bg-slate-400/80",
        pill: "bg-slate-500/10 text-slate-200 border-slate-400/20",
        column: "border-slate-400/15 bg-slate-500/[0.06]",
      };
    case "done":
      return {
        stripe: "bg-emerald-400/80",
        pill: "bg-emerald-500/10 text-emerald-200 border-emerald-400/20",
        column: "border-emerald-400/15 bg-emerald-500/[0.06]",
      };
    default:
      return {
        stripe: "bg-amber-400/80",
        pill: "bg-amber-500/10 text-amber-200 border-amber-400/20",
        column: "border-amber-400/15 bg-amber-500/[0.06]",
      };
  }
}

export function getCategoryLabel(category?: JiraIssue["statusCategory"]): string {
  switch (category) {
    case "todo":
      return "To do";
    case "done":
      return "Done";
    default:
      return "In progress";
  }
}

// ── Jira wiki markup to markdown converter ──

export function jiraWikiToMarkdown(wiki: string): string {
  return (
    wiki
      // Headings: h1. -> #, h2. -> ##, etc.
      .replace(/^h([1-6])\.\s+(.*)$/gm, (_m, level: string, text: string) => `${"#".repeat(Number(level))} ${text}`)
      // Bold: *text* -> **text** (but not bullet lists)
      .replace(/(?<!\S)\*(\S[^*]*\S|\S)\*(?!\S)/g, "**$1**")
      // Italic: _text_ -> *text*
      .replace(/(?<!\S)_(\S[^_]*\S|\S)_(?!\S)/g, "*$1*")
      // Strikethrough: -text- -> ~~text~~
      .replace(/(?<=\s|^)-(\S[^-]*\S|\S)-(?=\s|$)/gm, "~~$1~~")
      // Monospace: {{text}} -> `text`
      .replace(/\{\{([^}]+)\}\}/g, "`$1`")
      // Ordered lists: # item -> 1. item
      .replace(/^#\s+/gm, "1. ")
      // Nested ordered: ## item -> indent
      .replace(/^##\s+/gm, "   1. ")
      // Bullet lists: ** is nested
      .replace(/^\*\*\s+/gm, "  - ")
      // Links: [text|url] -> [text](url)
      .replace(/\[([^|[\]]+)\|([^\]]+)\]/g, "[$1]($2)")
      // Bare links: [url] -> [url](url)
      .replace(/\[((https?:\/\/)[^\]]+)\]/g, "[$1]($1)")
      // {noformat} / {code} blocks
      .replace(/\{noformat\}([\s\S]*?)\{noformat\}/g, "```\n$1\n```")
      .replace(
        /\{code(?::([^}]*))?\}([\s\S]*?)\{code\}/g,
        (_m, lang: string | undefined, code: string) => `\`\`\`${lang ?? ""}\n${code}\n\`\`\``,
      )
  );
}

// ── Priority helpers ──

export const PRIORITY_ORDER: Record<string, number> = {
  Highest: 0,
  High: 1,
  Medium: 2,
  Low: 3,
  Lowest: 4,
};

/** Compute Tailwind classes for a priority badge on kanban cards. */
export function getPriorityTone(priorityName?: string): string {
  if (priorityName === "Highest" || priorityName === "High") {
    return "border-red-500/30 text-red-300 bg-red-500/10";
  }
  if (priorityName === "Low" || priorityName === "Lowest") {
    return "border-sky-500/30 text-sky-300 bg-sky-500/10";
  }
  return "border-border/70 text-muted-foreground bg-background/40";
}
