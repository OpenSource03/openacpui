import { motion } from "motion/react";
import { Shield, ShieldCheck, ShieldOff, Check } from "lucide-react";
import { PERMISSION_MODES, type PermissionsStepProps } from "./shared";

const ICON_MAP = { Shield, ShieldCheck, ShieldOff } as const;

export function PermissionsStep({
  permissionMode,
  onPermissionModeChange,
}: PermissionsStepProps) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-8">
      <div className="m-auto flex w-full max-w-lg flex-col py-10">
        {/* Heading */}
        <motion.div
          className="mb-10 text-center"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h2
            className="text-5xl italic"
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              color: "oklch(0.62 0.20 155)",
            }}
          >
            Your rules
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            Set how much freedom Claude gets. Change this anytime.
          </p>
        </motion.div>

        {/* Permission cards */}
        <div className="flex flex-col gap-3">
          {PERMISSION_MODES.map((mode, i) => {
            const isSelected = permissionMode === mode.id;
            const Icon = ICON_MAP[mode.icon];

            return (
              <motion.button
                key={mode.id}
                onClick={() => onPermissionModeChange(mode.id)}
                className={`flex items-center gap-4 rounded-xl border-2 px-5 py-4 text-start transition-all ${
                  isSelected
                    ? "border-foreground/80 bg-foreground/[0.05]"
                    : "border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.06]"
                }`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.06 + i * 0.06 }}
              >
                {/* Icon */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06]">
                  <Icon className="h-5 w-5 text-foreground/60" />
                </div>

                {/* Text */}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">
                    {mode.label}
                  </div>
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {mode.description}
                  </div>
                </div>

                {/* Check indicator */}
                {isSelected && (
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground">
                    <Check className="h-3 w-3 text-background" />
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
