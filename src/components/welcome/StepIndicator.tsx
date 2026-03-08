import { motion } from "motion/react";
import { WIZARD_STEPS } from "./shared";

interface StepIndicatorProps {
  currentStep: number;
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-1.5">
      {WIZARD_STEPS.map((_, index) => {
        const isActive = index === currentStep;
        const isPast = index < currentStep;

        return (
          <motion.div
            key={index}
            layout
            className="h-1.5 rounded-full bg-foreground"
            initial={false}
            animate={{
              width: isActive ? 24 : 6,
              opacity: isPast ? 0.5 : isActive ? 0.8 : 0.15,
            }}
            transition={{ type: "spring", damping: 28, stiffness: 350 }}
          />
        );
      })}
    </div>
  );
}
