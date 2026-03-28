import {
  Search,
  RefreshCw,
  TestTube,
  GitCommit,
  FileText,
  Bug,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface BuiltinSkill {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  tags: string[];
  status: "available" | "coming-soon";
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    id: "code-review",
    name: "Code Review",
    description: "Review code for bugs, security vulnerabilities, performance issues, and best practices.",
    icon: Search,
    tags: ["quality", "security"],
    status: "coming-soon",
  },
  {
    id: "refactor",
    name: "Refactor",
    description: "Refactor code for readability, maintainability, and performance while preserving behavior.",
    icon: RefreshCw,
    tags: ["quality", "clean-code"],
    status: "coming-soon",
  },
  {
    id: "test-writer",
    name: "Test Writer",
    description: "Generate unit tests, integration tests, and edge case coverage for your code.",
    icon: TestTube,
    tags: ["testing", "quality"],
    status: "coming-soon",
  },
  {
    id: "commit-message",
    name: "Commit Message",
    description: "Generate conventional commit messages based on staged changes and diff context.",
    icon: GitCommit,
    tags: ["git", "workflow"],
    status: "coming-soon",
  },
  {
    id: "explain-code",
    name: "Explain Code",
    description: "Explain complex code, architecture patterns, and design decisions in plain language.",
    icon: FileText,
    tags: ["learning", "documentation"],
    status: "coming-soon",
  },
  {
    id: "debug",
    name: "Debug",
    description: "Systematically debug issues by analyzing error messages, stack traces, and code flow.",
    icon: Bug,
    tags: ["debugging", "troubleshooting"],
    status: "coming-soon",
  },
  {
    id: "optimize",
    name: "Optimize",
    description: "Identify and fix performance bottlenecks, memory leaks, and inefficient patterns.",
    icon: Zap,
    tags: ["performance", "optimization"],
    status: "coming-soon",
  },
  {
    id: "document",
    name: "Document",
    description: "Generate API documentation, README files, and inline documentation for your code.",
    icon: FileText,
    tags: ["documentation", "api"],
    status: "coming-soon",
  },
];

export function getActiveSkillsStorageKey(projectPath: string): string {
  return `harnss-${projectPath.replace(/\//g, "-")}-active-skills`;
}

export function loadActiveSkills(projectPath: string): string[] {
  try {
    const stored = localStorage.getItem(getActiveSkillsStorageKey(projectPath));
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id: unknown) => typeof id === "string") as string[];
  } catch {
    return [];
  }
}

export function saveActiveSkills(projectPath: string, skillIds: string[]): void {
  localStorage.setItem(
    getActiveSkillsStorageKey(projectPath),
    JSON.stringify(skillIds)
  );
}
