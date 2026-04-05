/**
 * Per-pane controller hook.
 *
 * Encapsulates the model/permission/send/stop logic for a single pane.
 * Used identically by single-chat mode (for the active session) and
 * split-view mode (for each split pane). Extracted from the monolithic
 * `buildPaneController` callback that lived in AppLayout.
 */

import { useMemo } from "react";
import { toast } from "sonner";
import type { ACPConfigOption, ChatSession, ClaudeEffort, EngineId, ImageAttachment, InstalledAgent, ModelInfo } from "@/types";
import type { SessionPaneState } from "@/hooks/session/useSessionPane";
import type { CodexModelSummary } from "@/hooks/session/types";
import { buildCodexCollabMode, DEFAULT_PERMISSION_MODE } from "@/hooks/session/types";
import { findEquivalentModel } from "@/lib/model-utils";
import type { PaneController } from "@/types";

// ── Model catalog builders (moved from AppLayout) ──

function buildPaneModelFallback(model: string | undefined): ModelInfo[] {
  if (!model?.trim()) return [];
  return [{ value: model, displayName: model, description: "" }];
}

function buildCodexModelCatalog(rawModels: CodexModelSummary[]): ModelInfo[] {
  return rawModels.map((model) => ({
    value: model.id,
    displayName: model.displayName,
    description: model.description,
    supportsEffort: model.supportedReasoningEfforts.length > 0,
    supportedEffortLevels: model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort as ClaudeEffort),
  }));
}

function ensureCurrentClaudeModel(
  models: ModelInfo[],
  currentModel: string | undefined,
): ModelInfo[] {
  const normalizedModel = currentModel?.trim();
  if (!normalizedModel) return models;
  if (findEquivalentModel(normalizedModel, models)) return models;
  return [
    ...models,
    { value: normalizedModel, displayName: normalizedModel, description: "" },
  ];
}

// ── Context bundle — values from the orchestrator that the pane controller needs ──

export interface PaneControllerContext {
  agents: InstalledAgent[];
  selectedAgent: InstalledAgent | null;
  settings: {
    getModelForEngine: (engine: EngineId) => string;
    permissionMode: string;
    planMode: boolean;
    claudeEffort: ClaudeEffort;
    acpPermissionBehavior: "ask" | "auto_accept" | "allow_all";
  };
  // Manager methods for active-pane path
  handleModelChange: (nextModel: string) => void;
  handleClaudeModelEffortChange: (nextModel: string, effort: ClaudeEffort) => void;
  handlePlanModeChange: (enabled: boolean) => void;
  handlePermissionModeChange: (nextMode: string) => void;
  handleAgentChange: (agent: InstalledAgent | null) => void;
  handleStop: () => Promise<void>;
  handleComposerClear: () => Promise<void>;
  wrappedHandleSend: (text: string, images?: ImageAttachment[], displayText?: string) => Promise<void>;
  // Manager session-level mutations (for non-active panes)
  manager: {
    setSessionModel: (sessionId: string, model: string) => void;
    setSessionClaudeModelAndEffort: (sessionId: string, model: string, effort: ClaudeEffort) => void;
    setSessionPlanMode: (sessionId: string, enabled: boolean) => void;
    setSessionPermissionMode: (sessionId: string, mode: string) => void;
    setCodexEffort: (effort: string) => void;
    codexEffort: string;
    codexRawModels: CodexModelSummary[];
    codexModelsLoadingMessage: string | null;
    cachedClaudeModels: ModelInfo[];
    acpConfigOptions: ACPConfigOption[];
    acpConfigOptionsLoading: boolean;
    setACPConfig: (key: string, value: string) => void;
  };
  // Split-view helpers (optional — absent in single-chat mode)
  splitView?: {
    setFocusedSession: (sessionId: string | null) => void;
  };
  createSplitPaneDraftSession?: (replacedSessionId: string, projectId: string, agent: InstalledAgent | null) => Promise<void>;
  queueSplitPaneSendAfterSwitch?: (sessionId: string, text: string, images?: ImageAttachment[], displayText?: string) => Promise<void>;
}

export function usePaneController(
  sessionId: string,
  session: ChatSession | null,
  paneState: SessionPaneState,
  isActiveSessionPane: boolean,
  ctx: PaneControllerContext,
): PaneController {
  return useMemo(() => {
    const paneEngine: EngineId = session?.engine
      ?? (isActiveSessionPane ? (ctx.selectedAgent?.engine ?? "claude") : "claude");
    const selectedPaneAgent = isActiveSessionPane
      ? ctx.selectedAgent
      : session?.agentId
        ? ctx.agents.find((agent) => agent.id === session.agentId) ?? null
        : session?.engine === "codex"
          ? ctx.agents.find((agent) => agent.engine === "codex") ?? null
          : null;
    const liveModel = paneState.sessionInfo?.model?.trim();
    const persistedModel = session?.model?.trim();
    const defaultModel = isActiveSessionPane
      ? ctx.settings.getModelForEngine(paneEngine).trim()
      : "";
    const paneModel = liveModel || persistedModel || defaultModel;
    const panePermissionMode =
      paneState.sessionInfo?.permissionMode
      ?? session?.permissionMode
      ?? (isActiveSessionPane ? ctx.settings.permissionMode : DEFAULT_PERMISSION_MODE);
    const panePlanMode = panePermissionMode === "plan"
      || !!session?.planMode
      || (isActiveSessionPane && !session ? ctx.settings.planMode : false);
    const paneSupportedModels = paneEngine === "acp"
      ? []
      : paneEngine === "codex"
        ? (paneState.codex.codexModels.length > 0
          ? paneState.codex.codexModels
          : ctx.manager.codexRawModels.length > 0
            ? buildCodexModelCatalog(ctx.manager.codexRawModels)
            : buildPaneModelFallback(paneModel))
        : ensureCurrentClaudeModel(
          paneState.claude.supportedModels.length > 0
            ? paneState.claude.supportedModels
            : ctx.manager.cachedClaudeModels.length > 0
              ? ctx.manager.cachedClaudeModels
              : buildPaneModelFallback(paneModel),
          paneModel,
        );
    const paneAcpConfigOptions = paneEngine === "acp"
      ? (isActiveSessionPane ? ctx.manager.acpConfigOptions : paneState.acp.configOptions)
      : [];
    const paneAcpConfigOptionsLoading = paneEngine === "acp"
      ? (isActiveSessionPane ? ctx.manager.acpConfigOptionsLoading : paneState.acp.configOptionsLoading)
      : false;
    const paneCodexModelsLoadingMessage = paneEngine === "codex" && paneSupportedModels.length === 0
      ? ctx.manager.codexModelsLoadingMessage
      : null;

    const handlePaneModelChange = (nextModel: string) => {
      if (isActiveSessionPane) {
        ctx.handleModelChange(nextModel);
        return;
      }
      ctx.manager.setSessionModel(sessionId, nextModel);
    };

    const handlePaneClaudeModelEffortChange = (nextModel: string, effort: ClaudeEffort | undefined) => {
      const resolvedEffort = effort ?? ctx.settings.claudeEffort;
      if (isActiveSessionPane) {
        ctx.handleClaudeModelEffortChange(nextModel, resolvedEffort);
        return;
      }
      ctx.manager.setSessionClaudeModelAndEffort(sessionId, nextModel, resolvedEffort);
    };

    const handlePanePlanModeChange = (enabled: boolean) => {
      if (isActiveSessionPane) {
        ctx.handlePlanModeChange(enabled);
        return;
      }
      ctx.manager.setSessionPlanMode(sessionId, enabled);
    };

    const handlePanePermissionModeChange = (nextMode: string) => {
      if (isActiveSessionPane) {
        ctx.handlePermissionModeChange(nextMode);
        return;
      }
      ctx.manager.setSessionPermissionMode(sessionId, nextMode);
    };

    const handlePaneCodexEffortChange = (effort: string) => {
      if (isActiveSessionPane) {
        ctx.manager.setCodexEffort(effort);
        return;
      }
      paneState.codex.setCodexEffort(effort);
    };

    const handlePaneAgentChange = async (agent: InstalledAgent | null) => {
      if (isActiveSessionPane) {
        ctx.handleAgentChange(agent);
        return;
      }

      if (!session) return;

      const currentEngine = session.engine ?? "claude";
      const currentAgentId = session.agentId;
      const wantedEngine = agent?.engine ?? "claude";
      const wantedAgentId = agent?.id;
      const needsNewSession =
        currentEngine !== wantedEngine
        || (currentEngine === "acp" && wantedEngine === "acp" && currentAgentId !== wantedAgentId);

      if (!needsNewSession) {
        ctx.splitView?.setFocusedSession(sessionId);
        return;
      }

      await ctx.createSplitPaneDraftSession?.(sessionId, session.projectId, agent);
    };

    const handlePaneClear = async () => {
      if (!session) return;
      if (isActiveSessionPane) {
        await ctx.handleComposerClear();
        return;
      }
      await ctx.createSplitPaneDraftSession?.(sessionId, session.projectId, selectedPaneAgent);
    };

    const handlePaneSend = async (text: string, images?: ImageAttachment[], displayText?: string) => {
      ctx.splitView?.setFocusedSession(sessionId);

      if (isActiveSessionPane) {
        await ctx.wrappedHandleSend(text, images, displayText);
        return;
      }

      if (!session) return;

      if (!paneState.isConnected) {
        await ctx.queueSplitPaneSendAfterSwitch?.(sessionId, text, images, displayText);
        return;
      }

      if (paneEngine === "acp") {
        await paneState.acp.send(text, images, displayText);
        return;
      }

      if (paneEngine === "codex") {
        try {
          const collaborationMode = buildCodexCollabMode(panePlanMode, paneModel);
          const sent = await paneState.codex.send(text, images, displayText, collaborationMode);
          if (!sent) {
            await ctx.queueSplitPaneSendAfterSwitch?.(sessionId, text, images, displayText);
          }
        } catch (err) {
          toast.error("Failed to send message", {
            description: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      const sent = await paneState.claude.send(text, images, displayText);
      if (!sent) {
        await ctx.queueSplitPaneSendAfterSwitch?.(sessionId, text, images, displayText);
      }
    };

    const handlePaneStop = async () => {
      ctx.splitView?.setFocusedSession(sessionId);
      if (isActiveSessionPane) {
        await ctx.handleStop();
        return;
      }
      await paneState.engine.interrupt();
    };

    return {
      paneEngine,
      selectedPaneAgent,
      paneModel,
      paneHeaderModel: liveModel || paneModel,
      panePermissionMode,
      panePlanMode,
      paneSupportedModels,
      paneClaudeEffort: session?.effort ?? ctx.settings.claudeEffort,
      paneSlashCommands: paneState.engine.slashCommands,
      paneAcpConfigOptions,
      paneAcpConfigOptionsLoading,
      paneCodexModelsLoadingMessage,
      paneCodexEffort: isActiveSessionPane ? ctx.manager.codexEffort : paneState.codex.codexEffort,
      handlePaneModelChange,
      handlePaneClaudeModelEffortChange,
      handlePanePlanModeChange,
      handlePanePermissionModeChange,
      handlePaneCodexEffortChange,
      handlePaneAgentChange,
      handlePaneClear,
      handlePaneSend,
      handlePaneStop,
      handlePaneAcpConfigChange: isActiveSessionPane ? ctx.manager.setACPConfig : paneState.acp.setConfig,
    };
  }, [
    ctx,
    isActiveSessionPane,
    paneState,
    session,
    sessionId,
  ]);
}
