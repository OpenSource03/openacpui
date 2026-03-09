import { Sparkles, Check, X } from "lucide-react";
import type { UIMessage } from "@/types";

/** Result shape returned by the Skill tool. */
interface SkillResult {
  success: boolean;
  commandName: string;
}

function hasSkillResult(
  result: UIMessage["toolResult"],
): result is NonNullable<UIMessage["toolResult"]> & SkillResult {
  return !!result && typeof (result as SkillResult).commandName === "string";
}

export function SkillContent({ message }: { message: UIMessage }) {
  const skill = String(message.toolInput?.skill ?? "");
  const args = message.toolInput?.args ? String(message.toolInput.args) : null;
  const result = message.toolResult;

  if (!hasSkillResult(result)) {
    // Still running — show skill name
    if (skill) {
      return (
        <div className="text-xs font-mono text-foreground/50 text-[11px]">
          {skill}{args ? ` ${args}` : ""}
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-1.5 text-xs">
      {/* Skill line */}
      <div className="rounded-md border border-foreground/[0.06] overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
          {result.success ? (
            <Check className="h-3 w-3 shrink-0 text-emerald-500/50" />
          ) : (
            <X className="h-3 w-3 shrink-0 text-red-400/60" />
          )}
          <Sparkles className="h-3 w-3 shrink-0 text-foreground/25" />
          <span className="font-mono text-foreground/60 truncate">
            {result.commandName}
          </span>
          {args && (
            <span className="text-foreground/30 truncate">{args}</span>
          )}
        </div>
      </div>

      <span className="text-[10px] text-foreground/25">
        {result.success ? "Skill loaded" : "Failed to load skill"}
      </span>
    </div>
  );
}
