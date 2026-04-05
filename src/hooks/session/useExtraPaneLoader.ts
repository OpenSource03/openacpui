/**
 * useExtraPaneLoader — loads session bootstrap data for one split view pane.
 *
 * The hook only marks a pane as ready after the bootstrap data has been loaded,
 * which prevents engine hooks from binding to a session ID before their initial
 * messages and metadata are available.
 */

import { useEffect, useRef, useState, startTransition } from "react";
import type { ChatSession, PermissionRequest, SlashCommand, UIMessage, ACPConfigOption, ACPPermissionEvent } from "@/types";
import type { InitialMeta, SessionPaneBootstrap } from "./types";

interface ExtraPaneLoaderResult {
  readyId: string | null;
  session: ChatSession | null;
  initialMessages: UIMessage[];
  initialMeta: InitialMeta | null;
  initialPermission: PermissionRequest | null;
  initialConfigOptions: ACPConfigOption[];
  initialSlashCommands: SlashCommand[];
  initialRawAcpPermission: ACPPermissionEvent | null;
}

interface UseExtraPaneLoaderOptions {
  sessionId: string | null;
  loadBootstrap: (sessionId: string) => Promise<SessionPaneBootstrap | null>;
}

export function useExtraPaneLoader({
  sessionId,
  loadBootstrap,
}: UseExtraPaneLoaderOptions): ExtraPaneLoaderResult {
  const [readyId, setReadyId] = useState<string | null>(null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [initialMeta, setInitialMeta] = useState<InitialMeta | null>(null);
  const [initialPermission, setInitialPermission] = useState<PermissionRequest | null>(null);
  const [initialConfigOptions, setInitialConfigOptions] = useState<ACPConfigOption[]>([]);
  const [initialSlashCommands, setInitialSlashCommands] = useState<SlashCommand[]>([]);
  const [initialRawAcpPermission, setInitialRawAcpPermission] = useState<ACPPermissionEvent | null>(null);

  const latestSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (sessionId === latestSessionIdRef.current) {
      return;
    }
    latestSessionIdRef.current = sessionId;

    if (!sessionId) {
      startTransition(() => {
        setReadyId(null);
        setSession(null);
        setInitialMessages([]);
        setInitialMeta(null);
        setInitialPermission(null);
        setInitialConfigOptions([]);
        setInitialSlashCommands([]);
        setInitialRawAcpPermission(null);
      });
      return;
    }

    void loadBootstrap(sessionId).then((bootstrap) => {
      if (!bootstrap || latestSessionIdRef.current !== sessionId) {
        return;
      }

      startTransition(() => {
        setReadyId(sessionId);
        setSession(bootstrap.session);
        setInitialMessages(bootstrap.initialMessages);
        setInitialMeta(bootstrap.initialMeta);
        setInitialPermission(bootstrap.initialPermission);
        setInitialConfigOptions(bootstrap.initialConfigOptions);
        setInitialSlashCommands(bootstrap.initialSlashCommands);
        setInitialRawAcpPermission(bootstrap.initialRawAcpPermission);
      });
    }).catch(() => {
      if (latestSessionIdRef.current !== sessionId) {
        return;
      }

      startTransition(() => {
        setReadyId(null);
        setSession(null);
        setInitialMessages([]);
        setInitialMeta(null);
        setInitialPermission(null);
        setInitialConfigOptions([]);
        setInitialSlashCommands([]);
        setInitialRawAcpPermission(null);
      });
    });
  }, [loadBootstrap, sessionId]);

  return {
    readyId,
    session,
    initialMessages,
    initialMeta,
    initialPermission,
    initialConfigOptions,
    initialSlashCommands,
    initialRawAcpPermission,
  };
}
