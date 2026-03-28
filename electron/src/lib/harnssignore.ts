import path from "path";
import fs from "fs";
import { getAppSetting } from "./app-settings";

const DEFAULT_IGNORE_PATTERNS = [
  "node_modules/",
  ".bun/",
  "__pycache__/",
  ".venv/",
  "venv/",
  "env/",
  ".env/",
  "site-packages/",
  "*.pyc",
  "*.pyo",
  "vendor/",
  "Pods/",
  ".gradle/",
  "build/",
  "dist/",
  "out/",
  ".next/",
  ".nuxt/",
  ".output/",
  ".vercel/",
  ".svelte-kit/",
  "target/",
  "pkg/",
  "bin/",
  "obj/",
  ".cargo/",
  "go.sum",
  ".dart_tool/",
  ".pub-cache/",
  ".flutter-plugins",
  "Packages/",
  ".swiftpm/",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.bundle.js",
  "*.chunk.js",
  "*.lock",
  ".git/",
  ".hg/",
  ".svn/",
  ".DS_Store",
  "Thumbs.db",
  "*.log",
  "coverage/",
  ".nyc_output/",
  ".cache/",
  "cache/",
  ".parcel-cache/",
  ".turbo/",
  ".eslintcache",
  ".tsbuildinfo",
  ".vitepress/",
  ".docusaurus/",
  "storybook-static/",
  ".idea/",
  ".vscode/",
  ".claude/",
  "*.lockb",
  "*.snap",
  "*.d.ts.map",
];

interface IgnoreMatcher {
  patterns: string[];
  test(filePath: string): boolean;
}

function compilePatterns(patterns: string[]): IgnoreMatcher {
  const dirPatterns: string[] = [];
  const filePatterns: RegExp[] = [];

  for (const raw of patterns) {
    const p = raw.trim();
    if (!p || p.startsWith("#")) continue;

    if (p.endsWith("/")) {
      dirPatterns.push(p.slice(0, -1));
    } else if (p.includes("*")) {
      const escaped = p
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*");
      filePatterns.push(new RegExp(`(^|/)${escaped}$`));
    } else {
      dirPatterns.push(p);
      filePatterns.push(new RegExp(`(^|/)${p.replace(/[.+^${}()|[\]\\]/g, "\\$&")}$`));
    }
  }

  return {
    patterns,
    test(filePath: string) {
      for (const dir of dirPatterns) {
        if (filePath.startsWith(dir + "/") || filePath.includes("/" + dir + "/")) return true;
      }
      for (const re of filePatterns) {
        if (re.test(filePath)) return true;
      }
      return false;
    },
  };
}

let cachedMatcher: { cwd: string; mtime: number; matcher: IgnoreMatcher } | null = null;

export function getIgnoreMatcher(cwd: string): IgnoreMatcher {
  const ignoreFile = path.join(cwd, ".harnssignore");
  let mtime = 0;
  let userPatterns: string[] = [];

  try {
    const stat = fs.statSync(ignoreFile);
    mtime = stat.mtimeMs;
    if (cachedMatcher && cachedMatcher.cwd === cwd && cachedMatcher.mtime === mtime) {
      return cachedMatcher.matcher;
    }
    userPatterns = fs.readFileSync(ignoreFile, "utf-8").split("\n");
  } catch {}

  const settings = getAppSetting("ignoreDefaultsDisabled")
    ? []
    : DEFAULT_IGNORE_PATTERNS;
  const extraPatterns = getAppSetting("ignorePatterns") ?? [];
  const allPatterns = [...settings, ...extraPatterns, ...userPatterns];
  const matcher = compilePatterns(allPatterns);

  cachedMatcher = { cwd, mtime, matcher };
  return matcher;
}

export function filterFiles(files: string[], cwd: string): string[] {
  const matcher = getIgnoreMatcher(cwd);
  return files.filter((f) => !matcher.test(f));
}

export function getDefaultIgnorePatterns(): string[] {
  return [...DEFAULT_IGNORE_PATTERNS];
}
