import { useState } from "react";
import { GitBranch, ChevronRight } from "lucide-react";
import type { ChatFolder, InstalledAgent } from "@/types";
import type { FolderSidebarItem, SessionSidebarItem } from "@/lib/sidebar/grouping";
import { FolderSection } from "./FolderSection";
import { SessionItem } from "./SessionItem";
import { useSidebarActions } from "./SidebarActionsContext";

export function BranchSection({
  branchName,
  children,
  activeSessionId,
  islandLayout,
  allFolders,
  agents,
}: {
  branchName: string;
  children: Array<FolderSidebarItem | SessionSidebarItem>;
  activeSessionId: string | null;
  islandLayout: boolean;
  allFolders: ChatFolder[];
  agents?: InstalledAgent[];
}) {
  const {
    selectSession,
    deleteSession,
    renameSession,
    pinSession,
    moveSessionToFolder,
    pinFolder,
    renameFolder,
    deleteFolder,
    openInSplitView,
    canOpenSessionInSplitView,
  } = useSidebarActions();
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      {/* Branch header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-start text-[12px] font-semibold text-sidebar-foreground/55 transition-all hover:bg-black/5 hover:text-sidebar-foreground/80 dark:hover:bg-white/5"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-sidebar-foreground/35 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40" />
        <span className="min-w-0 truncate">{branchName}</span>
      </button>

      {/* Branch contents */}
      {expanded && (
        <div className="ms-2">
          {children.map((item) => {
            if (item.type === "folder") {
              const { folder } = item;
              return (
                <FolderSection
                  key={`folder-${folder.id}`}
                  folder={folder}
                  sessions={item.sessions}
                  activeSessionId={activeSessionId}
                  islandLayout={islandLayout}
                  allFolders={allFolders}
                  onPinFolder={(pinned) => pinFolder(folder.projectId, folder.id, pinned)}
                  onRenameFolder={(name) => renameFolder(folder.projectId, folder.id, name)}
                  onDeleteFolder={() => deleteFolder(folder.projectId, folder.id)}
                  agents={agents}
                />
              );
            }
            const { session } = item;
            return (
              <SessionItem
                key={session.id}
                islandLayout={islandLayout}
                session={session}
                isActive={session.id === activeSessionId}
                onSelect={() => selectSession(session.id)}
                onDelete={() => deleteSession(session.id)}
                onRename={(title) => renameSession(session.id, title)}
                onPinToggle={() => pinSession(session.id, !session.pinned)}
                folders={allFolders}
                onMoveToFolder={(folderId) => moveSessionToFolder(session.id, folderId)}
                agents={agents}
                onOpenInSplitView={openInSplitView ? () => openInSplitView(session.id) : undefined}
                canOpenInSplitView={canOpenSessionInSplitView?.(session.id) ?? true}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
