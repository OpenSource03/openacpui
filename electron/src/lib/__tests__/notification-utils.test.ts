import { beforeEach, describe, expect, it } from "vitest";
import {
  advanceSessionCompletionTracker,
  consumeSuppressedSessionCompletion,
  resetNotificationStateForTesting,
  suppressNextSessionCompletion,
  shouldNotifyPermissionRequest,
} from "../../../../src/lib/notification-utils";

beforeEach(() => {
  resetNotificationStateForTesting();
});

describe("advanceSessionCompletionTracker", () => {
  it("marks a real completion in the same session", () => {
    expect(advanceSessionCompletionTracker(
      { sessionId: "session-a", isProcessing: true },
      { sessionId: "session-a", isProcessing: false },
    )).toEqual({
      completed: true,
      tracked: { sessionId: "session-a", isProcessing: false },
    });
  });

  it("resets tracking when switching from a busy session to a different idle session", () => {
    expect(advanceSessionCompletionTracker(
      { sessionId: "session-a", isProcessing: true },
      { sessionId: "session-b", isProcessing: false },
    )).toEqual({
      completed: false,
      tracked: { sessionId: "session-b", isProcessing: false },
    });
  });

  it("drops carried-over busy state on the first render after switching chats", () => {
    const firstRender = advanceSessionCompletionTracker(
      { sessionId: "session-a", isProcessing: true },
      { sessionId: "session-b", isProcessing: true },
    );

    expect(firstRender).toEqual({
      completed: false,
      tracked: { sessionId: "session-b", isProcessing: false },
    });

    expect(advanceSessionCompletionTracker(
      firstRender.tracked,
      { sessionId: "session-b", isProcessing: false },
    )).toEqual({
      completed: false,
      tracked: { sessionId: "session-b", isProcessing: false },
    });
  });
});

describe("shouldNotifyPermissionRequest", () => {
  it("fires once for a given session/request pair", () => {
    const seen = new Set<string>();

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-1",
    })).toBe(true);

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-1",
    })).toBe(false);
  });

  it("suppresses replay when the same open request moves between foreground and background", () => {
    const seen = new Set<string>();

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-1",
    })).toBe(true);

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-1",
    })).toBe(false);
  });

  it("allows different sessions or requests to notify independently", () => {
    const seen = new Set<string>();

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-1",
    })).toBe(true);

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-2",
    })).toBe(true);

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-b",
      requestId: "req-1",
    })).toBe(true);
  });
});

describe("session completion suppression", () => {
  it("consumes one suppressed completion per session", () => {
    suppressNextSessionCompletion("session-a");

    expect(consumeSuppressedSessionCompletion("session-a")).toBe(true);
    expect(consumeSuppressedSessionCompletion("session-a")).toBe(false);
  });

  it("tracks repeated suppressions independently", () => {
    suppressNextSessionCompletion("session-a");
    suppressNextSessionCompletion("session-a");

    expect(consumeSuppressedSessionCompletion("session-a")).toBe(true);
    expect(consumeSuppressedSessionCompletion("session-a")).toBe(true);
    expect(consumeSuppressedSessionCompletion("session-a")).toBe(false);
  });
});
