import { useState, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`h-7 w-7 text-muted-foreground hover:text-foreground ${className ?? ""}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleCopy();
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-foreground/60" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}
