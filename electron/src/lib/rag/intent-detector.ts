export type IntentType =
  | "EDIT_CODE"
  | "EXPLAIN_CODE"
  | "REFACTOR"
  | "SEARCH"
  | "GENERATE_FILE"
  | "FIX_BUG"
  | "RUN_COMMAND"
  | "GENERAL";

export interface Intent {
  type: IntentType;
  /** file paths or CamelCase identifiers mentioned explicitly */
  targets: string[];
  /** meaningful keywords for code search */
  keywords: string[];
}

// ── Pattern sets ────────────────────────────────────────────────────────────

const GENERATE_RE = /\b(generate|scaffold|new file|create file|new component|boilerplate)\b/i;
const BUG_RE = /\b(bug|error|broken|failing|crash|exception|issue|problem|wrong|not working|doesn[''`]t work)\b/i;
const REFACTOR_RE = /\b(refactor|clean up|clean-up|improve|simplify|optimize|restructure|rename)\b/i;
const EXPLAIN_RE = /\b(explain|what does|how does|why does|describe|tell me about|understand)\b/i;
const SEARCH_RE = /\b(find|search|where is|where are|locate|which file|show all|list all)\b/i;
const EDIT_RE = /\b(add|create|implement|write|insert|put|make|fix|correct|update|change|modify|replace|remove|delete|extend|inject)\b/i;
const RUN_RE = /\b(run|execute|build|test|compile|install|start|deploy)\b/i;

// ── Extraction helpers ───────────────────────────────────────────────────────

function extractTargets(text: string): string[] {
  const targets: string[] = [];
  // File paths like src/components/Login.tsx or just Login.tsx
  const fileRe = /[\w./-]+\.(ts|tsx|js|jsx|mjs|py|go|rs|css|scss|json|md|yaml|yml)\b/g;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(text)) !== null) targets.push(m[0]);
  // CamelCase or PascalCase identifiers (likely component/class/function names)
  const identRe = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
  while ((m = identRe.exec(text)) !== null) targets.push(m[1]);
  // camelCase identifiers starting with lowercase (function names)
  const camelRe = /\b([a-z]+(?:[A-Z][a-z]+)+)\b/g;
  while ((m = camelRe.exec(text)) !== null) targets.push(m[1]);
  return [...new Set(targets)];
}

const STOP_WORDS = new Set([
  // English
  "the", "a", "an", "in", "on", "to", "for", "of", "and", "or", "is", "it",
  "this", "that", "i", "my", "me", "we", "be", "do", "did", "has", "have",
  "can", "will", "with", "at", "by", "from", "as", "so", "if", "but", "not",
  "are", "was", "were", "been", "all", "any", "its", "our", "your", "what",
  "show", "tell", "give", "get", "make", "inside", "content", "file",
  // Portuguese
  "oque", "que", "tem", "dentro", "do", "da", "dos", "das", "de", "em", "no",
  "na", "nos", "nas", "um", "uma", "uns", "umas", "por", "para", "com", "como",
  "ele", "ela", "isso", "este", "esta", "esse", "essa", "qual", "quais",
  "onde", "quando", "quem", "voce", "você", "seu", "sua", "seus", "suas",
  "mais", "muito", "pouco", "tudo", "todos", "toda", "todo", "nao", "não",
  "sim", "mas", "pois", "porem", "porque", "então", "entao", "foi", "ser",
  "ter", "ver", "faz", "faca", "faça", "pode", "preciso", "quero", "mostre",
  "mostra", "diga", "diz", "lista", "liste",
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

// ── Main export ──────────────────────────────────────────────────────────────

export function detectIntent(prompt: string): Intent {
  const targets = extractTargets(prompt);
  const keywords = extractKeywords(prompt);

  let type: IntentType = "GENERAL";

  if (GENERATE_RE.test(prompt)) type = "GENERATE_FILE";
  else if (BUG_RE.test(prompt)) type = "FIX_BUG";
  else if (REFACTOR_RE.test(prompt)) type = "REFACTOR";
  else if (EXPLAIN_RE.test(prompt)) type = "EXPLAIN_CODE";
  else if (SEARCH_RE.test(prompt)) type = "SEARCH";
  else if (RUN_RE.test(prompt)) type = "RUN_COMMAND";
  else if (EDIT_RE.test(prompt)) type = "EDIT_CODE";

  return { type, targets, keywords };
}

/** Returns a short instruction suffix for the system prompt based on intent */
export function intentInstruction(intent: IntentType): string {
  switch (intent) {
    case "EDIT_CODE":
      return "Apply the requested change using edit_file or write_file. Read the file first if you need exact line content.";
    case "EXPLAIN_CODE":
      return "Explain the relevant code clearly. Do not emit tool tags — just answer in plain text.";
    case "REFACTOR":
      return "Refactor the code using edit_file. Preserve all existing behaviour. Read the file first.";
    case "SEARCH":
      return "Use search_files or list_files to locate the answer, then report the result.";
    case "GENERATE_FILE":
      return "Generate the new file using write_file. Follow the existing project conventions.";
    case "FIX_BUG":
      return "Identify the root cause from the context, then apply the fix using edit_file.";
    case "RUN_COMMAND":
      return "Use run_shell to execute the command and report the output.";
    default:
      return "Respond based on the provided context.";
  }
}
