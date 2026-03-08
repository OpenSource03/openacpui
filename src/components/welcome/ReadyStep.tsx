import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { PERMISSION_MODES, type ReadyStepProps } from "./shared";

function themeLabel(theme: string): string {
  switch (theme) {
    case "dark":
      return "Dark";
    case "light":
      return "Light";
    case "system":
      return "System";
    default:
      return theme;
  }
}

export function ReadyStep({
  theme,
  permissionMode,
  onComplete,
}: ReadyStepProps) {
  const modeLabel =
    PERMISSION_MODES.find((m) => m.id === permissionMode)?.label ??
    permissionMode;

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-8">
      <motion.h2
        className="text-center text-7xl italic"
        style={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          color: "oklch(0.62 0.18 185)",
        }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
      >
        Ready to go
      </motion.h2>

      {/* Settings recap */}
      <motion.div
        className="mt-6 flex items-center gap-3"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        <span className="rounded-full bg-foreground/[0.06] px-3.5 py-1.5 text-sm font-medium text-foreground/60">
          {themeLabel(theme)} theme
        </span>
        <span className="text-muted-foreground/30">·</span>
        <span className="rounded-full bg-foreground/[0.06] px-3.5 py-1.5 text-sm font-medium text-foreground/60">
          {modeLabel}
        </span>
      </motion.div>

      <motion.button
        onClick={onComplete}
        className="mt-12 flex items-center gap-2.5 rounded-full bg-foreground px-8 py-3.5 text-base font-semibold text-background transition-opacity hover:opacity-85"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        Start building
        <ArrowRight className="h-4 w-4" />
      </motion.button>
    </div>
  );
}
