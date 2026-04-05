/**
 * Codex authentication dialog.
 *
 * Shown when a Codex session requires authentication (API key or ChatGPT OAuth login).
 * The dialog appears as a modal overlay and blocks interaction until auth completes.
 */

import { memo, useState, useCallback, useEffect, useRef } from "react";
import { Key, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthDialogShell } from "@/components/AuthDialogShell";
import type { CodexSessionEvent } from "@/types";
import type { AccountLoginCompletedNotification } from "@/types/codex-protocol/v2/AccountLoginCompletedNotification";
import { reportError } from "@/lib/analytics/analytics";

/** Typed result from `codex.login` — either a chatgpt OAuth redirect or an error. */
interface CodexLoginSuccess {
  type: "apiKey" | "chatgpt" | "chatgptAuthTokens";
  authUrl?: string;
  loginId?: string;
}

interface CodexLoginError {
  error: string;
}

type CodexLoginResult = CodexLoginSuccess | CodexLoginError;

function isLoginError(result: unknown): result is CodexLoginError {
  return result != null && typeof result === "object" && "error" in result;
}

/** Auth completion timeout — 30s safety net for slow machines / OAuth round-trips. */
const AUTH_TIMEOUT_MS = 30_000;

/**
 * Subscribes to Codex session events and waits for `account/login/completed`
 * matching the given session. Resolves on success, rejects on failure or timeout.
 * Always cleans up the event listener.
 */
function waitForLoginCompletion(sessionId: string): { promise: Promise<void>; cancel: () => void } {
  let cleanup: (() => void) | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const promise = new Promise<void>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      cleanup?.();
      if (!cancelled) reject(new Error("Login timed out — please try again"));
    }, AUTH_TIMEOUT_MS);

    cleanup = window.claude.codex.onEvent((event: CodexSessionEvent) => {
      if (event._sessionId !== sessionId) return;
      if (event.method !== "account/login/completed") return;

      const params = event.params as AccountLoginCompletedNotification;
      clearTimeout(timeoutId);
      cleanup?.();

      if (params.success) {
        resolve();
      } else {
        reject(new Error(params.error ?? "Login failed"));
      }
    });
  });

  const cancel = () => {
    cancelled = true;
    clearTimeout(timeoutId);
    cleanup?.();
  };

  return { promise, cancel };
}

interface CodexAuthDialogProps {
  sessionId: string;
  onComplete: () => void;
  onCancel: () => void;
}

export const CodexAuthDialog = memo(function CodexAuthDialog({
  sessionId,
  onComplete,
  onCancel,
}: CodexAuthDialogProps) {
  const [mode, setMode] = useState<"choose" | "apiKey" | "chatgpt">("choose");
  const [apiKey, setApiKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the active login waiter so we can cancel on unmount or mode switch
  const loginWaiterRef = useRef<{ cancel: () => void } | null>(null);

  // Clean up any pending login waiter on unmount
  useEffect(() => {
    return () => { loginWaiterRef.current?.cancel(); };
  }, []);

  const handleApiKeySubmit = useCallback(async () => {
    if (!apiKey.trim()) return;
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.claude.codex.login(sessionId, "apiKey", apiKey.trim()) as CodexLoginResult | null;
      if (isLoginError(result)) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      // Wait for the account/login/completed notification from the Codex process
      const waiter = waitForLoginCompletion(sessionId);
      loginWaiterRef.current = waiter;
      await waiter.promise;
      loginWaiterRef.current = null;
      onComplete();
    } catch (err) {
      loginWaiterRef.current = null;
      const message = err instanceof Error ? err.message : "Login failed";
      reportError("[CodexAuthDialog] API key login", err);
      setError(message);
      setIsLoading(false);
    }
  }, [sessionId, apiKey, onComplete]);

  const handleChatGptLogin = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.claude.codex.login(sessionId, "chatgpt") as CodexLoginResult | null;
      if (isLoginError(result)) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      if (result && "authUrl" in result && typeof result.authUrl === "string") {
        window.open(result.authUrl, "_blank");
      }

      // Wait for the account/login/completed notification from the Codex process
      const waiter = waitForLoginCompletion(sessionId);
      loginWaiterRef.current = waiter;
      await waiter.promise;
      loginWaiterRef.current = null;
      onComplete();
    } catch (err) {
      loginWaiterRef.current = null;
      const message = err instanceof Error ? err.message : "Login failed";
      reportError("[CodexAuthDialog] ChatGPT login", err);
      setError(message);
      setIsLoading(false);
    }
  }, [sessionId, onComplete]);

  // The chatgpt mode shows its own full-body loading state with an inline cancel
  // button, so we use the shell's `loadingText` for that and hide the footer cancel.
  const isChatGptWaiting = mode === "chatgpt";

  return (
    <AuthDialogShell
      open
      onClose={onCancel}
      title="Codex Authentication"
      description="Codex requires authentication to access OpenAI models."
      error={error}
      loading={isChatGptWaiting}
      loadingText="Waiting for browser login..."
      showCancelButton={isChatGptWaiting}
    >
      {mode === "choose" && (
        <div className="flex flex-col gap-3">
          <Button
            variant="outline"
            className="h-12 justify-start gap-3"
            onClick={() => setMode("apiKey")}
          >
            <Key className="h-4 w-4 shrink-0" />
            <div className="text-start">
              <div className="text-sm font-medium">API Key</div>
              <div className="text-xs text-muted-foreground">Use an OpenAI API key</div>
            </div>
          </Button>
          <Button
            variant="outline"
            className="h-12 justify-start gap-3"
            onClick={() => {
              setMode("chatgpt");
              handleChatGptLogin();
            }}
          >
            <ExternalLink className="h-4 w-4 shrink-0" />
            <div className="text-start">
              <div className="text-sm font-medium">ChatGPT Login</div>
              <div className="text-xs text-muted-foreground">Login with your ChatGPT account</div>
            </div>
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel} className="mt-2">
            Cancel
          </Button>
        </div>
      )}

      {mode === "apiKey" && (
        <div className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleApiKeySubmit()}
            className="h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode("choose")} disabled={isLoading}>
              Back
            </Button>
            <Button
              size="sm"
              onClick={handleApiKeySubmit}
              disabled={!apiKey.trim() || isLoading}
              className="ms-auto"
            >
              {isLoading && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
              Connect
            </Button>
          </div>
        </div>
      )}
    </AuthDialogShell>
  );
});
