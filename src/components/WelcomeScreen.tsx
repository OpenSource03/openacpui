import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { motion } from "motion/react";
import { ArrowRight, FolderOpen } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────

const EASE_OUT: [number, number, number, number] = [0.22, 0.68, 0, 1];
const DISPLAY_FONT = "'Instrument Serif', Georgia, serif";
const SIDEBAR_ARROW_HEIGHT = 360;
const SIDEBAR_ARROW_TIP_INSET = 18;
const SIDEBAR_ARROW_BASE_SPAN = 642;
const SIDEBAR_ARROW_TAIL_GAP = 36;
const SIDEBAR_ARROW_HEAD_LENGTH = 34;
const SIDEBAR_ARROW_HEAD_SPREAD = 19;

type TimeBucket = "lateNight" | "morning" | "afternoon" | "evening";

interface ContinueMessage {
  headline: string;
  subtitle: string;
  accent: string;
}

const ANYTIME_CONTINUE_MESSAGES: readonly ContinueMessage[] = [
  {
    headline: "Continue building",
    subtitle: "Your threads are warm. Pick one and keep shipping.",
    accent: "oklch(0.62 0.18 185)",
  },
  {
    headline: "Welcome back",
    subtitle: "The repo missed you for several whole seconds.",
    accent: "oklch(0.66 0.16 32)",
  },
  {
    headline: "Back at it, menace",
    subtitle: "Choose a thread and apply tasteful chaos.",
    accent: "oklch(0.7 0.17 145)",
  },
  {
    headline: "One more tiny change",
    subtitle: "Famous last words. Your threads are waiting.",
    accent: "oklch(0.72 0.14 260)",
  },
];

const TIME_AWARE_CONTINUE_MESSAGES: Record<TimeBucket, readonly ContinueMessage[]> = {
  lateNight: [
    {
      headline: "Hello, night owl",
      subtitle: "Your best ideas and worst commit messages happen now.",
      accent: "oklch(0.7 0.15 250)",
    },
    {
      headline: "Midnight debug club",
      subtitle: "The stack trace is glowing gently in the dark.",
      accent: "oklch(0.68 0.18 290)",
    },
    {
      headline: "Moonlight merge pending",
      subtitle: "Pick up where you left off before the birds clock in.",
      accent: "oklch(0.74 0.13 215)",
    },
  ],
  morning: [
    {
      headline: "Good morning, builder",
      subtitle: "Fresh tab, fresh coffee, same huge TODO list.",
      accent: "oklch(0.76 0.16 78)",
    },
    {
      headline: "Rise and refactor",
      subtitle: "Your threads are awake before some of your teammates.",
      accent: "oklch(0.73 0.17 110)",
    },
    {
      headline: "Morning commit energy",
      subtitle: "Start with the easy win before the meetings find you.",
      accent: "oklch(0.78 0.15 48)",
    },
  ],
  afternoon: [
    {
      headline: "Welcome back, sunshine",
      subtitle: "Prime hour for turning half-finished ideas into features.",
      accent: "oklch(0.74 0.18 58)",
    },
    {
      headline: "Afternoon sprint mode",
      subtitle: "The code is warm and your threads are lined up.",
      accent: "oklch(0.68 0.19 28)",
    },
    {
      headline: "Post-lunch patch attack",
      subtitle: "Pick a thread and make the roadmap more believable.",
      accent: "oklch(0.75 0.16 135)",
    },
  ],
  evening: [
    {
      headline: "Evening shift engaged",
      subtitle: "Quiet hours. Strong focus. Mild gremlin energy.",
      accent: "oklch(0.67 0.17 15)",
    },
    {
      headline: "Twilight build session",
      subtitle: "A nice time to ship something clever and unnecessary.",
      accent: "oklch(0.69 0.18 335)",
    },
    {
      headline: "Welcome back after hours",
      subtitle: "Your threads are ready for that definitely quick check-in.",
      accent: "oklch(0.72 0.15 210)",
    },
  ],
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function rotateVector(x: number, y: number, radians: number) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

function getTimeBucket(date: Date): TimeBucket {
  const hour = date.getHours();
  if (hour < 5) {
    return "lateNight";
  }
  if (hour < 12) {
    return "morning";
  }
  if (hour < 18) {
    return "afternoon";
  }
  return "evening";
}

function pickRandomMessage(
  messages: readonly ContinueMessage[],
  previous?: ContinueMessage,
): ContinueMessage {
  if (messages.length === 1) {
    return messages[0];
  }

  let nextMessage = messages[Math.floor(Math.random() * messages.length)];
  if (!previous) {
    return nextMessage;
  }

  let attempts = 0;
  while (
    attempts < 6 &&
    nextMessage.headline === previous.headline &&
    nextMessage.subtitle === previous.subtitle
  ) {
    nextMessage = messages[Math.floor(Math.random() * messages.length)];
    attempts += 1;
  }

  return nextMessage;
}

function getContinueMessage(previous?: ContinueMessage): ContinueMessage {
  const now = new Date();
  const bucket = getTimeBucket(now);
  return pickRandomMessage(
    [...TIME_AWARE_CONTINUE_MESSAGES[bucket], ...ANYTIME_CONTINUE_MESSAGES],
    previous,
  );
}

// ── Ambient Background ───────────────────────────────────────────────

function AmbientBackground({ accent }: { accent?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Central accent halo — slow breathe tied to the greeting's mood color */}
      <motion.div
        className="absolute top-1/2 left-1/2 h-[70%] w-[60%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: accent
            ? `radial-gradient(ellipse 50% 50% at 50% 50%, ${accent} 0%, transparent 70%)`
            : "radial-gradient(ellipse 50% 50% at 50% 50%, var(--foreground) 0%, transparent 70%)",
          opacity: 0.06,
        }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.06, 0.08, 0.06] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Drifting orb — top-right, very faint */}
      <motion.div
        className="absolute -top-[15%] -right-[10%] h-[45%] w-[40%] rounded-full opacity-[0.025] blur-[140px]"
        style={{ background: "radial-gradient(circle, var(--foreground) 0%, transparent 70%)" }}
        animate={{ x: [0, -20, 10, 0], y: [0, 15, -10, 0] }}
        transition={{ duration: 40, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

// ── Noise Grain Overlay ───────────────────────────────────────────────

function GrainOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.015] mix-blend-overlay"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        backgroundRepeat: "repeat",
        backgroundSize: "128px 128px",
      }}
    />
  );
}

// ── Sidebar Arrow — absolutely positioned from left edge to center ─────

/** Sweeping hand-drawn arrow that stretches from the left edge of the chat
 *  panel (the sidebar boundary) to roughly center-screen where the title sits.
 *  Placed as a direct child of the outer `relative` container so the arrow
 *  tip can sit on the sidebar boundary while the tail starts beneath the
 *  centered caption. */
interface SidebarArrowProps {
  anchorRef: RefObject<HTMLElement | null>;
}

function SidebarArrow({ anchorRef }: SidebarArrowProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState({ svgWidth: 900, tailX: 660 });

  useEffect(() => {
    const container = containerRef.current;
    const anchor = anchorRef.current;
    if (!container || !anchor) {
      return;
    }

    const updateMetrics = () => {
      const containerRect = container.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const nextWidth = Math.max(containerRect.width, 1);
      const maxTailX = Math.max(nextWidth - 24, SIDEBAR_ARROW_TIP_INSET + 120);
      const minTailX = Math.min(660, maxTailX);
      const anchoredTailX =
        anchorRect.right - containerRect.left + SIDEBAR_ARROW_TAIL_GAP;
      const nextTailX = clamp(anchoredTailX, minTailX, maxTailX);

      setMetrics((prevMetrics) => {
        const widthChanged = Math.abs(prevMetrics.svgWidth - nextWidth) >= 1;
        const tailChanged = Math.abs(prevMetrics.tailX - nextTailX) >= 1;
        if (!widthChanged && !tailChanged) {
          return prevMetrics;
        }
        return { svgWidth: nextWidth, tailX: nextTailX };
      });
    };

    updateMetrics();

    const observer = new ResizeObserver(() => {
      updateMetrics();
    });

    observer.observe(container);
    observer.observe(anchor);

    const fontReady = document.fonts?.ready;
    if (fontReady) {
      void fontReady.then(() => {
        updateMetrics();
      });
    }

    window.addEventListener("resize", updateMetrics);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateMetrics);
    };
  }, [anchorRef]);

  const usableWidth = Math.max(metrics.svgWidth, 1);
  const tipX = SIDEBAR_ARROW_TIP_INSET;
  const tailX = metrics.tailX;
  const span = Math.max(tailX - tipX, 1);
  const scaleX = (offset: number) => tipX + (offset / SIDEBAR_ARROW_BASE_SPAN) * span;
  const endPoint = { x: tipX, y: 18 };
  const endControlPoint = { x: scaleX(92), y: 136 };

  // Keep the tip pinned near the sidebar while the sweep length expands.
  const curvePath = [
    `M ${tailX.toFixed(2)} 104`,
    `C ${scaleX(742).toFixed(2)} 122, ${scaleX(772).toFixed(2)} 235, ${scaleX(702).toFixed(2)} 272`,
    `C ${scaleX(617).toFixed(2)} 318, ${scaleX(452).toFixed(2)} 312, ${scaleX(312).toFixed(2)} 258`,
    `C ${scaleX(192).toFixed(2)} 212, ${endControlPoint.x.toFixed(2)} 136, ${endPoint.x} ${endPoint.y}`,
  ].join(" ");

  const tangentX = endPoint.x - endControlPoint.x;
  const tangentY = endPoint.y - endControlPoint.y;
  const tangentLength = Math.hypot(tangentX, tangentY) || 1;
  const unitTangentX = tangentX / tangentLength;
  const unitTangentY = tangentY / tangentLength;
  const headLength = clamp(span * 0.055, SIDEBAR_ARROW_HEAD_LENGTH, 48);
  const headSpread = clamp(headLength * 0.56, SIDEBAR_ARROW_HEAD_SPREAD, 26);
  const baseCenter = {
    x: endPoint.x - unitTangentX * headLength,
    y: endPoint.y - unitTangentY * headLength,
  };
  const upperWingDirection = rotateVector(unitTangentX, unitTangentY, Math.PI / 2);
  const lowerWingDirection = rotateVector(unitTangentX, unitTangentY, -Math.PI / 2);
  const upperWing = {
    x: baseCenter.x + upperWingDirection.x * headSpread,
    y: baseCenter.y + upperWingDirection.y * headSpread,
  };
  const lowerWing = {
    x: baseCenter.x + lowerWingDirection.x * headSpread,
    y: baseCenter.y + lowerWingDirection.y * headSpread,
  };
  const arrowHead = [
    `M ${upperWing.x.toFixed(2)} ${upperWing.y.toFixed(2)}`,
    `L ${endPoint.x} ${endPoint.y}`,
    `L ${lowerWing.x.toFixed(2)} ${lowerWing.y.toFixed(2)}`,
  ].join(" ");

  return (
    <>
      {/* Label */}
      <motion.div
        className="pointer-events-none absolute left-0 z-[3] w-full text-center"
        style={{ top: "calc(50% + 48px)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.6, duration: 0.4 }}
      >
        <span
          className="italic text-foreground/[0.16]"
          style={{ fontFamily: DISPLAY_FONT, fontSize: "17px" }}
        >
          your threads are in the sidebar
        </span>
      </motion.div>

      {/* Arrow */}
      <motion.div
        ref={containerRef}
        className="pointer-events-none absolute inset-x-0 z-[2] h-[360px]"
        style={{ top: "calc(50% - 42px)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.4 }}
      >
        <svg
          viewBox={`0 0 ${usableWidth} ${SIDEBAR_ARROW_HEIGHT}`}
          preserveAspectRatio="none"
          fill="none"
          className="h-full w-full text-foreground/[0.16]"
        >
          <motion.path
            d={curvePath}
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.7, duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
          />
          <motion.path
            d={arrowHead}
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.85, duration: 0.2 }}
          />
        </svg>
      </motion.div>
    </>
  );
}

// ── Main Component ────────────────────────────────────────────────────

interface WelcomeScreenProps {
  hasProjects: boolean;
  onCreateProject: () => void;
}

export const WelcomeScreen = memo(function WelcomeScreen({
  hasProjects,
  onCreateProject,
}: WelcomeScreenProps) {
  const subtitleRef = useRef<HTMLParagraphElement | null>(null);
  const [continueMessage, setContinueMessage] = useState<ContinueMessage>(() =>
    getContinueMessage(),
  );

  useEffect(() => {
    if (!hasProjects) {
      return;
    }

    let refreshTimer: number | null = null;

    function queueNextRefresh() {
      const now = new Date();
      const nextHour = new Date(now);
      nextHour.setHours(now.getHours() + 1, 0, 0, 0);
      const delay = Math.max(nextHour.getTime() - now.getTime(), 60_000);
      refreshTimer = window.setTimeout(() => {
        setContinueMessage((previous) => getContinueMessage(previous));
        queueNextRefresh();
      }, delay);
    }

    function rerollMessage() {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      setContinueMessage((previous) => getContinueMessage(previous));
      queueNextRefresh();
    }

    function handleVisibilityChange() {
      if (!document.hidden) {
        rerollMessage();
      }
    }

    queueNextRefresh();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasProjects]);

  // --- No projects state ---
  if (!hasProjects) {
    return (
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden">
        <AmbientBackground />
        <GrainOverlay />

        <motion.div
          className="relative z-10 flex flex-col items-center gap-8 px-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
        >
          <motion.div
            className="flex flex-col items-center gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
          >
            <h1
              className="text-5xl italic"
              style={{ fontFamily: DISPLAY_FONT, color: "oklch(0.65 0.22 25)" }}
            >
              Open a project
            </h1>
            <p className="max-w-[300px] text-center text-base leading-relaxed text-muted-foreground">
              Choose a folder to anchor your sessions, tools, and file context.
            </p>
          </motion.div>

          <motion.button
            onClick={onCreateProject}
            className="group flex items-center gap-2.5 rounded-full bg-foreground px-8 py-3.5 text-base font-semibold text-background transition-opacity hover:opacity-85"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            <FolderOpen className="h-4 w-4" />
            Choose folder
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // --- Has projects, no active session ---
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Hand-drawn arrow from center to sidebar edge */}
      <SidebarArrow anchorRef={subtitleRef} />

      {/* Central content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
        <motion.div
          className="flex flex-col items-center gap-6"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        >
          {/* Headline */}
          <motion.div
            className="flex flex-col items-center gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
          >
            <motion.h1
              key={continueMessage.headline}
              className="text-5xl italic"
              style={{ fontFamily: DISPLAY_FONT, color: continueMessage.accent }}
              initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.45, ease: EASE_OUT }}
            >
              {continueMessage.headline}
            </motion.h1>
            <motion.p
              key={continueMessage.subtitle}
              ref={subtitleRef}
              className="max-w-[min(92vw,640px)] text-center text-base leading-relaxed text-muted-foreground"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05, ease: EASE_OUT }}
            >
              {continueMessage.subtitle}
            </motion.p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
});
