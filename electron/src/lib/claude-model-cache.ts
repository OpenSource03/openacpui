import fs from "fs";
import path from "path";
import { getDataDir } from "./data-dir";

export interface CachedModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: Array<"low" | "medium" | "high" | "max">;
  supportsAdaptiveThinking?: boolean;
  supportsFastMode?: boolean;
}

interface ClaudeModelsCacheData {
  models: CachedModelInfo[];
  updatedAt: number;
}

const CACHE_FILE = "claude-models-cache.json";

function cachePath(): string {
  return path.join(getDataDir(), CACHE_FILE);
}

function normalizeModelInfo(value: unknown): CachedModelInfo | null {
  if (!value || typeof value !== "object") return null;
  const model = value as Record<string, unknown>;
  if (typeof model.value !== "string" || model.value.trim().length === 0) return null;
  const displayName = typeof model.displayName === "string" ? model.displayName : model.value;
  const description = typeof model.description === "string" ? model.description : "";
  const supportedEffortLevels = Array.isArray(model.supportedEffortLevels)
    ? model.supportedEffortLevels.filter(
      (level): level is "low" | "medium" | "high" | "max" =>
        level === "low" || level === "medium" || level === "high" || level === "max",
    )
    : undefined;
  return {
    value: model.value,
    displayName,
    description,
    ...(typeof model.supportsEffort === "boolean" ? { supportsEffort: model.supportsEffort } : {}),
    ...(supportedEffortLevels && supportedEffortLevels.length > 0 ? { supportedEffortLevels } : {}),
    ...(typeof model.supportsAdaptiveThinking === "boolean"
      ? { supportsAdaptiveThinking: model.supportsAdaptiveThinking }
      : {}),
    ...(typeof model.supportsFastMode === "boolean" ? { supportsFastMode: model.supportsFastMode } : {}),
  };
}

function normalizeModels(value: unknown): CachedModelInfo[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeModelInfo).filter((m): m is CachedModelInfo => m !== null);
}

export function getClaudeModelsCache(): { models: CachedModelInfo[]; updatedAt?: number } {
  try {
    const raw = fs.readFileSync(cachePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<ClaudeModelsCacheData>;
    const models = normalizeModels(parsed.models);
    const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : undefined;
    return { models, updatedAt };
  } catch {
    return { models: [] };
  }
}

export function setClaudeModelsCache(models: unknown): { models: CachedModelInfo[]; updatedAt: number } {
  const normalized = normalizeModels(models);
  const updatedAt = Date.now();
  const next: ClaudeModelsCacheData = { models: normalized, updatedAt };
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(next, null, 2), "utf-8");
  } catch {
    // Non-fatal. Keep runtime return value even if disk write fails.
  }
  return next;
}
