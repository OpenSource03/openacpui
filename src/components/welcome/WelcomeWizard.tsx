import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ThemeOption, InstalledAgent } from "@/types";
import { WIZARD_STEPS, WELCOME_COMPLETED_KEY, springTransition } from "./shared";
import { StepIndicator } from "./StepIndicator";
import { WelcomeStep } from "./WelcomeStep";
import { AppearanceStep } from "./AppearanceStep";
import { PermissionsStep } from "./PermissionsStep";
import { ProjectStep } from "./ProjectStep";
import { AgentsStep } from "./AgentsStep";
import { FeatureTourStep } from "./FeatureTourStep";
import { ReadyStep } from "./ReadyStep";

// ── Props ──

interface WelcomeWizardProps {
  theme: ThemeOption;
  onThemeChange: (t: ThemeOption) => void;
  islandLayout: boolean;
  onIslandLayoutChange: (enabled: boolean) => void;
  autoGroupTools: boolean;
  onAutoGroupToolsChange: (enabled: boolean) => void;
  autoExpandTools: boolean;
  onAutoExpandToolsChange: (enabled: boolean) => void;
  transparency: boolean;
  onTransparencyChange: (enabled: boolean) => void;
  glassSupported: boolean;
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  onCreateProject: () => void;
  hasProjects: boolean;
  agents: InstalledAgent[];
  onSaveAgent: (agent: InstalledAgent) => Promise<{ ok?: boolean; error?: string }>;
  onDeleteAgent: (id: string) => Promise<{ ok?: boolean; error?: string }>;
  onComplete: () => void;
}

// ── Step transition variants ──

const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 200 : -200,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -200 : 200,
    opacity: 0,
  }),
};

export function WelcomeWizard({
  theme,
  onThemeChange,
  islandLayout,
  onIslandLayoutChange,
  autoGroupTools,
  onAutoGroupToolsChange,
  autoExpandTools,
  onAutoExpandToolsChange,
  transparency,
  onTransparencyChange,
  glassSupported,
  permissionMode,
  onPermissionModeChange,
  onCreateProject,
  hasProjects,
  agents,
  onSaveAgent,
  onDeleteAgent,
  onComplete,
}: WelcomeWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [isExiting, setIsExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const stepId = WIZARD_STEPS[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === WIZARD_STEPS.length - 1;

  const goNext = useCallback(() => {
    if (isLast) return;
    setDirection(1);
    setCurrentStep((s) => s + 1);
  }, [isLast]);

  const goBack = useCallback(() => {
    if (isFirst) return;
    setDirection(-1);
    setCurrentStep((s) => s - 1);
  }, [isFirst]);

  const skip = useCallback(() => {
    localStorage.setItem(WELCOME_COMPLETED_KEY, "true");
    onComplete();
  }, [onComplete]);

  // Cinematic exit — scale up + dissolve, then complete
  const finish = useCallback(() => {
    if (isExiting) return;
    setIsExiting(true);
    localStorage.setItem(WELCOME_COMPLETED_KEY, "true");
    exitTimerRef.current = setTimeout(() => {
      onComplete();
    }, 420);
  }, [onComplete, isExiting]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") skip();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [skip]);

  const stepProps = { onNext: goNext, onBack: goBack, onSkip: skip };

  // When island layout is active, the wizard itself becomes an island with
  // margins and the glass border shine — matching the rest of the app.
  // The outer container uses an inline opaque background to prevent glass
  // transparency from bleeding through (--sidebar is transparent in glass mode).
  const outerClass = islandLayout
    ? "fixed inset-0 z-50 flex p-[var(--island-gap)]"
    : "fixed inset-0 z-50 flex";

  const innerClass = islandLayout
    ? "island relative flex flex-1 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
    : "relative flex flex-1 flex-col overflow-hidden bg-background";

  return (
    <motion.div
      className={outerClass}
      style={{
        fontFamily: "'Sora', system-ui, sans-serif",
        // Force opaque background — in glass mode bg-sidebar is transparent,
        // but the wizard overlay must always be fully opaque.
        background: islandLayout ? "var(--background)" : undefined,
      }}
      animate={
        isExiting
          ? { opacity: 0, scale: 1.04 }
          : { opacity: 1, scale: 1 }
      }
      transition={
        isExiting
          ? { duration: 0.4, ease: [0.4, 0, 0.2, 1] }
          : { duration: 0 }
      }
    >
      <div className={innerClass}>
        {/* Drag region for window dragging */}
        <div className="drag-region h-8 shrink-0" />

        {/* Step content */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={stepId}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springTransition}
              className="absolute inset-0 flex flex-col"
            >
              {stepId === "welcome" && <WelcomeStep {...stepProps} />}
              {stepId === "appearance" && (
                <AppearanceStep
                  {...stepProps}
                  theme={theme}
                  onThemeChange={onThemeChange}
                  islandLayout={islandLayout}
                  onIslandLayoutChange={onIslandLayoutChange}
                  autoGroupTools={autoGroupTools}
                  onAutoGroupToolsChange={onAutoGroupToolsChange}
                  autoExpandTools={autoExpandTools}
                  onAutoExpandToolsChange={onAutoExpandToolsChange}
                  transparency={transparency}
                  onTransparencyChange={onTransparencyChange}
                  glassSupported={glassSupported}
                />
              )}
              {stepId === "permissions" && (
                <PermissionsStep
                  {...stepProps}
                  permissionMode={permissionMode}
                  onPermissionModeChange={onPermissionModeChange}
                />
              )}
              {stepId === "project" && (
                <ProjectStep
                  {...stepProps}
                  onCreateProject={onCreateProject}
                  hasProjects={hasProjects}
                />
              )}
              {stepId === "agents" && (
                <AgentsStep
                  {...stepProps}
                  agents={agents}
                  onSaveAgent={onSaveAgent}
                  onDeleteAgent={onDeleteAgent}
                />
              )}
              {stepId === "tour" && <FeatureTourStep {...stepProps} />}
              {stepId === "ready" && (
                <ReadyStep
                  theme={theme}
                  permissionMode={permissionMode}
                  onComplete={finish}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Bottom navigation */}
        <div className="flex shrink-0 items-center justify-between px-10 pb-8 pt-4">
          <div className="flex w-20 items-center">
            {isFirst ? (
              <button
                onClick={skip}
                className="text-sm text-muted-foreground/50 transition-colors hover:text-muted-foreground"
              >
                Skip
              </button>
            ) : !isLast ? (
              <button
                onClick={goBack}
                className="flex items-center gap-1 text-sm text-muted-foreground/50 transition-colors hover:text-muted-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>
            ) : null}
          </div>

          <StepIndicator currentStep={currentStep} />

          <div className="flex w-20 items-center justify-end">
            {!isFirst && !isLast && (
              <button
                onClick={goNext}
                className="flex items-center gap-1 text-sm font-medium text-foreground/60 transition-colors hover:text-foreground"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
