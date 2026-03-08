import { motion } from "motion/react";
import {
  Terminal,
  GitBranch,
  Globe,
  FileText,
  FileDiff,
  FolderTree,
  Palette,
  Layers,
} from "lucide-react";
import { SHOWCASE_SPACES, SHOWCASE_TOOLS, getSpacePreviewBg } from "./shared";
import type { WizardStepProps } from "./shared";

const DISPLAY_FONT = "'Instrument Serif', Georgia, serif";

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Terminal,
  GitBranch,
  Globe,
  FileText,
  FileDiff,
  FolderTree,
};

export function FeatureTourStep(_props: WizardStepProps) {
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
              fontFamily: DISPLAY_FONT,
              color: "oklch(0.60 0.22 300)",
            }}
          >
            What&apos;s inside
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            A few things that make Harnss different.
          </p>
        </motion.div>

        {/* ── Spaces ── */}
        <motion.div
          className="mb-4 rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-6"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
        >
          <div className="mb-3 flex items-center gap-2.5">
            <Palette className="h-4.5 w-4.5 text-foreground/40" />
            <h3 className="text-sm font-semibold text-foreground">Spaces</h3>
          </div>
          <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
            Organize projects into color-coded workspaces. Each space tints the
            entire UI with its own hue.
          </p>
          <div className="flex items-center gap-4">
            {SHOWCASE_SPACES.map((space, i) => (
              <motion.div
                key={space.name}
                className="flex flex-col items-center gap-1.5"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.2 + i * 0.06 }}
              >
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{ background: getSpacePreviewBg(space.hue, space.chroma) }}
                >
                  <span className="text-base">{space.emoji}</span>
                </div>
                <span className="text-[10px] font-medium text-muted-foreground/60">
                  {space.name}
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ── Tool panels ── */}
        <motion.div
          className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-6"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.16 }}
        >
          <div className="mb-3 flex items-center gap-2.5">
            <Layers className="h-4.5 w-4.5 text-foreground/40" />
            <h3 className="text-sm font-semibold text-foreground">Tool Panels</h3>
          </div>
          <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
            Terminal, source control, browser, and more — integrated into the
            sidebar. Toggle them on and off as you work.
          </p>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3">
            {SHOWCASE_TOOLS.map((tool, i) => {
              const Icon = TOOL_ICONS[tool.icon];
              if (!Icon) return null;
              return (
                <motion.div
                  key={tool.id}
                  className="flex items-center gap-2"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.3 + i * 0.04 }}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground/[0.05]">
                    <Icon className="h-3.5 w-3.5 text-foreground/40" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {tool.label}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
