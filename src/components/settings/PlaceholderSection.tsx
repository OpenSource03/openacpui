import type { LucideIcon } from "lucide-react";

interface PlaceholderSectionProps {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Show a "Coming Soon" badge above the title */
  comingSoon?: boolean;
}

export function PlaceholderSection({ title, description, icon: Icon, comingSoon }: PlaceholderSectionProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
          <Icon className="h-7 w-7 text-foreground/80" />
        </div>
        {comingSoon && (
          <span className="mt-1 inline-flex rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">
            Coming Soon
          </span>
        )}
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-1 max-w-xs text-center text-sm text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
