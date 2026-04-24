import { describe, expect, it } from "vitest";
import { icons } from "lucide-react";
import { CURATED_EMOJIS, CURATED_LUCIDE_ICONS } from "./icon-catalog";

describe("icon catalog", () => {
  it("every curated lucide name resolves to a real icon component", () => {
    const known = new Set(Object.keys(icons));
    const missing = CURATED_LUCIDE_ICONS.filter((name) => !known.has(name));
    expect(missing).toEqual([]);
  });

  it("curated emoji list has no duplicates", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const e of CURATED_EMOJIS) {
      if (seen.has(e)) dupes.push(e);
      seen.add(e);
    }
    expect(dupes).toEqual([]);
  });

  it("curated lucide list has no duplicates", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const n of CURATED_LUCIDE_ICONS) {
      if (seen.has(n)) dupes.push(n);
      seen.add(n);
    }
    expect(dupes).toEqual([]);
  });

  it("has substantially more options than the old lists", () => {
    // Regression guard: the curation should stay generous so the pickers
    // remain useful out of the box.
    expect(CURATED_EMOJIS.length).toBeGreaterThanOrEqual(180);
    expect(CURATED_LUCIDE_ICONS.length).toBeGreaterThanOrEqual(180);
  });
});
