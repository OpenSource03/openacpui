import { extractFiles, extractFilePath, getToolAccess, type FileAccess } from "./file-access";
import {
  extractAllFileChanges,
  extractTurnSummaries,
  groupChangesByFile,
  type FileChange,
  type TurnSummary,
} from "./turn-changes";
import type { UIMessage } from "../types";

export interface FilePanelData {
  files: FileAccess[];
  lastToolCallIdByFile: Map<string, string>;
}

export interface ChangesPanelData {
  turnSummaries: TurnSummary[];
  allChanges: FileChange[];
  groupedByFile: Map<string, FileChange[]>;
}

interface CacheEntry<T> {
  cacheKey: string;
  value: T;
}

const MAX_CACHE_ENTRIES = 12;

const filePanelCache = new Map<string, CacheEntry<FilePanelData>>();
const changesPanelCache = new Map<string, CacheEntry<ChangesPanelData>>();

function touchCacheEntry<T>(cache: Map<string, CacheEntry<T>>, sessionId: string, entry: CacheEntry<T>): void {
  cache.delete(sessionId);
  cache.set(sessionId, entry);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

export function buildSessionCacheKey(
  sessionId: string,
  messages: UIMessage[],
  extra: string,
): string {
  const lastMessage = messages[messages.length - 1];
  return [
    sessionId,
    messages.length,
    lastMessage?.id ?? "none",
    String(lastMessage?.timestamp ?? 0),
    extra,
  ].join(":");
}

export function getCachedFilePanelData(sessionId: string, cacheKey: string): FilePanelData | null {
  const entry = filePanelCache.get(sessionId);
  if (!entry || entry.cacheKey !== cacheKey) return null;
  touchCacheEntry(filePanelCache, sessionId, entry);
  return entry.value;
}

export function computeFilePanelData(
  sessionId: string,
  cacheKey: string,
  messages: UIMessage[],
  cwd?: string,
  includeClaudeMd = false,
): FilePanelData {
  const cached = getCachedFilePanelData(sessionId, cacheKey);
  if (cached) return cached;

  const lastToolCallIdByFile = new Map<string, string>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "tool_call" || !msg.toolName || !msg.toolInput) continue;
    if (!getToolAccess(msg.toolName)) continue;
    const path = extractFilePath(msg.toolName, msg.toolInput);
    if (path && !lastToolCallIdByFile.has(path)) {
      lastToolCallIdByFile.set(path, msg.id);
    }
  }

  const value: FilePanelData = {
    files: extractFiles(messages, cwd, includeClaudeMd),
    lastToolCallIdByFile,
  };
  touchCacheEntry(filePanelCache, sessionId, { cacheKey, value });
  return value;
}

export function getCachedChangesPanelData(sessionId: string, cacheKey: string): ChangesPanelData | null {
  const entry = changesPanelCache.get(sessionId);
  if (!entry || entry.cacheKey !== cacheKey) return null;
  touchCacheEntry(changesPanelCache, sessionId, entry);
  return entry.value;
}

export function computeChangesPanelData(
  sessionId: string,
  cacheKey: string,
  messages: UIMessage[],
  isProcessing: boolean,
): ChangesPanelData {
  const cached = getCachedChangesPanelData(sessionId, cacheKey);
  if (cached) return cached;

  const allChanges = extractAllFileChanges(messages);
  const value: ChangesPanelData = {
    turnSummaries: extractTurnSummaries(messages, isProcessing),
    groupedByFile: groupChangesByFile(allChanges),
    allChanges,
  };
  touchCacheEntry(changesPanelCache, sessionId, { cacheKey, value });
  return value;
}
