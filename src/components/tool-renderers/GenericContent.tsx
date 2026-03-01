import type { UIMessage } from "@/types";
import { formatInput, formatResult } from "@/components/lib/tool-formatting";

export function GenericContent({ message }: { message: UIMessage }) {
  return (
    <div className="space-y-1.5 text-xs">
      {message.toolInput && (
        <pre className="max-h-32 overflow-auto rounded-md bg-foreground/[0.04] px-3 py-2 text-[11px] text-foreground/50 whitespace-pre-wrap wrap-break-word">
          {formatInput(message.toolInput)}
        </pre>
      )}
      {message.toolResult && (
        <pre className="max-h-48 overflow-auto rounded-md bg-foreground/[0.04] px-3 py-2 text-[11px] text-foreground/50 whitespace-pre-wrap wrap-break-word">
          {formatResult(message.toolResult)}
        </pre>
      )}
    </div>
  );
}
