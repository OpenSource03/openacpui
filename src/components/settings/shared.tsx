/**
 * Shared components and constants for settings panels.
 * Extracted to avoid duplication across AdvancedSettings, GeneralSettings,
 * AppearanceSettings, NotificationsSettings, AnalyticsSettings, and AboutSettings.
 */

import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Consistent header for the top of every settings panel: title + optional description. */
export const SettingsHeader = memo(function SettingsHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="border-b border-foreground/[0.06] px-6 py-4">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description && (
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
});

/** Labeled section divider within a settings panel. First section should pass `first` to omit the top border. */
export const SettingsSection = memo(function SettingsSection({
  icon: Icon,
  label,
  children,
  first,
}: {
  icon?: LucideIcon;
  label: string;
  children: React.ReactNode;
  /** When true, omits the top border (used for the first section in a panel). */
  first?: boolean;
}) {
  return (
    <div className={`py-3 ${first ? "" : "border-t border-foreground/[0.04]"}`}>
      <div className="mb-1 flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
});

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

/** Radix-based select matching the BranchPicker visual style. Generic over the option value type. */
export function SettingsSelect<T extends string>({
  value,
  onValueChange,
  options,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as T)}>
      <SelectTrigger size="sm" className={`text-foreground/80 ${className ?? ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
