import { describe, expect, it } from "vitest";
import {
  buildSessionCacheKey,
  computeFilePanelData,
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
});
