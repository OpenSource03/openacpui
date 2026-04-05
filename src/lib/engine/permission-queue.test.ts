import { describe, expect, it } from "vitest";
import type { PermissionRequest } from "@/types";
import { advancePermissionQueue, enqueuePermissionRequest } from "./permission-queue";

function makeRequest(requestId: string): PermissionRequest {
  return {
    requestId,
    toolName: "Read",
    toolInput: { file_path: `/tmp/${requestId}.txt` },
    toolUseId: `tool-${requestId}`,
  };
}

describe("enqueuePermissionRequest", () => {
  it("sets the first request as current when nothing is pending", () => {
    const request = makeRequest("req-1");

    const state = enqueuePermissionRequest(
      { current: null, queue: [] },
      request,
      {
        inFlight: false,
        respondingIds: new Set(),
        completedIds: new Set(),
      },
    );

    expect(state).toEqual({
      current: request,
      queue: [],
    });
  });

  it("queues later requests in FIFO order while another request is pending", () => {
    const current = makeRequest("req-1");
    const queued = makeRequest("req-2");

    const state = enqueuePermissionRequest(
      { current, queue: [] },
      queued,
      {
        inFlight: false,
        respondingIds: new Set(),
        completedIds: new Set(),
      },
    );

    expect(state).toEqual({
      current,
      queue: [queued],
    });
  });

  it("queues a request while a response is in flight even if no current prompt is mounted", () => {
    const request = makeRequest("req-2");

    const state = enqueuePermissionRequest(
      { current: null, queue: [] },
      request,
      {
        inFlight: true,
        respondingIds: new Set(),
        completedIds: new Set(),
      },
    );

    expect(state).toEqual({
      current: null,
      queue: [request],
    });
  });

  it("ignores duplicate request ids already active, queued, responding, or completed", () => {
    const current = makeRequest("req-1");
    const queued = makeRequest("req-2");
    const duplicateQueued = makeRequest("req-2");
    const duplicateResponding = makeRequest("req-3");
    const duplicateCompleted = makeRequest("req-4");

    const initial = {
      current,
      queue: [queued],
    };

    expect(
      enqueuePermissionRequest(initial, current, {
        inFlight: false,
        respondingIds: new Set(),
        completedIds: new Set(),
      }),
    ).toEqual(initial);

    expect(
      enqueuePermissionRequest(initial, duplicateQueued, {
        inFlight: false,
        respondingIds: new Set(),
        completedIds: new Set(),
      }),
    ).toEqual(initial);

    expect(
      enqueuePermissionRequest(initial, duplicateResponding, {
        inFlight: false,
        respondingIds: new Set(["req-3"]),
        completedIds: new Set(),
      }),
    ).toEqual(initial);

    expect(
      enqueuePermissionRequest(initial, duplicateCompleted, {
        inFlight: false,
        respondingIds: new Set(),
        completedIds: new Set(["req-4"]),
      }),
    ).toEqual(initial);
  });
});

describe("advancePermissionQueue", () => {
  it("promotes the next queued request and preserves order", () => {
    const req1 = makeRequest("req-1");
    const req2 = makeRequest("req-2");
    const req3 = makeRequest("req-3");

    const state = advancePermissionQueue({
      current: req1,
      queue: [req2, req3],
    });

    expect(state).toEqual({
      current: req2,
      queue: [req3],
    });
  });

  it("clears the current request when the queue is empty", () => {
    const req1 = makeRequest("req-1");

    const state = advancePermissionQueue({
      current: req1,
      queue: [],
    });

    expect(state).toEqual({
      current: null,
      queue: [],
    });
  });
});
