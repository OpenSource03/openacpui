import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSidebarDragPayload,
  getSidebarDragPayload,
  handleSidebarFolderDrop,
  setSidebarDragPayload,
  writeSidebarDragPayload,
} from "./sidebar-dnd";

function createEvent(data: Record<string, string>) {
  return {
    dataTransfer: {
      getData: (type: string) => data[type] ?? "",
      setData: (type: string, value: string) => {
        data[type] = value;
      },
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

afterEach(() => {
  clearSidebarDragPayload();
});

describe("handleSidebarFolderDrop", () => {
  it("moves a dragged session into the target folder and stops bubbling", () => {
    const event = createEvent({
      "application/x-session-id": "session-1",
    });
    const onMoveSessionToFolder = vi.fn();
    const onReorderFolder = vi.fn();

    handleSidebarFolderDrop(event, "folder-2", {
      onMoveSessionToFolder,
      onReorderFolder,
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(onMoveSessionToFolder).toHaveBeenCalledWith("session-1", "folder-2");
    expect(onReorderFolder).not.toHaveBeenCalled();
  });

  it("uses the in-memory drag payload when dragover metadata is unavailable", () => {
    const event = createEvent({});
    const onMoveSessionToFolder = vi.fn();
    const onReorderFolder = vi.fn();
    setSidebarDragPayload({ kind: "session", id: "session-1" });

    handleSidebarFolderDrop(event, "folder-2", {
      onMoveSessionToFolder,
      onReorderFolder,
    });

    expect(onMoveSessionToFolder).toHaveBeenCalledWith("session-1", "folder-2");
    expect(onReorderFolder).not.toHaveBeenCalled();
  });

  it("reorders folders when another folder is dropped on the target folder", () => {
    const event = createEvent({
      "application/x-folder-id": "folder-1",
    });
    const onMoveSessionToFolder = vi.fn();
    const onReorderFolder = vi.fn();

    handleSidebarFolderDrop(event, "folder-2", {
      onMoveSessionToFolder,
      onReorderFolder,
    });

    expect(onMoveSessionToFolder).not.toHaveBeenCalled();
    expect(onReorderFolder).toHaveBeenCalledWith("folder-1", "folder-2");
  });

  it("ignores drops for the same folder id", () => {
    const event = createEvent({
      "application/x-folder-id": "folder-2",
    });
    const onMoveSessionToFolder = vi.fn();
    const onReorderFolder = vi.fn();

    handleSidebarFolderDrop(event, "folder-2", {
      onMoveSessionToFolder,
      onReorderFolder,
    });

    expect(onMoveSessionToFolder).not.toHaveBeenCalled();
    expect(onReorderFolder).not.toHaveBeenCalled();
  });
});

describe("sidebar drag payload helpers", () => {
  it("writes and reads the shared payload with legacy transfer fallbacks", () => {
    const event = createEvent({});

    writeSidebarDragPayload(event.dataTransfer, {
      kind: "session",
      id: "session-1",
    });

    expect(getSidebarDragPayload(event.dataTransfer)).toEqual({
      kind: "session",
      id: "session-1",
    });
    expect(event.dataTransfer.getData("application/x-session-id")).toBe("session-1");
  });
});
