import { useCallback, useEffect, useState } from "react";
import { reportError } from "@/lib/analytics/analytics";
import type { ChatFolder, ChatSession, Project } from "@/types";

interface UseFolderManagerOptions {
  projects: Project[];
  setSessions: (updater: (prev: ChatSession[]) => ChatSession[]) => void;
}

interface FolderManager {
  foldersByProject: Record<string, ChatFolder[]>;
  handleCreateFolder: (projectId: string) => Promise<void>;
  handleRenameFolder: (projectId: string, folderId: string, name: string) => Promise<void>;
  handleDeleteFolder: (projectId: string, folderId: string) => Promise<void>;
  handlePinSession: (sessionId: string, pinned: boolean) => Promise<void>;
  handlePinFolder: (projectId: string, folderId: string, pinned: boolean) => Promise<void>;
  handleMoveSessionToFolder: (sessionId: string, folderId: string | null) => Promise<void>;
}

export function useFolderManager({ projects, setSessions }: UseFolderManagerOptions): FolderManager {
  const [foldersByProject, setFoldersByProject] = useState<Record<string, ChatFolder[]>>({});

  // Load folders for all projects on mount and project changes
  useEffect(() => {
    const loadFolders = async () => {
      const result: Record<string, ChatFolder[]> = {};
      for (const project of projects) {
        try {
          result[project.id] = await window.claude.folders.list(project.id);
        } catch {
          result[project.id] = [];
        }
      }
      setFoldersByProject(result);
    };
    loadFolders();
  }, [projects]);

  const handleCreateFolder = useCallback(async (projectId: string) => {
    const name = "New folder";
    try {
      const folder = await window.claude.folders.create(projectId, name);
      setFoldersByProject((prev) => ({
        ...prev,
        [projectId]: [...(prev[projectId] ?? []), folder],
      }));
    } catch (err) {
      reportError("handleCreateFolder", err);
    }
  }, []);

  const handleRenameFolder = useCallback(async (projectId: string, folderId: string, name: string) => {
    try {
      await window.claude.folders.rename(projectId, folderId, name);
      setFoldersByProject((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).map((f) =>
          f.id === folderId ? { ...f, name } : f,
        ),
      }));
    } catch (err) {
      reportError("handleRenameFolder", err);
    }
  }, []);

  const handleDeleteFolder = useCallback(async (projectId: string, folderId: string) => {
    try {
      await window.claude.folders.delete(projectId, folderId);
      setFoldersByProject((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).filter((f) => f.id !== folderId),
      }));
      // Sessions that were in this folder get their folderId cleared on the backend.
      // Update local session state too.
      setSessions((prev) =>
        prev.map((s) => (s.folderId === folderId ? { ...s, folderId: undefined } : s)),
      );
    } catch (err) {
      reportError("handleDeleteFolder", err);
    }
  }, [setSessions]);

  const handlePinSession = useCallback(async (sessionId: string, pinned: boolean) => {
    // Use setSessions functional form to find + update atomically (avoids stale sessions dep)
    setSessions((prev) => {
      const session = prev.find((s) => s.id === sessionId);
      if (!session) return prev;
      // Fire IPC in the background (don't block the state update)
      window.claude.sessions.updateMeta(session.projectId, sessionId, { pinned: pinned || undefined })
        .catch((err) => reportError("handlePinSession", err));
      return prev.map((s) => (s.id === sessionId ? { ...s, pinned: pinned || undefined } : s));
    });
  }, [setSessions]);

  const handlePinFolder = useCallback(async (projectId: string, folderId: string, pinned: boolean) => {
    try {
      await window.claude.folders.pin(projectId, folderId, pinned);
      setFoldersByProject((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).map((f) =>
          f.id === folderId ? { ...f, pinned: pinned || undefined } : f,
        ),
      }));
    } catch (err) {
      reportError("handlePinFolder", err);
    }
  }, []);

  const handleMoveSessionToFolder = useCallback(async (sessionId: string, folderId: string | null) => {
    // Use setSessions functional form to find + update atomically
    setSessions((prev) => {
      const session = prev.find((s) => s.id === sessionId);
      if (!session) return prev;
      window.claude.sessions.updateMeta(session.projectId, sessionId, { folderId })
        .catch((err) => reportError("handleMoveSessionToFolder", err));
      return prev.map((s) => (s.id === sessionId ? { ...s, folderId: folderId ?? undefined } : s));
    });
  }, [setSessions]);

  return {
    foldersByProject,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    handlePinSession,
    handlePinFolder,
    handleMoveSessionToFolder,
  };
}
