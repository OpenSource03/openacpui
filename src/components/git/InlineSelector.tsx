import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const selected = options.find((opt) => opt.value === value) ?? options[0];
  const rootClass = [
    "flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-[11px] text-foreground/70 transition-colors hover:bg-foreground/[0.07] disabled:cursor-not-allowed disabled:opacity-40",
    className ?? "bg-foreground/[0.04]",
  ].join(" ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || options.length === 0}
          className={rootClass}
        >
          <span className="min-w-0 flex-1 truncate text-start">{selected?.label ?? "Select..."}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-foreground/25" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            className="cursor-pointer text-xs"
            onClick={() => onChange(opt.value)}
          >
            <span className="me-1.5 inline-flex w-3 items-center justify-center">
              {opt.value === selected?.value ? <Check className="h-3 w-3" /> : null}
            </span>
            <span className="truncate">{opt.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
