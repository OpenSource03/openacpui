import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { FolderOpen } from "lucide-react";
import type { ProjectStepProps } from "./shared";

export function ProjectStep({
  onNext,
  onCreateProject,
  hasProjects,
}: ProjectStepProps) {
  // Auto-advance when a project is successfully created
  const prevHasProjects = useRef(hasProjects);
  useEffect(() => {
    if (!prevHasProjects.current && hasProjects) {
      onNext();
    }
    prevHasProjects.current = hasProjects;
  }, [hasProjects, onNext]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-8">
      <motion.div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-foreground/[0.06]"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.05 }}
      >
        <FolderOpen className="h-8 w-8 text-foreground/60" />
      </motion.div>

      <motion.h2
        className="text-5xl italic"
        style={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          color: "oklch(0.68 0.18 70)",
        }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        Your first project
      </motion.h2>

      <motion.p
        className="mt-3 max-w-sm text-center text-lg text-muted-foreground"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.18 }}
      >
        Point Harnss at any folder and start building.
      </motion.p>

      <motion.button
        onClick={onCreateProject}
        className="mt-10 rounded-full bg-foreground px-8 py-3.5 text-base font-semibold text-background transition-opacity hover:opacity-85"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.28 }}
      >
        Choose folder
      </motion.button>

      <motion.button
        onClick={onNext}
        className="mt-4 text-sm text-muted-foreground/50 transition-colors hover:text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.38 }}
      >
        Skip for now
      </motion.button>
    </div>
  );
}
