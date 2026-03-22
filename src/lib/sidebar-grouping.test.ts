import { describe, expect, it } from "vitest";
import type { ChatFolder, ChatSession } from "@/types";
import { buildSidebarGroups } from "./sidebar-grouping";

function makeFolder(overrides: Partial<ChatFolder> = {}): ChatFolder {
  return {
    id: overrides.id ?? "folder-1",
    projectId: overrides.projectId ?? "project-1",
    name: overrides.name ?? "New folder",
    createdAt: overrides.createdAt ?? 100,
    order: overrides.order ?? 0,
    pinned: overrides.pinned,
  };
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: overrides.id ?? "session-1",
    projectId: overrides.projectId ?? "project-1",
    title: overrides.title ?? "Chat",
    createdAt: overrides.createdAt ?? 10,
    totalCost: overrides.totalCost ?? 0,
    isActive: overrides.isActive ?? false,
    folderId: overrides.folderId,
    pinned: overrides.pinned,
    branch: overrides.branch,
    lastMessageAt: overrides.lastMessageAt,
    model: overrides.model,
    planMode: overrides.planMode,
    engine: overrides.engine,
    agentSessionId: overrides.agentSessionId,
    agentId: overrides.agentId,
    codexThreadId: overrides.codexThreadId,
    isProcessing: overrides.isProcessing,
    hasPendingPermission: overrides.hasPendingPermission,
    titleGenerating: overrides.titleGenerating,
  };
}

describe("buildSidebarGroups", () => {
  it("shows empty folders at the top level in branch mode", () => {
    const emptyFolder = makeFolder({
      id: "folder-empty",
      name: "New folder",
      createdAt: 300,
    });
    const branchSession = makeSession({
      id: "session-branch",
      branch: "feature/test",
      createdAt: 100,
      lastMessageAt: 200,
    });

    const items = buildSidebarGroups([branchSession], [emptyFolder], true);

    expect(items).toHaveLength(2);
    expect(items[0]?.type).toBe("folder");
    expect(items[0]?.folder?.id).toBe("folder-empty");
    expect(items[1]?.type).toBe("branch");
  });

  it("does not duplicate folders that already contain feature-branch chats", () => {
    const activeFolder = makeFolder({
      id: "folder-active",
      name: "Feature work",
      createdAt: 50,
    });
    const branchSession = makeSession({
      id: "session-branch",
      branch: "feature/test",
      folderId: "folder-active",
      createdAt: 100,
      lastMessageAt: 200,
    });

    const items = buildSidebarGroups([branchSession], [activeFolder], true);

    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe("branch");
    expect(items[0]?.children).toHaveLength(1);
    expect(items[0]?.children?.[0]?.type).toBe("folder");
    expect(items[0]?.children?.[0]?.folder?.id).toBe("folder-active");
  });
});
