/**
 * Pure helpers shared between Electron and CLI ACP engine implementations.
 */

export type ACPTextFileParams = { path?: string; uri?: string };

export function resolveACPFilePath(params: ACPTextFileParams): string {
  const filePath = params.path ?? params.uri;
  if (!filePath) throw new Error("ACP fs request is missing path");
  return filePath;
}

export function normalizePositiveInt(value: number | null | undefined, fallback: number): number {
  if (value == null || Number.isNaN(value)) return fallback;
  const n = Math.trunc(value);
  return n > 0 ? n : fallback;
}

export function applyReadRange(content: string, line?: number | null, limit?: number | null): string {
  if (line == null && limit == null) return content;
  const lines = content.match(/[^\n]*\n|[^\n]+/g) ?? [];
  const startLine = normalizePositiveInt(line, 1);
  const startIndex = startLine - 1;
  const lineLimit = limit == null ? Number.MAX_SAFE_INTEGER : Math.max(0, Math.trunc(limit));
  if (startIndex >= lines.length || lineLimit === 0) return "";
  return lines.slice(startIndex, startIndex + lineLimit).join("");
}

export const ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
} as const;
