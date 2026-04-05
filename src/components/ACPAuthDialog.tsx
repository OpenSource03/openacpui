import { memo, useCallback, useState } from "react";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthDialogShell } from "@/components/AuthDialogShell";
import type { ACPAuthenticateResult, ACPAuthMethod } from "@/types";

interface ACPAuthDialogProps {
  sessionId: string;
  agentId: string | null;
  agentName: string;
  authMethods: ACPAuthMethod[];
  onComplete: (result: ACPAuthenticateResult) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}

export const ACPAuthDialog = memo(function ACPAuthDialog({
  sessionId,
  agentId,
  agentName,
  authMethods,
  onComplete,
  onCancel,
}: ACPAuthDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAuthenticate = useCallback(async (method: ACPAuthMethod) => {
    setIsLoading(true);
    setSelectedMethodId(method.id);
    setError(null);

    try {
      const result = await window.claude.acp.authenticate(sessionId, method.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.authRequired) {
        setError(result.error ?? "Authentication is still required.");
        return;
      }
      await onComplete(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
      setSelectedMethodId(null);
    }
  }, [onComplete, sessionId]);

  const cursorHint = agentId === "cursor" || authMethods.some((method) => method.id === "cursor_login");

  return (
    <AuthDialogShell
      open
      onClose={() => void onCancel()}
      title={`${agentName} Authentication`}
      description="This ACP agent needs authentication before a session can start."
      error={error}
      loading={isLoading}
      icon={<ShieldCheck className="h-4 w-4" />}
    >
      {cursorHint && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/8 p-3 text-sm text-amber-700 dark:text-amber-300">
          Cursor may require running <code>cursor-agent login</code> in a terminal first.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {authMethods.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            No supported authentication methods were advertised by this agent.
          </div>
        )}
        {authMethods.map((method) => {
          const unsupported = method.type === "terminal" || method.type === "env_var";
          return (
            <Button
              key={method.id}
              variant="outline"
              className="h-auto justify-start gap-3 px-4 py-3 text-start"
              disabled={isLoading || unsupported}
              onClick={() => void handleAuthenticate(method)}
            >
              {isLoading && selectedMethodId === method.id ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : method.type === "terminal" || method.type === "env_var" ? (
                <ExternalLink className="h-4 w-4 shrink-0" />
              ) : (
                <ShieldCheck className="h-4 w-4 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium">{method.name}</div>
                {method.description && (
                  <div className="mt-0.5 text-xs text-muted-foreground">{method.description}</div>
                )}
                {method.type === "terminal" && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Terminal auth is not supported in Harnss yet.
                  </div>
                )}
                {method.type === "env_var" && method.vars.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Env-var auth is not supported in Harnss yet. Required vars: {method.vars.map((entry) => entry.name).join(", ")}
                  </div>
                )}
              </div>
            </Button>
          );
        })}
      </div>
    </AuthDialogShell>
  );
});
