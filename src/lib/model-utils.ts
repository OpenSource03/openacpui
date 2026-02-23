import type { ModelInfo } from "@/types";

function normalizeModelId(model: string | null | undefined): string {
  return (model ?? "").trim().toLowerCase();
}

function modelFamily(model: string): "haiku" | "sonnet" | "opus" | "other" {
  if (model.includes("default")) return "opus";
  if (model.includes("haiku")) return "haiku";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("opus")) return "opus";
  return "other";
}

function modelVariant(model: string): "1m" | "base" {
  return model.includes("[1m]") ? "1m" : "base";
}

function modelLabel(model: ModelInfo): string {
  return model.displayName.trim().toLowerCase();
}

function modelValue(model: ModelInfo): string {
  return model.value.trim().toLowerCase();
}

function modelPreferenceScore(candidate: ModelInfo, target: string): number {
  const value = modelValue(candidate);
  const label = modelLabel(candidate);
  let score = 0;

  // Prefer the stable alias the SDK recommends.
  if (value === "default" || label.includes("default")) score += 100;
  // Prefer short aliases (haiku/sonnet/opus) over canonical version pins.
  if (!value.startsWith("claude-")) score += 20;
  // De-prioritize "Custom Model" when an equivalent alias exists.
  if (label.includes("custom")) score -= 80;
  // Minor tie-breaker for exact match.
  if (value === target) score += 5;

  return score;
}

/**
 * Treat SDK aliases (e.g. "haiku") and canonical runtime names
 * (e.g. "claude-haiku-4-5-20251001") as equivalent for selection UI.
 */
export function areModelsEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeModelId(a);
  const nb = normalizeModelId(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const fa = modelFamily(na);
  const fb = modelFamily(nb);
  if (fa === "other" || fb === "other") return false;
  if (fa !== fb) return false;

  return modelVariant(na) === modelVariant(nb);
}

/**
 * Convert a runtime model string to the matching picker value, if possible.
 */
export function resolveModelValue(model: string | null | undefined, supportedModels: ModelInfo[]): string | undefined {
  if (!model) return undefined;
  const target = model.trim().toLowerCase();

  // First prefer equivalent aliases (e.g. default <-> claude-opus-*).
  const equivalents = supportedModels.filter((m) => areModelsEquivalent(m.value, model));
  if (equivalents.length > 0) {
    const preferred = [...equivalents].sort(
      (a, b) => modelPreferenceScore(b, target) - modelPreferenceScore(a, target),
    )[0];
    return preferred.value;
  }

  // Fallback: exact match for truly custom/non-equivalent IDs.
  const exact = supportedModels.find((m) => m.value === model);
  return exact?.value;
}
