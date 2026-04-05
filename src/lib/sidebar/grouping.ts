/**
 * Sidebar grouping algorithm for organizing chats into
 * pinned, folders, branches, and ungrouped items.
 */

import type { ChatFolder, ChatSession } from "@/types";

// ── Types ──

interface SidebarItemBase {
  /** Human-readable label for section headers. */
  label: string;
  /** Sort key — newest lastMessageAt within this group. */
  sortTimestamp: number;
}

export interface SessionSidebarItem extends SidebarItemBase {
  type: "session";
  session: ChatSession;
  sessions: [ChatSession];
}

export interface FolderSidebarItem extends SidebarItemBase {
  type: "folder";
  folder: ChatFolder;
  sessions: ChatSession[];
}

export interface BranchSidebarItem extends SidebarItemBase {
  type: "branch";
  branchName: string;
  children: Array<FolderSidebarItem | SessionSidebarItem>;
  sessions: ChatSession[];
}

export interface PinnedSidebarItem extends SidebarItemBase {
  type: "pinned";
  sessions: ChatSession[];
  children?: FolderSidebarItem[];
}

export type SidebarItem =
  | SessionSidebarItem
  | FolderSidebarItem
  | BranchSidebarItem
  | PinnedSidebarItem;

// ── Constants ──

const MAIN_BRANCHES = new Set(["main", "master"]);

/** Sort key: latest user-message timestamp, falling back to creation time. */
export function getSortTimestamp(session: ChatSession): number {
  return session.lastMessageAt ?? session.createdAt;
}

/** Check if a branch name is considered the main/default branch. */
function isMainBranch(branch: string | undefined): boolean {
  return !branch || MAIN_BRANCHES.has(branch);
}

// ── Core algorithm ──

/**
 * Build a sorted list of sidebar items from sessions and folders.
 *
 * Hierarchy:
 * 1. PINNED section (always first if any pinned sessions/folders exist)
 * 2. Everything else interleaved by recency:
 *    - Folders (sort key = newest session inside)
 *    - Branch sections (when organizeByChatBranch is ON, for non-main branches)
 *    - Ungrouped sessions (sort key = own lastMessageAt)
 *
 * When organizeByChatBranch is ON, non-main-branch sessions are wrapped
 * in branch sections. Main-branch sessions appear flat (no wrapper).
 */
export function buildSidebarGroups(
  sessions: ChatSession[],
  folders: ChatFolder[],
  organizeByChatBranch: boolean,
): SidebarItem[] {
  const result: SidebarItem[] = [];

  // 1. Extract pinned sessions and pinned folders
  const pinnedSessions = sessions.filter((s) => s.pinned);
  const unpinned = sessions.filter((s) => !s.pinned);
  const pinnedFolders = folders.filter((f) => f.pinned);
  const unpinnedFolders = folders.filter((f) => !f.pinned);

  if (pinnedSessions.length > 0 || pinnedFolders.length > 0) {
    const sortedSessions = [...pinnedSessions].sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a));

    // Build pinned folder items with their sessions
    const pinnedFolderItems: FolderSidebarItem[] = pinnedFolders.map((folder) => {
      const folderSessions = sessions
        .filter((s) => s.folderId === folder.id)
        .sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a));
      const newestTs = folderSessions.length > 0 ? getSortTimestamp(folderSessions[0]) : folder.createdAt;
      return {
        type: "folder" as const,
        label: folder.name,
        folder,
        sortTimestamp: newestTs,
        sessions: folderSessions,
      };
    });

    const pinnedItem: PinnedSidebarItem = {
      type: "pinned",
      label: "Pinned",
      sortTimestamp: sortedSessions.length > 0 ? getSortTimestamp(sortedSessions[0]) : Date.now(),
      sessions: sortedSessions,
      children: pinnedFolderItems.length > 0 ? pinnedFolderItems : undefined,
    };
    result.push(pinnedItem);
  }

  // 2. Build the interleaved list (exclude pinned folders and their sessions from the normal flow)
  const pinnedFolderIds = new Set(pinnedFolders.map((f) => f.id));
  const unpinnedNotInPinnedFolder = unpinned.filter((s) => !s.folderId || !pinnedFolderIds.has(s.folderId));
  if (organizeByChatBranch) {
    buildWithBranches(unpinnedNotInPinnedFolder, unpinnedFolders, result);
  } else {
    buildFlat(unpinnedNotInPinnedFolder, unpinnedFolders, result);
  }

  return result;
}

/**
 * Flat mode (no branch grouping):
 * - Folders sorted by newest session activity
 * - Ungrouped sessions sorted by lastMessageAt
 * - All interleaved into a single sorted list
 */
function buildFlat(
  sessions: ChatSession[],
  folders: ChatFolder[],
  result: SidebarItem[],
): void {
  const items: SidebarItem[] = [];
  const folderMap = new Map<string, ChatFolder>(folders.map((f) => [f.id, f]));
  const sessionsByFolder = new Map<string, ChatSession[]>();
  const ungrouped: ChatSession[] = [];

  // Partition sessions by folder
  for (const session of sessions) {
    if (session.folderId && folderMap.has(session.folderId)) {
      const arr = sessionsByFolder.get(session.folderId) ?? [];
      arr.push(session);
      sessionsByFolder.set(session.folderId, arr);
    } else {
      ungrouped.push(session);
    }
  }

  // Create folder items
  for (const folder of folders) {
    const folderSessions = sessionsByFolder.get(folder.id) ?? [];
    const sorted = [...folderSessions].sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a));
    // Empty folders use createdAt so newly created folders appear at the top
    const newestTs = sorted.length > 0 ? getSortTimestamp(sorted[0]) : folder.createdAt;
    const folderItem: FolderSidebarItem = {
      type: "folder",
      label: folder.name,
      folder,
      sortTimestamp: newestTs,
      sessions: sorted,
    };
    items.push(folderItem);
  }

  // Create ungrouped session items
  for (const session of ungrouped) {
    const sessionItem: SessionSidebarItem = {
      type: "session",
      label: session.title,
      session,
      sortTimestamp: getSortTimestamp(session),
      sessions: [session],
    };
    items.push(sessionItem);
  }

  // Sort all items by recency (folders use createdAt when empty)
  items.sort((a, b) => b.sortTimestamp - a.sortTimestamp);

  result.push(...items);
}

/**
 * Branch mode:
 * - Non-main-branch sessions are wrapped in branch sections
 * - Main-branch sessions appear flat (folders + ungrouped)
 * - Everything is interleaved by recency
 */
function buildWithBranches(
  sessions: ChatSession[],
  folders: ChatFolder[],
  result: SidebarItem[],
): void {
  const items: SidebarItem[] = [];
  const folderMap = new Map<string, ChatFolder>(folders.map((f) => [f.id, f]));
  const folderIdsWithAnySessions = new Set(
    sessions.flatMap((session) => (session.folderId ? [session.folderId] : [])),
  );

  // Partition sessions by branch
  const branchBuckets = new Map<string, ChatSession[]>();
  const mainSessions: ChatSession[] = [];

  for (const session of sessions) {
    if (isMainBranch(session.branch)) {
      mainSessions.push(session);
    } else {
      const branch = session.branch!;
      const arr = branchBuckets.get(branch) ?? [];
      arr.push(session);
      branchBuckets.set(branch, arr);
    }
  }

  // Create branch section items for non-main branches
  for (const [branchName, branchSessions] of branchBuckets) {
    const children = buildBranchChildren(branchSessions, folderMap);
    const newestTs = branchSessions.reduce(
      (max, s) => Math.max(max, getSortTimestamp(s)),
      0,
    );
    const branchItem: BranchSidebarItem = {
      type: "branch",
      label: branchName,
      branchName,
      sortTimestamp: newestTs,
      sessions: branchSessions,
      children,
    };
    items.push(branchItem);
  }

  // Main-branch sessions: build flat items (folders + ungrouped)
  const mainFolderItems = buildFlatItems(mainSessions, folderMap);
  items.push(...mainFolderItems);

  // Empty folders are not branch-specific, so keep them at the top level.
  for (const folder of folders) {
    if (folderIdsWithAnySessions.has(folder.id)) continue;
    const emptyFolderItem: FolderSidebarItem = {
      type: "folder",
      label: folder.name,
      folder,
      sortTimestamp: folder.createdAt,
      sessions: [],
    };
    items.push(emptyFolderItem);
  }

  // Sort all items by recency (folders use createdAt when empty)
  items.sort((a, b) => {
    return b.sortTimestamp - a.sortTimestamp;
  });

  result.push(...items);
}

/**
 * Build children for a branch section (folders + ungrouped sessions within that branch).
 */
function buildBranchChildren(
  sessions: ChatSession[],
  folderMap: Map<string, ChatFolder>,
): Array<FolderSidebarItem | SessionSidebarItem> {
  return buildFlatItems(sessions, folderMap);
}

/**
 * Build a flat list of folder items + ungrouped session items from a set of sessions.
 * Used both for main-branch flat rendering and within branch sections.
 */
function buildFlatItems(
  sessions: ChatSession[],
  folderMap: Map<string, ChatFolder>,
): Array<FolderSidebarItem | SessionSidebarItem> {
  const items: Array<FolderSidebarItem | SessionSidebarItem> = [];
  const sessionsByFolder = new Map<string, ChatSession[]>();
  const ungrouped: ChatSession[] = [];
  const seenFolderIds = new Set<string>();

  for (const session of sessions) {
    if (session.folderId && folderMap.has(session.folderId)) {
      const arr = sessionsByFolder.get(session.folderId) ?? [];
      arr.push(session);
      sessionsByFolder.set(session.folderId, arr);
      seenFolderIds.add(session.folderId);
    } else {
      ungrouped.push(session);
    }
  }

  // Create folder items only for folders that have sessions in this context
  for (const folderId of seenFolderIds) {
    const folder = folderMap.get(folderId);
    const folderSessions = sessionsByFolder.get(folderId);
    if (!folder || !folderSessions) continue;
    const sorted = [...folderSessions].sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a));
    items.push({
      type: "folder",
      label: folder.name,
      folder,
      sortTimestamp: getSortTimestamp(sorted[0]),
      sessions: sorted,
    });
  }

  // Create ungrouped session items
  for (const session of ungrouped) {
    items.push({
      type: "session",
      label: session.title,
      session,
      sortTimestamp: getSortTimestamp(session),
      sessions: [session],
    });
  }

  // Sort by recency
  items.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
  return items;
}
