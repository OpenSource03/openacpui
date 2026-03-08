import { motion } from "motion/react";
import { Sun, Moon, Monitor, Blend } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { AppearanceStepProps } from "./shared";
import type { ThemeOption } from "@/types";

// ── Theme option data ──

const THEME_OPTIONS: {
  id: ThemeOption;
  label: string;
  icon: typeof Sun;
}[] = [
  { id: "dark", label: "Dark", icon: Moon },
  { id: "light", label: "Light", icon: Sun },
  { id: "system", label: "System", icon: Monitor },
];

// ── Mini UI mockup for theme cards ──

function ThemeMockup({ theme }: { theme: ThemeOption }) {
  const isDark = theme === "dark" || theme === "system";
  const bg = isDark ? "oklch(0.20 0 0)" : "oklch(0.97 0 0)";
  const side = isDark ? "oklch(0.16 0 0)" : "oklch(0.93 0 0)";
  const fg = isDark ? "oklch(0.80 0 0)" : "oklch(0.30 0 0)";
  const muted = isDark ? "oklch(0.32 0 0)" : "oklch(0.82 0 0)";

  return (
    <div
      className="mx-auto h-[52px] w-[84px] overflow-hidden rounded-lg border border-foreground/[0.06]"
      style={{ background: bg }}
    >
      <div className="flex h-full">
        <div className="flex w-5 shrink-0 flex-col gap-[3px] p-1" style={{ background: side }}>
          <div className="h-[3px] w-full rounded-full" style={{ background: muted }} />
          <div className="h-[3px] w-full rounded-full" style={{ background: fg }} />
          <div className="h-[3px] w-3/4 rounded-full" style={{ background: muted }} />
        </div>
        <div className="flex flex-1 flex-col gap-[3px] p-1.5">
          <div className="h-[3px] w-3/4 rounded-full" style={{ background: fg }} />
          <div className="h-[3px] w-1/2 rounded-full" style={{ background: muted }} />
          <div className="mt-auto h-2 w-full rounded" style={{ background: muted }} />
        </div>
      </div>
    </div>
  );
}

// ── Layout mockup — Islands (rounded, separated cards with gaps) ──

function IslandsMockup() {
  const shell = "oklch(0.16 0 0)";
  const card = "oklch(0.22 0 0)";
  const border = "oklch(0.32 0 0 / 0.5)";
  const line = "oklch(0.38 0 0)";
  const accent = "oklch(0.50 0.12 260)";

  return (
    <div
      className="mx-auto h-[56px] w-[96px] overflow-hidden rounded-lg border border-foreground/[0.06] p-[3px]"
      style={{ background: shell }}
    >
      <div className="flex h-full gap-[3px]">
        {/* Sidebar island */}
        <div
          className="flex w-[22px] shrink-0 flex-col gap-[2px] rounded-[4px] p-[3px]"
          style={{ background: card, border: `0.5px solid ${border}` }}
        >
          <div className="h-[2px] w-full rounded-full" style={{ background: line }} />
          <div className="h-[2px] w-full rounded-full" style={{ background: accent }} />
          <div className="h-[2px] w-3/4 rounded-full" style={{ background: line }} />
        </div>
        {/* Main island */}
        <div
          className="flex flex-1 flex-col gap-[2px] rounded-[4px] p-[3px]"
          style={{ background: card, border: `0.5px solid ${border}` }}
        >
          <div className="h-[2px] w-3/4 rounded-full" style={{ background: line }} />
          <div className="h-[2px] w-1/2 rounded-full" style={{ background: line }} />
          <div className="mt-auto h-[6px] w-full rounded-[2px]" style={{ background: `oklch(0.28 0 0)` }} />
        </div>
        {/* Right panel island */}
        <div
          className="flex w-[18px] shrink-0 flex-col gap-[2px] rounded-[4px] p-[2px]"
          style={{ background: card, border: `0.5px solid ${border}` }}
        >
          <div className="h-[2px] w-full rounded-full" style={{ background: line }} />
          <div className="h-[2px] w-full rounded-full" style={{ background: line }} />
        </div>
      </div>
    </div>
  );
}

// ── Layout mockup — Flat (edge-to-edge, no gaps, thin dividers) ──

function FlatMockup() {
  const bg = "oklch(0.20 0 0)";
  const side = "oklch(0.18 0 0)";
  const divider = "oklch(0.32 0 0)";
  const line = "oklch(0.38 0 0)";
  const accent = "oklch(0.50 0.12 260)";

  return (
    <div
      className="mx-auto h-[56px] w-[96px] overflow-hidden rounded-lg border border-foreground/[0.06]"
      style={{ background: bg }}
    >
      <div className="flex h-full">
        {/* Sidebar — no gap, divider line */}
        <div
          className="flex w-[22px] shrink-0 flex-col gap-[2px] p-[3px]"
          style={{ background: side, borderRight: `1px solid ${divider}` }}
        >
          <div className="h-[2px] w-full rounded-full" style={{ background: line }} />
          <div className="h-[2px] w-full rounded-full" style={{ background: accent }} />
          <div className="h-[2px] w-3/4 rounded-full" style={{ background: line }} />
        </div>
        {/* Main content */}
        <div className="flex flex-1 flex-col gap-[2px] p-[3px]">
          <div className="h-[2px] w-3/4 rounded-full" style={{ background: line }} />
          <div className="h-[2px] w-1/2 rounded-full" style={{ background: line }} />
          <div className="mt-auto h-[6px] w-full rounded-[2px]" style={{ background: `oklch(0.28 0 0)` }} />
        </div>
        {/* Right panel — divider line */}
        <div
          className="flex w-[18px] shrink-0 flex-col gap-[2px] p-[2px]"
          style={{ borderLeft: `1px solid ${divider}` }}
        >
          <div className="h-[2px] w-full rounded-full" style={{ background: line }} />
          <div className="h-[2px] w-full rounded-full" style={{ background: line }} />
        </div>
      </div>
    </div>
  );
}

export function AppearanceStep({
  theme,
  onThemeChange,
  islandLayout,
  onIslandLayoutChange,
  transparency,
  onTransparencyChange,
  glassSupported,
}: AppearanceStepProps) {
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
              color: "oklch(0.60 0.20 250)",
            }}
          >
            Make it yours
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            Pick your vibe. Everything updates live.
          </p>
        </motion.div>

        {/* ── Theme selection ── */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
        >
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
            Theme
          </div>
          <div className="grid grid-cols-3 gap-3">
            {THEME_OPTIONS.map((opt) => {
              const isSelected = theme === opt.id;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  onClick={() => onThemeChange(opt.id)}
                  className={`flex flex-col items-center gap-2.5 rounded-xl border-2 p-4 transition-all ${
                    isSelected
                      ? "border-foreground/80 bg-foreground/[0.05]"
                      : "border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.06]"
                  }`}
                >
                  <ThemeMockup theme={opt.id} />
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{opt.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* ── Layout toggle ── */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.16 }}
        >
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
            Layout
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onIslandLayoutChange(true)}
              className={`flex flex-col items-center gap-3 rounded-xl border-2 px-4 pb-4 pt-5 transition-all ${
                islandLayout
                  ? "border-foreground/80 bg-foreground/[0.05]"
                  : "border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.06]"
              }`}
            >
              <IslandsMockup />
              <div className="text-center">
                <div className="text-sm font-medium text-foreground">Islands</div>
                <div className="text-xs text-muted-foreground">Rounded, separated</div>
              </div>
            </button>
            <button
              onClick={() => onIslandLayoutChange(false)}
              className={`flex flex-col items-center gap-3 rounded-xl border-2 px-4 pb-4 pt-5 transition-all ${
                !islandLayout
                  ? "border-foreground/80 bg-foreground/[0.05]"
                  : "border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.06]"
              }`}
            >
              <FlatMockup />
              <div className="text-center">
                <div className="text-sm font-medium text-foreground">Flat</div>
                <div className="text-xs text-muted-foreground">Edge-to-edge</div>
              </div>
            </button>
          </div>
        </motion.div>

        {/* ── Transparency toggle ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.24 }}
        >
          <div className="flex items-center justify-between rounded-xl bg-foreground/[0.03] px-5 py-4">
            <div className="flex items-center gap-3">
              <Blend className="h-4.5 w-4.5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium text-foreground">
                  Window transparency
                </div>
                <div className="text-xs text-muted-foreground">
                  {glassSupported
                    ? "See your desktop through the window"
                    : "Not available on this platform"}
                </div>
              </div>
            </div>
            <Switch
              checked={transparency}
              onCheckedChange={onTransparencyChange}
              disabled={!glassSupported}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
