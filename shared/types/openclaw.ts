export interface OpenClawSessionEvent {
  _sessionId: string;
  type:
    | "chat:delta"
    | "chat:final"
    | "chat:error"
    | "lifecycle:start"
    | "lifecycle:end"
    | "tool:start"
    | "tool:result"
    | "thinking:delta"
    | "thinking:done"
    | "agent:spawn"
    | "agent:step"
    | "agent:message"
    | "agent:complete"
    | "status";
  payload: Record<string, unknown>;
}

export interface OpenClawToolEvent {
  _sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  requestId: string;
}

export interface OpenClawExitEvent {
  _sessionId: string;
  code: number | null;
  error?: string;
}

export interface OpenClawConnectResult {
  sessionId?: string;
  gatewayVersion?: string;
  error?: string;
}

export interface OpenClawStartOptions {
  cwd: string;
  gatewayUrl?: string;
  model?: string;
  skills?: string[];
}
