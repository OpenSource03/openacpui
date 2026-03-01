import type { ACPConfigSelectOption, ACPConfigSelectGroup } from "../types/acp";

/** Flatten grouped or flat options into a single flat list */
export function flattenConfigOptions(
  options: ACPConfigSelectOption[] | ACPConfigSelectGroup[],
): ACPConfigSelectOption[] {
  if (options.length === 0) return [];
  if ("value" in options[0]) return options as ACPConfigSelectOption[];
  return (options as ACPConfigSelectGroup[]).flatMap((g) => g.options);
}
