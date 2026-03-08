export interface SessionProcessingSnapshot {
  sessionId: string | null;
  isProcessing: boolean;
}

export interface PermissionNotificationSnapshot {
  sessionId: string | null;
  requestId: string;
}

const suppressedSessionCompletionCounts = new Map<string, number>();

/**
 * Advance the active-session completion tracker. When the user switches chats,
 * the engine hook may still expose the previous session's processing state for
 * one render before the new session's restored state is applied. Reset the
 * tracker on session changes so that carry-over state cannot produce a false
 * completion notification.
 */
export function advanceSessionCompletionTracker(
  previous: SessionProcessingSnapshot,
  current: SessionProcessingSnapshot,
): { completed: boolean; tracked: SessionProcessingSnapshot } {
  if (previous.sessionId !== current.sessionId) {
    return {
      completed: false,
      tracked: {
        sessionId: current.sessionId,
        isProcessing: false,
      },
    };
  }

  return {
    completed: !!current.sessionId && previous.isProcessing && !current.isProcessing,
    tracked: current,
  };
}

export function getPermissionNotificationKey(
  snapshot: PermissionNotificationSnapshot,
): string | null {
  if (!snapshot.sessionId || !snapshot.requestId) return null;
  return `${snapshot.sessionId}:${snapshot.requestId}`;
}

/**
 * Returns true only the first time a given session/request pair is observed.
 * The same open permission can move between foreground and background as the
 * user switches chats; that must not replay the notification sound.
 */
export function shouldNotifyPermissionRequest(
  seenKeys: Set<string>,
  snapshot: PermissionNotificationSnapshot,
): boolean {
  const key = getPermissionNotificationKey(snapshot);
  if (!key) return false;
  if (seenKeys.has(key)) return false;
  seenKeys.add(key);
  return true;
}

export function suppressNextSessionCompletion(sessionId: string | null): void {
  if (!sessionId) return;
  suppressedSessionCompletionCounts.set(
    sessionId,
    (suppressedSessionCompletionCounts.get(sessionId) ?? 0) + 1,
  );
}

export function consumeSuppressedSessionCompletion(sessionId: string | null): boolean {
  if (!sessionId) return false;
  const count = suppressedSessionCompletionCounts.get(sessionId) ?? 0;
  if (count <= 0) return false;
  if (count === 1) suppressedSessionCompletionCounts.delete(sessionId);
  else suppressedSessionCompletionCounts.set(sessionId, count - 1);
  return true;
}

export function resetNotificationStateForTesting(): void {
  suppressedSessionCompletionCounts.clear();
}
