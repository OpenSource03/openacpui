import type { LucideIcon } from "lucide-react";

interface PlaceholderSectionProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

export function PlaceholderSection({ title, description, icon: Icon }: PlaceholderSectionProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
          <Icon className="h-7 w-7 text-foreground/80" />
        </div>
        <h2 className="mt-2 text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-1 max-w-xs text-center text-sm text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
