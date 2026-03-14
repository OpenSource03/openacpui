import { describe, expect, it } from "vitest";
import type { SlashCommand } from "@/types";
import {
  LOCAL_CLEAR_COMMAND,
  getAvailableSlashCommands,
  getSlashCommandReplacement,
  isClearCommandText,
} from "./InputBar";

describe("InputBar slash command helpers", () => {
  it("always includes the local clear command first", () => {
    const commands: SlashCommand[] = [
      { name: "compact", description: "Compact context", source: "claude" },
    ];

    expect(getAvailableSlashCommands(commands)).toEqual([
      LOCAL_CLEAR_COMMAND,
      commands[0],
    ]);
  });

  it("deduplicates engine-provided clear commands in favor of the local one", () => {
    const commands: SlashCommand[] = [
      { name: "clear", description: "Engine clear", source: "claude" },
      { name: "help", description: "Help", source: "claude" },
    ];

    expect(getAvailableSlashCommands(commands)).toEqual([
      LOCAL_CLEAR_COMMAND,
      commands[1],
    ]);
  });

  it("detects the exact /clear command text", () => {
    expect(isClearCommandText("/clear")).toBe(true);
    expect(isClearCommandText("  /clear  ")).toBe(true);
    expect(isClearCommandText("/clear now")).toBe(false);
    expect(isClearCommandText("/compact")).toBe(false);
  });

  it("builds replacement text for local and engine commands", () => {
    expect(getSlashCommandReplacement(LOCAL_CLEAR_COMMAND)).toBe("/clear");
    expect(getSlashCommandReplacement({ name: "compact", description: "", source: "claude" })).toBe("/compact ");
    expect(getSlashCommandReplacement({ name: "open", description: "", source: "codex-app", appSlug: "jira" })).toBe("$jira ");
    expect(
      getSlashCommandReplacement({ name: "fix", description: "", source: "codex-skill", defaultPrompt: "bug" }),
    ).toBe("$fix bug");
  });
});
