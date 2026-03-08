import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { WizardStepProps } from "./shared";

const DISPLAY_FONT = "'Instrument Serif', Georgia, serif";

export function WelcomeStep({ onNext }: WizardStepProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-8">
      <motion.p
        className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground/50"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.0 }}
      >
        Welcome to
      </motion.p>

      <motion.h1
        className="text-center italic"
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: "clamp(64px, 10vw, 96px)",
          lineHeight: 1,
          color: "oklch(0.65 0.22 25)",
        }}
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.06 }}
      >
        Harnss
      </motion.h1>

      <motion.p
        className="mt-7 max-w-md text-center text-lg leading-relaxed text-muted-foreground"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        The workspace where you and AI
        <br />
        build software together.
      </motion.p>

      <motion.button
        onClick={onNext}
        className="mt-14 flex items-center gap-2.5 rounded-full bg-foreground px-9 py-4 text-base font-semibold text-background transition-opacity hover:opacity-85"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.34 }}
      >
        Get Started
        <ArrowRight className="h-4.5 w-4.5" />
      </motion.button>
    </div>
  );
}
