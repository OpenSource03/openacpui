import type { PermissionRequest } from "@/types";

export interface PermissionQueueState {
  current: PermissionRequest | null;
  queue: PermissionRequest[];
}

interface EnqueuePermissionRequestOptions {
  inFlight: boolean;
  respondingIds: ReadonlySet<string>;
  completedIds: ReadonlySet<string>;
}

export function enqueuePermissionRequest(
  state: PermissionQueueState,
  request: PermissionRequest,
  options: EnqueuePermissionRequestOptions,
): PermissionQueueState {
  if (options.completedIds.has(request.requestId)) return state;
  if (options.respondingIds.has(request.requestId)) return state;
  if (state.current?.requestId === request.requestId) return state;
  if (state.queue.some((queued) => queued.requestId === request.requestId)) return state;

  if (state.current || options.inFlight) {
    return {
      current: state.current,
      queue: [...state.queue, request],
    };
  }

  return {
    current: request,
    queue: state.queue,
  };
}

export function advancePermissionQueue(state: PermissionQueueState): PermissionQueueState {
  const [next, ...rest] = state.queue;
  return {
    current: next ?? null,
    queue: rest,
  };
}
