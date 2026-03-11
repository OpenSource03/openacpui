import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SelectorOption } from "./git-panel-utils";

export function InlineSelector({
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectorOption[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || options.length === 0}>
      <SelectTrigger
        size="sm"
        className={`w-full text-[11px] text-foreground/80 ${className ?? ""}`}
      >
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-xs">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
