import { createContext, useContext, type ReactNode } from "react";

/** Callbacks shared across all sidebar leaf components (sessions, folders, branches). */
export interface SidebarActions {
  /** Select/switch to a session. */
  selectSession: (id: string) => void;
  /** Delete a session by ID (permanent). */
  deleteSession: (id: string) => void;
  /** Archive a session — hides it from the main list, keeps its data. */
  archiveSession: (id: string) => void;
  /** Unarchive a previously archived session. */
  unarchiveSession: (id: string) => void;
  /** Rename a session. */
  renameSession: (id: string, title: string) => void;
  /** Toggle pin state on a session. */
  pinSession: (sessionId: string, pinned: boolean) => void;
  /** Move a session into (or out of) a folder. Pass `null` to remove from folder. */
  moveSessionToFolder: (sessionId: string, folderId: string | null) => void;
  /** Toggle pin state on a folder. */
  pinFolder: (projectId: string, folderId: string, pinned: boolean) => void;
  /** Rename a folder. */
  renameFolder: (projectId: string, folderId: string, name: string) => void;
  /** Delete a folder. */
  deleteFolder: (projectId: string, folderId: string) => void;
  /** Open a session in split view. Undefined when split view is unavailable. */
  openInSplitView?: (sessionId: string) => void;
  /** Check whether a session can be opened in split view. Undefined when split view is unavailable. */
  canOpenSessionInSplitView?: (sessionId: string) => boolean;
}

const SidebarActionsContext = createContext<SidebarActions | null>(null);

export function SidebarActionsProvider({ children, value }: { children: ReactNode; value: SidebarActions }) {
  return (
    <SidebarActionsContext.Provider value={value}>
      {children}
    </SidebarActionsContext.Provider>
  );
}

export function useSidebarActions(): SidebarActions {
  const ctx = useContext(SidebarActionsContext);
  if (!ctx) {
    throw new Error("useSidebarActions must be used within a SidebarActionsProvider");
  }
  return ctx;
}
