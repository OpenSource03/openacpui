import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { CCSessionInfo } from "@/types";

function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function CCSessionList({
  projectPath,
  onSelect,
}: {
  projectPath: string;
  onSelect: (sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<CCSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    window.claude.ccSessions
      .list(projectPath)
      .then((result) => {
        setSessions(result);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [projectPath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        No Claude Code sessions found
      </p>
    );
  }

  return (
    <>
      {sessions.map((s) => (
        <DropdownMenuItem
          key={s.sessionId}
          onClick={() => onSelect(s.sessionId)}
          className="flex flex-col items-start gap-0.5 py-2"
        >
          <span className="line-clamp-1 text-sm">{s.preview}</span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeDate(s.timestamp)} · {s.model}
          </span>
        </DropdownMenuItem>
      ))}
    </>
  );
}
