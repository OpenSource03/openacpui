/**
 * Shared components and constants for settings panels.
 * Extracted to avoid duplication across AdvancedSettings, GeneralSettings,
 * AppearanceSettings, and NotificationsSettings.
 */

/** Reusable row layout for a single setting: label+description on the left, control on the right. */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Standard class string for <select> dropdowns in settings panels. */
export const selectClass =
  "h-8 rounded-md border border-foreground/10 bg-background px-2 pe-7 text-sm text-foreground outline-none transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20";
