import type { UIMessage } from "@/types";
import { formatResult } from "@/components/lib/tool-formatting";

export function SearchContent({ message }: { message: UIMessage }) {
  const pattern = String(message.toolInput?.pattern ?? "");
  const result = message.toolResult;

  return (
    <div className="space-y-1.5 text-xs">
      {pattern && (
        <div className="font-mono text-[11px] text-foreground/50">
          {pattern}
        </div>
      )}
      {result && (
        <pre className="max-h-48 overflow-auto rounded-md bg-foreground/[0.04] px-3 py-2 text-[11px] text-foreground/50 whitespace-pre-wrap wrap-break-word">
          {formatResult(result)}
        </pre>
      )}
    </div>
  );
}
