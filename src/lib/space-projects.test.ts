import { describe, expect, it } from "vitest";
import { resolveProjectForSpace } from "@/lib/space-projects";
import type { ChatSession, Project } from "@/types";

const projects: Project[] = [
  {
    id: "project-a",
    name: "Project A",
    path: "/tmp/project-a",
    createdAt: 1,
    spaceId: "space-a",
  },
  {
    id: "project-b",
    name: "Project B",
    path: "/tmp/project-b",
    createdAt: 2,
    spaceId: "space-b",
  },
  {
    id: "project-c",
    name: "Project C",
    path: "/tmp/project-c",
    createdAt: 3,
    spaceId: "space-b",
  },
];

const sessions: Pick<ChatSession, "id" | "projectId">[] = [
  { id: "session-a", projectId: "project-a" },
  { id: "session-b", projectId: "project-b" },
];

describe("resolveProjectForSpace", () => {
  it("keeps the active project when it already belongs to the selected space", () => {
    expect(resolveProjectForSpace({
      spaceId: "space-a",
      activeProjectId: "project-a",
      lastSessionBySpace: {},
      projects,
      sessions,
    })?.id).toBe("project-a");
  });

  it("falls back to the remembered session project when the active project lags behind the space switch", () => {
    expect(resolveProjectForSpace({
      spaceId: "space-b",
      activeProjectId: "project-a",
      lastSessionBySpace: { "space-b": "session-b" },
      projects,
      sessions,
    })?.id).toBe("project-b");
  });

  it("falls back to the first project in the space when there is no remembered session", () => {
    expect(resolveProjectForSpace({
      spaceId: "space-b",
      activeProjectId: "project-a",
      lastSessionBySpace: {},
      projects,
      sessions,
    })?.id).toBe("project-b");
  });
});
