import { motion } from "motion/react";
import { AgentStore } from "@/components/settings/AgentStore";
import type { AgentsStepProps } from "./shared";

const DISPLAY_FONT = "'Instrument Serif', Georgia, serif";

export function AgentsStep({
  agents,
  onSaveAgent,
  onDeleteAgent,
}: AgentsStepProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Heading */}
      <motion.div
        className="shrink-0 px-8 pt-10 pb-4 text-center"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h2
          className="text-5xl italic"
          style={{
            fontFamily: DISPLAY_FONT,
            color: "oklch(0.58 0.20 270)",
          }}
        >
          Connect agents
        </h2>
        <p className="mt-3 text-lg text-muted-foreground">
          Browse the store and add ACP agents with one click.
          <br />
          <span className="text-muted-foreground/60">
            Claude Code and Codex are already built in.
          </span>
        </p>
      </motion.div>

      {/* Agent Store — fills remaining space with its own scroll */}
      <motion.div
        className="min-h-0 flex-1"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
      >
        <AgentStore
          installedAgents={agents}
          onInstall={onSaveAgent}
          onUninstall={onDeleteAgent}
        />
      </motion.div>
    </div>
  );
}
