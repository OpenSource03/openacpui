export interface ParsedUnifiedDiff {
  oldString: string;
  newString: string;
}

const DIFF_META_PREFIXES = [
  "diff --git ",
  "index ",
  "--- ",
  "+++ ",
  "*** ",
] as const;

function isTextContentBlock(
  value: unknown,
): value is { type: "text"; text: string } {
  if (typeof value !== "object" || value === null) return false;
  const maybe = value as { type?: unknown; text?: unknown };
  return maybe.type === "text" && typeof maybe.text === "string";
}

function normalizeDiffText(text: string): string {
  if (!text) return text;
  // Some tool payloads contain escaped newlines in a JSON-ish string.
  if (!text.includes("\n") && text.includes("\\n")) {
    return text.replace(/\\n/g, "\n");
  }
  return text;
}

function tryExtractContentField(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as { content?: unknown };
    return typeof parsed.content === "string" ? parsed.content : null;
  } catch {
    return null;
  }
}

export function parseUnifiedDiff(diffText: string): ParsedUnifiedDiff | null {
  if (!diffText) return null;

  const oldLines: string[] = [];
  const newLines: string[] = [];
  let sawChangeLine = false;
  let sawHunkHeader = false;
  let normalizedText = normalizeDiffText(diffText);
  const contentField = tryExtractContentField(normalizedText);
  if (contentField) normalizedText = normalizeDiffText(contentField);

  const lines = normalizedText.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Keep hunk separation explicit so independent hunks don't get merged.
      if (sawHunkHeader && (oldLines.length > 0 || newLines.length > 0)) {
        oldLines.push("");
        newLines.push("");
      }
      sawHunkHeader = true;
      continue;
    }
    if (DIFF_META_PREFIXES.some((prefix) => line.startsWith(prefix))) continue;
    if (line === "\\ No newline at end of file") continue;

    if (line.startsWith("+")) {
      newLines.push(line.slice(1));
      sawChangeLine = true;
      continue;
    }
    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
      sawChangeLine = true;
      continue;
    }
    if (line.startsWith(" ")) {
      const content = line.slice(1);
      oldLines.push(content);
      newLines.push(content);
    }
  }

  if (!sawChangeLine) return null;
  return {
    oldString: oldLines.join("\n"),
    newString: newLines.join("\n"),
  };
}

export function parseUnifiedDiffFromUnknown(
  value: unknown,
): ParsedUnifiedDiff | null {
  if (typeof value === "string") {
    return parseUnifiedDiff(value);
  }

  if (Array.isArray(value)) {
    const text = value
      .filter(isTextContentBlock)
      .map((block) => block.text)
      .join("\n");
    if (!text) return null;
    return parseUnifiedDiff(text);
  }

  if (typeof value !== "object" || value === null) return null;

  const maybe = value as Record<string, unknown>;
  // Some engines return { content: "@@ ..."} (object), not a plain string.
  const candidates: unknown[] = [
    maybe.diff,
    maybe.content,
    maybe.text,
    maybe.patch,
  ];
  for (const candidate of candidates) {
    const parsed = parseUnifiedDiffFromUnknown(candidate);
    if (parsed) return parsed;
  }

  return null;
}
