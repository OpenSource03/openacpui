/**
 * Tiny helpers for clearing per-session composer draft state from outside the
 * InputBar component (e.g. when a session is deleted). Kept in lib/ instead
 * of buried in the component so unrelated code paths can reach it without
 * importing the whole input-bar bundle.
 */

const DRAFT_KEY_PREFIX = "harnss-composer-draft-";
const GRABBED_STORAGE_KEY = "harnss-grabbed-elements-by-session";

/** Clear the composer draft (text + attachments) for one sessionId. */
export function clearComposerDraftForSession(sessionId: string): void {
  try {
    localStorage.removeItem(DRAFT_KEY_PREFIX + sessionId);
  } catch { /* private mode / quota / etc. */ }
}

/** Clear the browser-grab bucket for one sessionId. */
export function clearGrabbedElementsForSession(sessionId: string): void {
  try {
    const raw = localStorage.getItem(GRABBED_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    if (!(sessionId in parsed)) return;
    delete parsed[sessionId];
    if (Object.keys(parsed).length === 0) {
      localStorage.removeItem(GRABBED_STORAGE_KEY);
    } else {
      localStorage.setItem(GRABBED_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch { /* malformed json — leave it alone */ }
}

/**
 * Convenience: clear both composer draft and grabs in one call. Used by
 * session-delete and session-archive flows.
 */
export function clearAllComposerStateForSession(sessionId: string): void {
  clearComposerDraftForSession(sessionId);
  clearGrabbedElementsForSession(sessionId);
}
