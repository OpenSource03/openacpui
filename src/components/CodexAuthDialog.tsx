/**
 * Codex authentication dialog.
 *
 * Shown when a Codex session requires authentication (API key or ChatGPT OAuth login).
 * The dialog appears as a modal overlay and blocks interaction until auth completes.
 */

import { memo, useState, useCallback } from "react";
import { Key, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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

  const handleApiKeySubmit = useCallback(async () => {
    if (!apiKey.trim()) return;
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.claude.codex.login(sessionId, "apiKey", apiKey.trim());
      if (result && typeof result === "object" && "error" in result) {
        setError(String((result as Record<string, unknown>).error));
        setIsLoading(false);
        return;
      }
      // Wait briefly for account/login/completed notification
      await new Promise((r) => setTimeout(r, 500));
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setIsLoading(false);
    }
  }, [sessionId, apiKey, onComplete]);

  const handleChatGptLogin = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = (await window.claude.codex.login(sessionId, "chatgpt")) as Record<string, unknown> | null;
      if (result && "authUrl" in result && typeof result.authUrl === "string") {
        // Open the OAuth URL in the default browser
        window.open(result.authUrl, "_blank");
      }
      // The login completes asynchronously via account/login/completed notification
      // We'll listen for it in the parent component
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setIsLoading(false);
    }
  }, [sessionId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">Codex Authentication</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Codex requires authentication to access OpenAI models.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

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

        {mode === "chatgpt" && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Waiting for browser login...
            </p>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});
