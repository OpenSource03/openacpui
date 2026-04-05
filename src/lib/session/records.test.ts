import { describe, expect, it } from "vitest";
import type { ChatSession, UIMessage } from "@/types";
import { buildPersistedSession, toChatSession } from "./records";

describe("session records", () => {
  it("keeps folder, pin, and branch metadata when hydrating sidebar sessions", () => {
    const session = toChatSession({
      id: "session-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 100,
      lastMessageAt: 200,
      totalCost: 12,
      engine: "claude",
      folderId: "folder-1",
      pinned: true,
      branch: "feature/test",
    }, false);

    expect(session.folderId).toBe("folder-1");
    expect(session.pinned).toBe(true);
    expect(session.branch).toBe("feature/test");
    expect(session.isActive).toBe(false);
  });

  it("keeps folder, pin, and branch metadata when building persisted sessions", () => {
    const session: ChatSession = {
      id: "session-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 100,
      totalCost: 12,
      isActive: true,
      engine: "claude",
      folderId: "folder-1",
      pinned: true,
      branch: "feature/test",
    };
    const messages: UIMessage[] = [{
      id: "message-1",
      role: "user",
      content: "hi",
      timestamp: 101,
    }];

    const persisted = buildPersistedSession(session, messages, 12, null);

    expect(persisted.folderId).toBe("folder-1");
    expect(persisted.pinned).toBe(true);
    expect(persisted.branch).toBe("feature/test");
    expect(persisted.messages).toEqual(messages);
  });
});
