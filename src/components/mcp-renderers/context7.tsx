import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Library,
  FileCode2,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const REMARK_PLUGINS = [remarkGfm];

// ── Context7: Library search (resolve-library-id) ──

interface Context7Library {
  title?: string;
  libraryId?: string;
  description?: string;
  codeSnippets?: number;
  sourceReputation?: string;
  benchmarkScore?: number;
  versions?: string[];
}

/** Parse the text-based resolve-library-id response into structured library entries */
function parseContext7Libraries(text: string): Context7Library[] {
  const entries: Context7Library[] = [];
  // Split by the ---------- separator
  const blocks = text.split(/^-{5,}$/m).filter((b) => b.trim());

  for (const block of blocks) {
    // Skip the header/intro block
    if (!block.includes("Context7-compatible library ID:")) continue;

    const lib: Context7Library = {};
    const lines = block.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- Title:")) lib.title = trimmed.slice(9).trim();
      else if (trimmed.startsWith("- Context7-compatible library ID:")) lib.libraryId = trimmed.slice(33).trim();
      else if (trimmed.startsWith("- Description:")) lib.description = trimmed.slice(14).trim();
      else if (trimmed.startsWith("- Code Snippets:")) lib.codeSnippets = parseInt(trimmed.slice(16).trim()) || 0;
      else if (trimmed.startsWith("- Source Reputation:")) lib.sourceReputation = trimmed.slice(20).trim();
      else if (trimmed.startsWith("- Benchmark Score:")) lib.benchmarkScore = parseFloat(trimmed.slice(18).trim()) || 0;
      else if (trimmed.startsWith("- Versions:")) lib.versions = trimmed.slice(11).trim().split(/,\s*/);
    }
    if (lib.title || lib.libraryId) entries.push(lib);
  }
  return entries;
}

export function Context7LibraryList({ rawText }: { data: unknown; rawText?: string | null }) {
  const text = rawText ?? "";
  const libraries = parseContext7Libraries(text);

  if (libraries.length === 0) {
    // Fallback: render raw text if parsing fails
    if (text.trim()) {
      return (
        <div className="prose dark:prose-invert prose-xs max-w-none text-foreground/70 wrap-break-word">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{text}</ReactMarkdown>
        </div>
      );
    }
    return <p className="text-foreground/40 py-2">No libraries found</p>;
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        {libraries.length} librar{libraries.length !== 1 ? "ies" : "y"}
      </span>
      {libraries.map((lib) => {
        const reputationColor = lib.sourceReputation === "High"
          ? "text-emerald-400"
          : lib.sourceReputation === "Medium"
            ? "text-amber-400"
            : "text-foreground/40";
        const scoreColor = (lib.benchmarkScore ?? 0) >= 85
          ? "text-emerald-400"
          : (lib.benchmarkScore ?? 0) >= 70
            ? "text-amber-400"
            : "text-foreground/40";
        return (
          <div
            key={lib.libraryId ?? lib.title}
            className="rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Library className="h-3.5 w-3.5 shrink-0 text-purple-400/60" />
              <span className="text-[11px] font-medium text-foreground/80 truncate">{lib.title}</span>
              {lib.benchmarkScore != null && (
                <span className={`text-[10px] shrink-0 font-mono ${scoreColor}`}>
                  {lib.benchmarkScore}
                </span>
              )}
              {lib.sourceReputation && (
                <Badge variant="outline" className={`h-3.5 px-1 text-[9px] shrink-0 border-0 ${reputationColor} bg-foreground/[0.03]`}>
                  {lib.sourceReputation}
                </Badge>
              )}
            </div>
            <div className="ms-[22px] mt-0.5">
              {lib.description && (
                <p className="text-[10px] text-foreground/40 truncate">{lib.description}</p>
              )}
              <div className="flex items-center gap-3 mt-0.5">
                {lib.libraryId && (
                  <span className="text-[10px] font-mono text-foreground/30">{lib.libraryId}</span>
                )}
                {lib.codeSnippets != null && (
                  <span className="text-[10px] text-foreground/30 flex items-center gap-0.5">
                    <FileCode2 className="h-2.5 w-2.5" />
                    {lib.codeSnippets.toLocaleString()} snippets
                  </span>
                )}
              </div>
              {lib.versions && lib.versions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {lib.versions.map((v) => (
                    <Badge key={v} variant="outline" className="h-3.5 px-1 text-[8px] text-foreground/30 border-foreground/10">
                      {v}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Context7: Documentation query (query-docs) ──

interface Context7DocSnippet {
  heading: string;
  source?: string;
  description: string;
  codeBlocks: Array<{ lang: string; code: string }>;
}

/** Parse query-docs response into structured doc snippets */
function parseContext7Docs(text: string): Context7DocSnippet[] {
  const snippets: Context7DocSnippet[] = [];
  // Split by the ---- separator between snippets
  const blocks = text.split(/^-{5,}$/m).filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let heading = "";
    let source: string | undefined;
    const descLines: string[] = [];
    const codeBlocks: Array<{ lang: string; code: string }> = [];
    let inCode = false;
    let codeLang = "";
    let codeLines: string[] = [];

    for (const line of lines) {
      if (inCode) {
        if (line.startsWith("```")) {
          codeBlocks.push({ lang: codeLang, code: codeLines.join("\n") });
          codeLines = [];
          inCode = false;
        } else {
          codeLines.push(line);
        }
      } else if (line.startsWith("```")) {
        inCode = true;
        codeLang = line.slice(3).trim() || "text";
      } else if (line.startsWith("### ") && !heading) {
        heading = line.slice(4).trim();
      } else if (line.startsWith("Source: ")) {
        source = line.slice(8).trim();
      } else {
        descLines.push(line);
      }
    }

    const description = descLines.join("\n").trim();
    if (heading || description || codeBlocks.length > 0) {
      snippets.push({ heading, source, description, codeBlocks });
    }
  }
  return snippets;
}

export function Context7DocsResult({ rawText, toolInput }: { data: unknown; toolInput: Record<string, unknown>; rawText?: string | null }) {
  const text = rawText ?? "";
  const snippets = parseContext7Docs(text);
  const query = String(toolInput.query ?? "");
  const libraryId = String(toolInput.libraryId ?? "");

  if (snippets.length === 0) {
    if (text.trim()) {
      return (
        <div className="prose dark:prose-invert prose-xs max-w-none text-foreground/70 wrap-break-word">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{text}</ReactMarkdown>
        </div>
      );
    }
    return <p className="text-foreground/40 py-2">No documentation found</p>;
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium">
          {snippets.length} snippet{snippets.length !== 1 ? "s" : ""}
        </span>
        {libraryId && (
          <span className="text-[10px] font-mono text-foreground/30">{libraryId}</span>
        )}
        {query && (
          <span className="text-[10px] text-foreground/20 truncate">&ldquo;{query}&rdquo;</span>
        )}
      </div>

      {snippets.map((snippet, i) => (
        <div key={i} className="rounded-md border border-foreground/[0.06] overflow-hidden">
          {/* Snippet header */}
          {snippet.heading && (
            <div className="px-3 py-1.5 border-b border-foreground/[0.06] flex items-center gap-2">
              <FileCode2 className="h-3 w-3 shrink-0 text-blue-400/60" />
              <span className="text-[11px] font-medium text-foreground/80 wrap-break-word">{snippet.heading}</span>
            </div>
          )}

          {/* Description */}
          {snippet.description && (
            <div className="px-3 py-1.5 text-[10px] text-foreground/50 wrap-break-word">
              {snippet.description}
            </div>
          )}

          {/* Code blocks */}
          {snippet.codeBlocks.map((cb, j) => (
            <div key={j} className="border-t border-foreground/[0.06]">
              <pre className="px-3 py-2 text-[10px] text-foreground/70 overflow-x-auto bg-foreground/[0.02]">
                <code>{cb.code}</code>
              </pre>
            </div>
          ))}

          {/* Source link */}
          {snippet.source && (
            <div className="px-3 py-1 border-t border-foreground/[0.06] flex items-center gap-1">
              <ExternalLink className="h-2.5 w-2.5 text-foreground/20" />
              <span className="text-[9px] text-foreground/25 truncate">{snippet.source}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
