import { memo } from "react";
import { motion } from "motion/react";
import { ArrowRight, FolderOpen } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────

const EASE_OUT: [number, number, number, number] = [0.22, 0.68, 0, 1];
const DISPLAY_FONT = "'Instrument Serif', Georgia, serif";

// ── Ambient Gradient Orbs ─────────────────────────────────────────────

function AmbientOrbs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute -top-[25%] -right-[15%] h-[65%] w-[55%] rounded-full opacity-[0.035] blur-[100px]"
        style={{ background: "radial-gradient(circle, var(--foreground) 0%, transparent 70%)" }}
        animate={{ x: [0, -30, 15, 0], y: [0, 20, -15, 0] }}
        transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-[20%] -left-[20%] h-[55%] w-[50%] rounded-full opacity-[0.025] blur-[120px]"
        style={{ background: "radial-gradient(circle, var(--foreground) 0%, transparent 70%)" }}
        animate={{ x: [0, 30, -20, 0], y: [0, -25, 12, 0] }}
        transition={{ duration: 35, repeat: Infinity, ease: "easeInOut" }}
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

// ── Skeleton Chat — realistic conversation ghost ──────────────────────

interface SkeletonMsg {
  role: "user" | "assistant";
  lines: number[];
  hasCodeBlock?: boolean;
  hasToolUse?: boolean;
  delay: number;
}

const SKELETON_MESSAGES: SkeletonMsg[] = [
  { role: "user", lines: [80, 55], delay: 0.2 },
  { role: "assistant", lines: [95, 85, 60], hasToolUse: true, delay: 0.35 },
  { role: "user", lines: [65], delay: 0.5 },
  { role: "assistant", lines: [90, 75], hasCodeBlock: true, delay: 0.65 },
  { role: "user", lines: [50, 40], delay: 0.8 },
  { role: "assistant", lines: [88, 70, 45], delay: 0.95 },
];

function SkeletonChat() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-10">
      <div className="flex w-full max-w-lg flex-col gap-4">
        {SKELETON_MESSAGES.map((msg, i) => (
          <motion.div
            key={i}
            className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: msg.delay, duration: 0.5, ease: EASE_OUT }}
          >
            <div
              className={`mt-1 h-6 w-6 shrink-0 rounded-full ${
                msg.role === "user"
                  ? "bg-foreground/[0.05]"
                  : "skeleton-line bg-foreground/[0.04]"
              }`}
              style={msg.role === "assistant" ? { animationDelay: `${i * 0.3}s` } : undefined}
            />
            <div
              className={`flex min-w-0 flex-1 flex-col gap-1.5 rounded-2xl px-4 py-3 ${
                msg.role === "user"
                  ? "ms-12 bg-foreground/[0.025] ring-1 ring-foreground/[0.04]"
                  : "me-8 bg-muted/20 ring-1 ring-border/20"
              }`}
            >
              {msg.lines.map((w, j) => (
                <div
                  key={j}
                  className="skeleton-line h-[5px] rounded-full bg-foreground/[0.05]"
                  style={{
                    width: `${w}%`,
                    animationDelay: `${i * 0.3 + j * 0.12}s`,
                  }}
                />
              ))}

              {msg.hasToolUse && (
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border/15 bg-foreground/[0.015] px-3 py-2">
                  <div className="skeleton-line h-3 w-3 rounded-sm bg-foreground/[0.06]" style={{ animationDelay: `${i * 0.3 + 0.5}s` }} />
                  <div className="skeleton-line h-[5px] w-20 rounded-full bg-foreground/[0.05]" style={{ animationDelay: `${i * 0.3 + 0.6}s` }} />
                  <div className="skeleton-line ms-auto h-[5px] w-8 rounded-full bg-foreground/[0.04]" style={{ animationDelay: `${i * 0.3 + 0.7}s` }} />
                </div>
              )}

              {msg.hasCodeBlock && (
                <div className="mt-1.5 rounded-lg border border-border/15 bg-foreground/[0.015] p-3">
                  <div className="flex flex-col gap-1.5">
                    <div className="skeleton-line h-[5px] w-[70%] rounded-full bg-foreground/[0.05]" style={{ animationDelay: `${i * 0.3 + 0.5}s` }} />
                    <div className="skeleton-line h-[5px] w-[90%] rounded-full bg-foreground/[0.04]" style={{ animationDelay: `${i * 0.3 + 0.6}s` }} />
                    <div className="skeleton-line h-[5px] w-[55%] rounded-full bg-foreground/[0.05]" style={{ animationDelay: `${i * 0.3 + 0.7}s` }} />
                    <div className="skeleton-line h-[5px] w-[40%] rounded-full bg-foreground/[0.04]" style={{ animationDelay: `${i * 0.3 + 0.8}s` }} />
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Sidebar Arrow — absolutely positioned from left edge to center ─────

/** Sweeping hand-drawn arrow that stretches from the left edge of the chat
 *  panel (the sidebar boundary) to roughly center-screen where the title sits.
 *  Placed as a direct child of the outer `relative` container so the arrow
 *  tip can sit on the sidebar boundary while the tail starts beneath the
 *  centered caption. */
function SidebarArrow() {
  // Matches the hand-drawn reference more closely:
  // tail on the right, long sweep underneath, then a sharper rise into the sidebar.
  const curvePath = [
    "M 660 104",
    "C 760 122, 790 235, 720 272",
    "C 635 318, 470 312, 330 258",
    "C 210 212, 110 136, 18 18",
  ].join(" ");

  const arrowHead = "M 72 44 L 18 18 L 44 74";

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
        className="pointer-events-none absolute inset-x-0 z-[2] h-[360px]"
        style={{ top: "calc(50% - 42px)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.4 }}
      >
        <svg
          viewBox="0 0 900 360"
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

  // --- No projects state ---
  if (!hasProjects) {
    return (
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden">
        <AmbientOrbs />
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
      <AmbientOrbs />
      <GrainOverlay />

      {/* Skeleton chat ghost */}
      <SkeletonChat />

      {/* Radial vignette — fades skeleton toward edges, focuses center */}
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background: "radial-gradient(ellipse 65% 50% at 50% 50%, transparent 0%, var(--background) 100%)",
        }}
      />

      {/* Hand-drawn arrow from center to sidebar edge */}
      <SidebarArrow />

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
            <h1
              className="text-5xl italic"
              style={{ fontFamily: DISPLAY_FONT, color: "oklch(0.62 0.18 185)" }}
            >
              Continue building
            </h1>
            <p className="max-w-[320px] text-center text-base leading-relaxed text-muted-foreground">
              Pick up an existing thread or start fresh.
            </p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
});
