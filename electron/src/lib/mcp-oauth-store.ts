import { JsonFileStore } from "./json-file-store";

export interface StoredOAuthData {
  tokens?: {
    access_token: string;
    token_type: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  clientInfo?: {
    client_id: string;
    client_secret?: string;
    client_id_issued_at?: number;
    client_secret_expires_at?: number;
  };
  codeVerifier?: string;
  serverUrl: string;
  storedAt: number;
}

const store = new JsonFileStore<StoredOAuthData>({
  subDir: "mcp-oauth",
  sanitizeKey: (key) => key.replace(/[^a-zA-Z0-9_-]/g, "_"),
  encrypt: true,
  label: "MCP_OAUTH",
});

export function loadOAuthData(serverName: string): StoredOAuthData | null {
  return store.load(serverName);
}

export function saveOAuthData(serverName: string, data: StoredOAuthData): void {
  store.save(serverName, data);
}

export function deleteOAuthData(serverName: string): void {
  store.delete(serverName);
}
