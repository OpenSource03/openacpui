import { Bot } from "lucide-react";
import { resolveLucideIcon } from "@/lib/icon-utils";

interface AgentIconProps {
  icon?: string;
  size?: number;
  className?: string;
}

/**
 * Renders an agent icon — supports URL (from registry CDN), emoji, or lucide name.
 * Falls back to a generic Bot icon when nothing matches.
 */
export function AgentIcon({ icon, size = 16, className }: AgentIconProps) {
  if (!icon) {
    return <Bot style={{ width: size, height: size }} className={className} />;
  }

  // URL icon (from ACP registry) — render as <img>
  // dark:invert makes dark SVGs white in dark mode; dark:brightness-200 boosts faint colors
  if (icon.startsWith("http://") || icon.startsWith("https://")) {
    return (
      <img
        src={icon}
        alt=""
        style={{ width: size, height: size }}
        className={`dark:invert dark:brightness-200 ${className ?? ""}`}
        draggable={false}
      />
    );
  }

  // Emoji icon — starts with a non-ASCII/emoji character
  if (/^\p{Emoji}/u.test(icon)) {
    return <span style={{ fontSize: size - 2 }} className={className}>{icon}</span>;
  }

  // Lucide icon name (PascalCase or kebab-case)
  const Icon = resolveLucideIcon(icon);
  if (Icon) return <Icon style={{ width: size, height: size }} className={className} />;

  // Fallback
  return <Bot style={{ width: size, height: size }} className={className} />;
}
