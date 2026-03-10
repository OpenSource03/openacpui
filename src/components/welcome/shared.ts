import type { ThemeOption, InstalledAgent } from "@/types";

// ── Step definitions ──

export const WIZARD_STEPS = [
  "welcome",
  "appearance",
  "permissions",
  "project",
  "agents",
  "tour",
  "ready",
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number];

export const WELCOME_COMPLETED_KEY = "harnss-welcome-completed";

// ── Step props ──

export interface WizardStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export interface AppearanceStepProps extends WizardStepProps {
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
}

export interface PermissionsStepProps extends WizardStepProps {
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
}

export interface ProjectStepProps extends WizardStepProps {
  onCreateProject: () => void;
  hasProjects: boolean;
}

export interface AgentsStepProps extends WizardStepProps {
  agents: InstalledAgent[];
  onSaveAgent: (agent: InstalledAgent) => Promise<{ ok?: boolean; error?: string }>;
  onDeleteAgent: (id: string) => Promise<{ ok?: boolean; error?: string }>;
}

export interface ReadyStepProps {
  theme: ThemeOption;
  permissionMode: string;
  onComplete: () => void;
}

// ── Permission mode data ──

export const PERMISSION_MODES = [
  {
    id: "default",
    label: "Ask Before Edits",
    description:
      "Claude asks for approval before making file changes or running commands.",
    icon: "Shield" as const,
  },
  {
    id: "acceptEdits",
    label: "Accept Edits",
    description:
      "File edits are auto-approved, commands still require confirmation.",
    icon: "ShieldCheck" as const,
  },
  {
    id: "bypassPermissions",
    label: "Allow All",
    description:
      "Everything runs automatically with no prompts.",
    icon: "ShieldOff" as const,
  },
] as const;

// ── Animation ──

export const springTransition = {
  type: "spring" as const,
  damping: 30,
  stiffness: 300,
  mass: 0.8,
};

// ── Space color showcase data ──

export interface SpaceShowcase {
  name: string;
  emoji: string;
  hue: number;
  chroma: number;
}

export const SHOWCASE_SPACES: SpaceShowcase[] = [
  { name: "Frontend", emoji: "🎨", hue: 260, chroma: 0.15 },
  { name: "API", emoji: "⚡", hue: 150, chroma: 0.15 },
  { name: "Mobile", emoji: "📱", hue: 340, chroma: 0.15 },
  { name: "DevOps", emoji: "🚀", hue: 45, chroma: 0.15 },
];

// ── Tool panel showcase data ──

export interface ToolShowcase {
  id: string;
  label: string;
  icon: string;
  description: string;
}

export const SHOWCASE_TOOLS: ToolShowcase[] = [
  { id: "terminal", label: "Terminal", icon: "Terminal", description: "Run commands and scripts" },
  { id: "git", label: "Source Control", icon: "GitBranch", description: "Commits, branches, diffs" },
  { id: "browser", label: "Browser", icon: "Globe", description: "Preview and inspect" },
  { id: "files", label: "Open Files", icon: "FileText", description: "Track accessed files" },
  { id: "project-files", label: "Project", icon: "FolderTree", description: "Browse file tree" },
];

/** Preview background for a space color swatch. */
export function getSpacePreviewBg(hue: number, chroma: number): string {
  const c = Math.min(chroma, 0.18);
  return `oklch(0.52 ${c} ${hue})`;
}
