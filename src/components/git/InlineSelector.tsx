import { useState, useRef, useMemo, useCallback } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { ChevronDown, Check } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? (value || "Select…"),
    [options, value],
  );

  const closeDropdown = useCallback(() => setOpen(false), []);
  useClickOutside(ref, closeDropdown, open);

  const isDisabled = disabled || options.length === 0;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !isDisabled && setOpen(!open)}
        disabled={isDisabled}
        className={`flex w-full items-center gap-1.5 rounded-md border border-foreground/[0.08] bg-foreground/[0.03] px-2 py-1 text-[11px] transition-colors hover:border-foreground/[0.12] hover:bg-foreground/[0.05] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${className ?? ""}`}
      >
        <span className="min-w-0 truncate font-medium text-foreground/75">{selectedLabel}</span>
        <ChevronDown className={`ms-auto h-3 w-3 shrink-0 text-foreground/30 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-lg border border-foreground/[0.1] bg-[var(--background)] shadow-xl">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`flex w-full items-center gap-1.5 px-3 py-1 text-[11px] transition-colors hover:bg-foreground/[0.05] cursor-pointer ${
                  isSelected ? "text-foreground/90" : "text-foreground/60"
                }`}
              >
                {isSelected ? (
                  <Check className="h-3 w-3 shrink-0 text-emerald-600/80 dark:text-emerald-300/80" />
                ) : (
                  <span className="h-3 w-3 shrink-0" />
                )}
                <span className="min-w-0 truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
