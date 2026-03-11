/**
 * Shared components and constants for settings panels.
 * Extracted to avoid duplication across AdvancedSettings, GeneralSettings,
 * AppearanceSettings, and NotificationsSettings.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

/** Radix-based select matching the BranchPicker visual style. */
export function SettingsSelect({
  value,
  onValueChange,
  options,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
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
