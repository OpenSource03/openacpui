export function replaceVisibleSessionId(
  visibleSessionIds: string[],
  previousSessionId: string,
  nextSessionId: string,
): string[] {
  const previousId = previousSessionId.trim();
  const nextId = nextSessionId.trim();
  if (!previousId || !nextId || previousId === nextId) {
    return visibleSessionIds;
  }

  if (!visibleSessionIds.includes(previousId)) {
    return visibleSessionIds;
  }

  const mapped = visibleSessionIds.map((sessionId) =>
    sessionId === previousId ? nextId : sessionId,
  );
  const deduped = mapped.filter((sessionId, index) => mapped.indexOf(sessionId) === index);
  return deduped.length > 1 ? deduped : [];
}
