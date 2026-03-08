import { describe, expect, it } from "vitest";
import {
  buildSessionCacheKey,
  computeChangesPanelData,
  computeFilePanelData,
  getCachedChangesPanelData,
  getCachedFilePanelData,
} from "../../../../src/lib/session-derived-data";
import type { UIMessage } from "../../../../src/types";

function makeUserMessage(id: string, content: string, timestamp: number): UIMessage {
  return {
    id,
    role: "user",
    content,
    timestamp,
  };
}

function makeToolCall(id: string, toolName: string, toolInput: Record<string, unknown>, timestamp: number): UIMessage {
  return {
    id,
    role: "tool_call",
    content: "",
    timestamp,
    toolName,
    toolInput,
  };
}

describe("session-derived-data", () => {
  it("caches file panel data per session and tracks the latest tool call for a file", () => {
    const messages: UIMessage[] = [
      makeUserMessage("u1", "read config", 1),
      makeToolCall("t1", "Read", { file_path: "/repo/src/app.ts" }, 2),
      makeToolCall("t2", "Edit", { file_path: "/repo/src/app.ts", old_string: "a", new_string: "b" }, 3),
    ];
    const cacheKey = buildSessionCacheKey("session-a", messages, "files");

    const first = computeFilePanelData("session-a", cacheKey, messages, "/repo");
    const cached = getCachedFilePanelData("session-a", cacheKey);
    const second = computeFilePanelData("session-a", cacheKey, messages, "/repo");

    expect(first.files).toHaveLength(1);
    expect(first.files[0]?.path).toBe("/repo/src/app.ts");
    expect(first.lastToolCallIdByFile.get("/repo/src/app.ts")).toBe("t2");
    expect(cached).toBe(first);
    expect(second).toBe(first);
  });

  it("caches changes data and respects in-progress turns", () => {
    const messages: UIMessage[] = [
      makeUserMessage("u1", "change file", 1),
      makeToolCall("t1", "Edit", {
        file_path: "/repo/src/app.ts",
        old_string: "const a = 1;",
        new_string: "const a = 2;",
      }, 2),
      makeUserMessage("u2", "still working", 3),
      makeToolCall("t2", "Write", {
        file_path: "/repo/src/new.ts",
        content: "export const value = 1;",
      }, 4),
    ];
    const cacheKey = buildSessionCacheKey("session-b", messages, "idle");

    const idle = computeChangesPanelData("session-b", cacheKey, messages, false);
    const cached = getCachedChangesPanelData("session-b", cacheKey);
    const processing = computeChangesPanelData(
      "session-c",
      buildSessionCacheKey("session-c", messages, "processing"),
      messages,
      true,
    );

    expect(idle.turnSummaries).toHaveLength(2);
    expect(idle.allChanges).toHaveLength(2);
    expect(idle.groupedByFile.get("/repo/src/app.ts")).toHaveLength(1);
    expect(cached).toBe(idle);
    expect(processing.turnSummaries).toHaveLength(1);
  });
});
