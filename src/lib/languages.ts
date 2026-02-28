import type { CSSProperties } from "react";

// ── File extension → Prism language mapping ──

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  mts: "typescript", mjs: "javascript", cts: "typescript", cjs: "javascript",
  py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin",
  css: "css", scss: "scss", less: "less", html: "html", json: "json", jsonc: "json",
  md: "markdown", mdx: "markdown", yaml: "yaml", yml: "yaml",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql", xml: "xml", svg: "xml",
  toml: "toml", ini: "ini",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cc: "cpp",
  cs: "csharp", rb: "ruby", php: "php", swift: "swift",
  r: "r", lua: "lua", dart: "dart", scala: "scala",
  zig: "zig", ex: "elixir", exs: "elixir",
  hs: "haskell", erl: "erlang",
  vue: "markup", svelte: "markup",
  prisma: "graphql",
};

/** Filenames (lowercased, no extension) → language */
const FILENAME_MAP: Record<string, string> = {
  dockerfile: "docker",
  makefile: "makefile",
  gnumakefile: "makefile",
};

/** Detect Prism language from a file path's extension or filename */
export function getLanguageFromPath(filePath: string): string {
  const fileName = filePath.split("/").pop()?.toLowerCase() ?? "";
  const nameNoExt = fileName.replace(/\.[^.]+$/, "");

  // Special filenames (Dockerfile, Makefile, etc.)
  if (FILENAME_MAP[nameNoExt]) return FILENAME_MAP[nameNoExt];
  // .env files (.env, .env.local, .env.production, etc.)
  if (fileName === ".env" || fileName.startsWith(".env.")) return "bash";

  const ext = fileName.split(".").pop() ?? "";
  return EXTENSION_MAP[ext] ?? "text";
}

/**
 * Best-effort language detection for code blocks without explicit language tags.
 * Conservative — only returns a language when multiple signals match to avoid false positives.
 */
export function guessLanguage(code: string): string | null {
  const trimmed = code.trim();

  // JSON — parse to verify
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try { JSON.parse(trimmed); return "json"; } catch { /* not JSON */ }
  }

  // Shell commands (lines starting with $ or common CLI commands)
  if (/^\$\s/m.test(trimmed) ||
      /^(npm|pnpm|yarn|git|cd|mkdir|echo|curl|wget|pip|brew|apt|sudo|docker|cargo|go)\s/m.test(trimmed)) {
    return "bash";
  }

  // HTML/XML
  if (/^<(!DOCTYPE|html|div|span|head|body|section|main|nav|header|footer)/im.test(trimmed)) {
    return "html";
  }

  // TypeScript/JavaScript — require ≥2 signals to avoid false positives
  const tsSignals = [
    /\b(import|export)\s+(default\s+)?(function|class|const|let|type|interface)\b/.test(code),
    /\b(const|let|var)\s+\w+\s*[:=]/.test(code),
    /\bfunction\s+\w+\s*\(/.test(code) || /=>\s*[{(]/.test(code),
  ].filter(Boolean).length;
  if (tsSignals >= 2) return "typescript";

  // Python — require ≥2 signals
  const pySignals = [
    /\bdef\s+\w+\s*\(/.test(code),
    /\bimport\s+\w+/.test(code) || /\bfrom\s+\w+\s+import\b/.test(code),
    /:\s*$/m.test(code) && /^\s{4}/m.test(code),
  ].filter(Boolean).length;
  if (pySignals >= 2) return "python";

  // Rust
  if (/\bfn\s+\w+/.test(code) && /\blet\s+(mut\s+)?\w+/.test(code)) return "rust";

  // Go
  if (/\bfunc\s+\w+/.test(code) && /\bpackage\s+\w+/.test(code)) return "go";

  return null;
}

// ── Shared inline SyntaxHighlighter styles ──
// Used in DiffViewer and ToolCall for inline syntax highlighting within tool cards

/** Style for the PreTag (outer wrapper) — renders inline, inherits parent layout */
export const INLINE_HIGHLIGHT_STYLE: CSSProperties = {
  margin: 0,
  padding: 0,
  background: "transparent",
  textShadow: "none",
  display: "inline",
  fontSize: "inherit",
  lineHeight: "inherit",
  fontFamily: "inherit",
  whiteSpace: "inherit",
};

/** Style for the CodeTag (inner wrapper) — overrides oneDark's white-space: pre */
export const INLINE_CODE_TAG_STYLE: CSSProperties = {
  whiteSpace: "inherit",
  background: "transparent",
  textShadow: "none",
};
