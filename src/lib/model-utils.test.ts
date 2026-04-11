import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@/types";
import {
  areModelsEquivalent,
  canonicalizeModelValue,
  findEquivalentModel,
  resolveModelValue,
} from "./model-utils";

const cachedModels: ModelInfo[] = [
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 4.6 with 1M context",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
  },
  {
    value: "sonnet",
    displayName: "Sonnet",
    description: "Sonnet 4.6",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
  },
  {
    value: "sonnet[1m]",
    displayName: "Sonnet (1M context)",
    description: "Sonnet 4.6 with 1M context",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
  },
  {
    value: "haiku",
    displayName: "Haiku",
    description: "Haiku 4.5",
  },
  {
    value: "claude-opus-4-6",
    displayName: "Opus 4.6",
    description: "claude-opus-4-6",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
  },
];

describe("resolveModelValue", () => {
  it("maps a saved 1M Opus runtime id to the default alias when the cache is stale", () => {
    expect(resolveModelValue("claude-opus-4-6[1m]", cachedModels)).toBe("default");
  });

  it("falls back to the closest cached Opus entry when the default alias is unavailable", () => {
    expect(
      resolveModelValue(
        "claude-opus-4-6[1m]",
        cachedModels.filter((entry) => entry.value !== "default"),
      ),
    ).toBe("claude-opus-4-6");
  });

  it("prefers an exact cached match over the default alias", () => {
    expect(
      resolveModelValue("claude-opus-4-6[1m]", [
        ...cachedModels,
        {
          value: "claude-opus-4-6[1m]",
          displayName: "Opus 4.6 (with 1M context)",
          description: "Newest 1M Opus",
          supportsEffort: true,
          supportedEffortLevels: ["low", "medium", "high", "max"],
        },
      ]),
    ).toBe("claude-opus-4-6[1m]");
  });
});

describe("findEquivalentModel", () => {
  it("returns the cached entry that should drive effort metadata", () => {
    expect(findEquivalentModel("claude-opus-4-6[1m]", cachedModels)?.value).toBe("default");
  });
});

describe("canonicalizeModelValue", () => {
  it("prefers the stable default alias over a concrete runtime id", () => {
    expect(canonicalizeModelValue("claude-opus-4-6[1m]", cachedModels)).toBe("default");
  });

  it("keeps an exact value when no better alias exists", () => {
    expect(canonicalizeModelValue("claude-opus-4-6[1m]", [
      ...cachedModels.filter((entry) => entry.value !== "default"),
      {
        value: "claude-opus-4-6[1m]",
        displayName: "Opus 4.6 (with 1M context)",
        description: "Newest 1M Opus",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
    ])).toBe("claude-opus-4-6[1m]");
  });
});

describe("areModelsEquivalent", () => {
  it("still distinguishes different non-default variants", () => {
    expect(areModelsEquivalent("sonnet", "sonnet[1m]")).toBe(false);
  });
});
