type SidebarDragKind = "session" | "folder" | "project";

const SIDEBAR_DRAG_KIND_MIME = "application/x-harnss-sidebar-drag-kind";
const SIDEBAR_DRAG_ID_MIME = "application/x-harnss-sidebar-drag-id";

interface SidebarTransferLike {
  getData: (type: string) => string;
  setData?: (type: string, value: string) => void;
}

interface SidebarDropEventLike {
  dataTransfer: SidebarTransferLike;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface SidebarDragPayload {
  kind: SidebarDragKind;
  id: string;
}

interface FolderDropHandlers {
  onMoveSessionToFolder: (sessionId: string, folderId: string) => void;
  onReorderFolder: (folderId: string, targetFolderId: string) => void;
}

let currentSidebarDragPayload: SidebarDragPayload | null = null;

export function setSidebarDragPayload(payload: SidebarDragPayload): void {
  currentSidebarDragPayload = payload;
}

export function clearSidebarDragPayload(): void {
  currentSidebarDragPayload = null;
}

export function writeSidebarDragPayload(
  dataTransfer: SidebarTransferLike,
  payload: SidebarDragPayload,
): void {
  setSidebarDragPayload(payload);

  dataTransfer.setData?.(SIDEBAR_DRAG_KIND_MIME, payload.kind);
  dataTransfer.setData?.(SIDEBAR_DRAG_ID_MIME, payload.id);

  if (payload.kind === "session") {
    dataTransfer.setData?.("application/x-session-id", payload.id);
    dataTransfer.setData?.("text/plain", payload.id);
    return;
  }

  if (payload.kind === "folder") {
    dataTransfer.setData?.("application/x-folder-id", payload.id);
    return;
  }

  dataTransfer.setData?.("application/x-project-id", payload.id);
}

export function getSidebarDragPayload(
  dataTransfer?: SidebarTransferLike,
): SidebarDragPayload | null {
  if (currentSidebarDragPayload) return currentSidebarDragPayload;
  if (!dataTransfer) return null;

  const kind = dataTransfer.getData(SIDEBAR_DRAG_KIND_MIME);
  const id = dataTransfer.getData(SIDEBAR_DRAG_ID_MIME);
  if (
    (kind === "session" || kind === "folder" || kind === "project") &&
    id
  ) {
    return { kind, id };
  }

  const sessionId = dataTransfer.getData("application/x-session-id");
  if (sessionId) return { kind: "session", id: sessionId };

  const folderId = dataTransfer.getData("application/x-folder-id");
  if (folderId) return { kind: "folder", id: folderId };

  const projectId = dataTransfer.getData("application/x-project-id");
  if (projectId) return { kind: "project", id: projectId };

  return null;
}

export function isSidebarDragKind(
  expectedKind: SidebarDragKind,
  dataTransfer?: SidebarTransferLike,
): boolean {
  return getSidebarDragPayload(dataTransfer)?.kind === expectedKind;
}

export function handleSidebarFolderDrop(
  event: SidebarDropEventLike,
  targetFolderId: string,
  handlers: FolderDropHandlers,
): void {
  event.preventDefault();
  event.stopPropagation();

  const payload = getSidebarDragPayload(event.dataTransfer);
  if (!payload) return;

  if (payload.kind === "session") {
    handlers.onMoveSessionToFolder(payload.id, targetFolderId);
    return;
  }

  if (payload.kind === "folder" && payload.id !== targetFolderId) {
    handlers.onReorderFolder(payload.id, targetFolderId);
  }
}
