import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectManager } from "@/hooks/useProjectManager";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useSidebar } from "@/hooks/useSidebar";
import { useSpaceManager } from "@/hooks/useSpaceManager";
import { useSettings, normalizeRatios } from "@/hooks/useSettings";
import { AppSidebar } from "./AppSidebar";
import { ChatHeader } from "./ChatHeader";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { PermissionPrompt } from "./PermissionPrompt";
import { TodoPanel } from "./TodoPanel";
import { BackgroundAgentsPanel } from "./BackgroundAgentsPanel";
import { ToolPicker } from "./ToolPicker";
import type { ToolId } from "./ToolPicker";
import { WelcomeScreen } from "./WelcomeScreen";
import { SpaceCreator } from "./SpaceCreator";
import { ToolsPanel } from "./ToolsPanel";
import { BrowserPanel } from "./BrowserPanel";
import { GitPanel } from "./GitPanel";
import { FilesPanel } from "./FilesPanel";
import { McpPanel } from "./McpPanel";
import { ChangesPanel } from "./ChangesPanel";
import { SettingsView } from "./SettingsView";
import { useBackgroundAgents } from "@/hooks/useBackgroundAgents";
import { useAgentRegistry } from "@/hooks/useAgentRegistry";
import { resolveModelValue } from "@/lib/model-utils";
import { isMac } from "@/lib/utils";
import type { TodoItem, ImageAttachment, Space, SpaceColor, AgentDefinition, AcpPermissionBehavior } from "@/types";

export function AppLayout() {
  const sidebar = useSidebar();
  const projectManager = useProjectManager();
  const spaceManager = useSpaceManager();
  // Read ACP permission behavior early — it's a global setting (same localStorage key as useSettings)
  // so we can read it before useSettings which depends on manager.activeSession for per-project scoping
  const acpPermissionBehavior = (localStorage.getItem("openacpui-acp-permission-behavior") ?? "ask") as AcpPermissionBehavior;
  const manager = useSessionManager(projectManager.projects, acpPermissionBehavior);

  // Derive activeProjectId early so useSettings can scope per-project
  const activeProjectId = manager.activeSession?.projectId ?? manager.draftProjectId;
  const activeProjectPath = projectManager.projects.find((p) => p.id === activeProjectId)?.path;

  const settings = useSettings(activeProjectId ?? null);
  const { agents, saveAgent, deleteAgent } = useAgentRegistry();

  const [selectedAgent, setSelectedAgent] = useState<AgentDefinition | null>(null);
  const handleAgentChange = useCallback((agent: AgentDefinition | null) => {
    setSelectedAgent(agent);

    // If this agent would open a new chat, do it immediately on selection
    const currentEngine = manager.activeSession?.engine ?? "claude";
    const currentAgentId = manager.activeSession?.agentId;
    const wantedEngine = agent?.engine ?? "claude";
    const wantedAgentId = agent?.id;
    const needsNewSession = !manager.isDraft && manager.activeSession && (
      currentEngine !== wantedEngine ||
      (currentEngine === "acp" && wantedEngine === "acp" && currentAgentId !== wantedAgentId)
    );

    if (needsNewSession) {
      manager.createSession(manager.activeSession!.projectId, {
        model: settings.model,
        permissionMode: settings.permissionMode,
        engine: wantedEngine,
        agentId: agent?.id ?? "claude-code",
      });
    } else {
      manager.setDraftAgent(agent?.engine ?? "claude", agent?.id ?? "claude-code");
    }
  }, [manager.setDraftAgent, manager.isDraft, manager.activeSession, manager.createSession, settings.model, settings.permissionMode]);

  // Engine is locked once a session is active (not draft) — null means free to switch
  const lockedEngine = !manager.isDraft && manager.activeSession?.engine
    ? manager.activeSession.engine
    : null;

  // Agent ID is locked for ACP sessions — switching agents must open a new chat
  const lockedAgentId = !manager.isDraft && manager.activeSession?.agentId
    ? manager.activeSession.agentId
    : null;

  const [showSettings, setShowSettings] = useState(false);

  // When settings closes, fire resize so hidden tool panels (xterm) re-fit
  useEffect(() => {
    if (!showSettings) window.dispatchEvent(new Event("resize"));
  }, [showSettings]);

  const [spaceCreatorOpen, setSpaceCreatorOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | undefined>();
  const [glassOverlayStyle, setGlassOverlayStyle] = useState<React.CSSProperties | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  // Focus turn index for the Changes panel (set by inline turn summary "View changes" click)
  const [changesPanelFocusTurn, setChangesPanelFocusTurn] = useState<number | undefined>();

  const hasProjects = projectManager.projects.length > 0;

  // ── Tool toggle with suppression ──

  const handleToggleTool = useCallback(
    (toolId: ToolId) => {
      const isContextual = toolId === "tasks" || toolId === "agents";
      settings.setActiveTools((prev) => {
        const next = new Set(prev);
        if (next.has(toolId)) {
          next.delete(toolId);
          // User manually closed a contextual panel → suppress auto-open
          if (isContextual) settings.suppressPanel(toolId);
        } else {
          next.add(toolId);
          // User manually opened a contextual panel → clear suppression
          if (isContextual) settings.unsuppressPanel(toolId);
        }
        return next;
      });
    },
    [settings],
  );

  // Reorder panel tools in the ToolPicker (moves fromId to toId's position)
  const handleToolReorder = useCallback(
    (fromId: ToolId, toId: ToolId) => {
      const count = settings.toolOrder.filter(
        (id) => settings.activeTools.has(id) && ["terminal", "git", "browser", "files", "mcp", "changes"].includes(id),
      ).length;
      settings.setToolOrder((prev) => {
        const next = [...prev];
        const fromIdx = next.indexOf(fromId);
        const toIdx = next.indexOf(toId);
        if (fromIdx < 0 || toIdx < 0) return prev;
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, fromId);
        return next;
      });
      // Reset split ratios to equal when reordering (positional, not keyed)
      if (count > 1) {
        settings.setToolsSplitRatios(new Array<number>(count).fill(1 / count));
        settings.saveToolsSplitRatios();
      }
    },
    [settings],
  );

  const handleNewChat = useCallback(
    async (projectId: string) => {
      setShowSettings(false);
      const agent = selectedAgent;
      await manager.createSession(projectId, {
        model: settings.model,
        permissionMode: settings.permissionMode,
        engine: agent?.engine ?? "claude",
        agentId: agent?.id ?? "claude-code",
      });
    },
    [manager.createSession, settings.model, settings.permissionMode, selectedAgent],
  );

  const handleSend = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      // If the selected agent/engine differs from the current session, start a new session first
      const currentEngine = manager.activeSession?.engine ?? "claude";
      const wantedEngine = selectedAgent?.engine ?? "claude";
      const currentAgentId = manager.activeSession?.agentId;
      const wantedAgentId = selectedAgent?.id;
      const needsNewSession = !manager.isDraft && manager.activeSession && (
        currentEngine !== wantedEngine ||
        // Switching ACP agents within a session must also create a new chat
        (currentEngine === "acp" && wantedEngine === "acp" && currentAgentId !== wantedAgentId)
      );
      if (needsNewSession) {
        await manager.createSession(manager.activeSession!.projectId, {
          model: settings.model,
          permissionMode: settings.permissionMode,
          engine: wantedEngine,
          agentId: selectedAgent?.id ?? "claude-code",
        });
      }
      await manager.send(text, images, displayText);
    },
    [manager.send, manager.isDraft, manager.activeSession, manager.createSession, selectedAgent, settings.model, settings.permissionMode],
  );

  const handleModelChange = useCallback(
    (nextModel: string) => {
      settings.setModel(nextModel);
      manager.setActiveModel(nextModel);
    },
    [settings, manager.setActiveModel],
  );

  const handlePermissionModeChange = useCallback(
    (nextMode: string) => {
      settings.setPermissionMode(nextMode);
      manager.setActivePermissionMode(nextMode);
    },
    [settings, manager.setActivePermissionMode],
  );

  const handleStop = useCallback(async () => {
    await manager.interrupt();
  }, [manager.interrupt]);

  // Wrap session selection to also close settings view
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setShowSettings(false);
      manager.switchSession(sessionId);
    },
    [manager.switchSession],
  );

  // Wrap project creation to also close settings view, assigning to the active space
  const handleCreateProject = useCallback(async () => {
    setShowSettings(false);
    await projectManager.createProject(spaceManager.activeSpaceId);
  }, [projectManager.createProject, spaceManager.activeSpaceId]);

  const handleImportCCSession = useCallback(
    async (projectId: string, ccSessionId: string) => {
      await manager.importCCSession(projectId, ccSessionId);
    },
    [manager.importCCSession],
  );

  const handleNavigateToMessage = useCallback(
    (sessionId: string, messageId: string) => {
      manager.switchSession(sessionId);
      setTimeout(() => setScrollToMessageId(messageId), 200);
    },
    [manager.switchSession],
  );

  // Opens the Changes panel and focuses on a specific turn (from inline summary click)
  const handleViewTurnChanges = useCallback(
    (turnIndex: number) => {
      settings.setActiveTools((prev) => {
        if (prev.has("changes")) return prev;
        const next = new Set(prev);
        next.add("changes");
        return next;
      });
      setChangesPanelFocusTurn(turnIndex);
    },
    [settings],
  );

  const handleCreateSpace = useCallback(() => {
    setEditingSpace(null);
    setSpaceCreatorOpen(true);
  }, []);

  const handleEditSpace = useCallback((space: Space) => {
    setEditingSpace(space);
    setSpaceCreatorOpen(true);
  }, []);

  const handleDeleteSpace = useCallback(
    async (id: string) => {
      const deletedId = await spaceManager.deleteSpace(id);
      if (deletedId) {
        for (const p of projectManager.projects) {
          if (p.spaceId === deletedId) {
            await projectManager.updateProjectSpace(p.id, "default");
          }
        }
      }
    },
    [spaceManager.deleteSpace, projectManager.projects, projectManager.updateProjectSpace],
  );

  const handleSaveSpace = useCallback(
    async (name: string, icon: string, iconType: "emoji" | "lucide", color: SpaceColor) => {
      if (editingSpace) {
        await spaceManager.updateSpace(editingSpace.id, { name, icon, iconType, color });
      } else {
        await spaceManager.createSpace(name, icon, iconType, color);
      }
    },
    [editingSpace, spaceManager.updateSpace, spaceManager.createSpace],
  );

  const handleMoveProjectToSpace = useCallback(
    async (projectId: string, spaceId: string) => {
      await projectManager.updateProjectSpace(projectId, spaceId);
    },
    [projectManager.updateProjectSpace],
  );

  // ── Space ↔ session tracking: switch to last used chat when changing spaces ──

  const LAST_SESSION_KEY = "openacpui-last-session-per-space";
  const prevSpaceIdRef = useRef(spaceManager.activeSpaceId);

  // Helper: read the map from localStorage
  const readLastSessionMap = useCallback((): Record<string, string> => {
    try {
      const raw = localStorage.getItem(LAST_SESSION_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  // Save current session as last-used for current space whenever it changes
  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft) return;
    const map = readLastSessionMap();
    map[spaceManager.activeSpaceId] = manager.activeSessionId;
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(map));
  }, [manager.activeSessionId, manager.isDraft, spaceManager.activeSpaceId, readLastSessionMap]);

  // When activeSpaceId changes, switch to last used session in that space
  useEffect(() => {
    const prev = prevSpaceIdRef.current;
    const next = spaceManager.activeSpaceId;
    prevSpaceIdRef.current = next;
    if (prev === next) return;

    // Find projects in the new space
    const spaceProjectIds = new Set(
      projectManager.projects
        .filter((p) => (p.spaceId || "default") === next)
        .map((p) => p.id),
    );

    // Check if current session is already in the new space
    if (manager.activeSession && spaceProjectIds.has(manager.activeSession.projectId)) {
      return; // Already in the right space
    }

    // Try to restore the last used session in this space
    const map = readLastSessionMap();
    const lastSessionId = map[next];
    if (lastSessionId) {
      const session = manager.sessions.find(
        (s) => s.id === lastSessionId && spaceProjectIds.has(s.projectId),
      );
      if (session) {
        manager.switchSession(session.id);
        return;
      }
    }

    // Fall back to the most recent session in any project in this space
    const spaceSessions = manager.sessions
      .filter((s) => spaceProjectIds.has(s.projectId))
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));

    if (spaceSessions.length > 0) {
      manager.switchSession(spaceSessions[0].id);
    } else {
      // No sessions in this space — deselect
      manager.deselectSession();
    }
  }, [spaceManager.activeSpaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Space color tinting
  useEffect(() => {
    const space = spaceManager.activeSpace;
    const root = document.documentElement;
    const isGlass = root.classList.contains("glass-enabled");

    if (!space || space.color.chroma === 0) {
      root.style.removeProperty("--space-hue");
      root.style.removeProperty("--space-chroma");
      root.style.removeProperty("--island-overlay-bg");
      setGlassOverlayStyle(null);
      return;
    }

    const { hue, chroma } = space.color;
    root.style.setProperty("--space-hue", String(hue));
    root.style.setProperty("--space-chroma", String(chroma));

    const bgChroma = Math.min(chroma, 0.008);
    const accentChroma = Math.min(chroma, 0.015);
    const isDark = root.classList.contains("dark");

    if (isDark) {
      root.style.setProperty("--background", `oklch(0.185 ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(0.3 ${accentChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(0.34 ${bgChroma} ${hue})`);
      if (!isGlass) {
        root.style.setProperty("--sidebar", `oklch(0.175 ${bgChroma} ${hue})`);
        root.style.setProperty("--sidebar-accent", `oklch(0.28 ${accentChroma} ${hue})`);
      }
    } else {
      root.style.setProperty("--background", `oklch(1 ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(0.965 ${accentChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(0.922 ${bgChroma} ${hue})`);
      if (!isGlass) {
        root.style.setProperty("--sidebar", `oklch(0.985 ${bgChroma} ${hue})`);
        root.style.setProperty("--sidebar-accent", `oklch(0.965 ${accentChroma} ${hue})`);
      }
    }

    const gradientHue = space.color.gradientHue;
    const c = Math.min(chroma, 0.15);

    if (isGlass) {
      const a = isDark ? 0.08 : 0.05;
      const bg = gradientHue !== undefined
        ? `linear-gradient(135deg, oklch(0.5 ${c} ${hue} / ${a}), oklch(0.5 ${c} ${gradientHue} / ${a}))`
        : `oklch(0.5 ${c} ${hue} / ${a})`;
      setGlassOverlayStyle({ background: bg });
    } else {
      setGlassOverlayStyle(null);
    }

    if (gradientHue !== undefined) {
      const a = isDark ? 0.07 : 0.05;
      // Set CSS custom prop so .island::before picks up the gradient on ALL islands
      root.style.setProperty(
        "--island-overlay-bg",
        `linear-gradient(135deg, oklch(0.5 ${c} ${hue} / ${a}), oklch(0.5 ${c} ${gradientHue} / ${a}))`,
      );
    } else {
      root.style.removeProperty("--island-overlay-bg");
    }

    return () => {
      const vars = ["--space-hue", "--space-chroma", "--background", "--accent", "--border", "--sidebar", "--sidebar-accent", "--island-overlay-bg"];
      for (const v of vars) root.style.removeProperty(v);
      setGlassOverlayStyle(null);
    };
  }, [spaceManager.activeSpace]);

  // Sync model from loaded session (canonical runtime names -> picker values)
  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft || manager.supportedModels.length === 0) return;
    const session = manager.sessions.find((s) => s.id === manager.activeSessionId);
    if (!session?.model) return;

    const syncedModel = resolveModelValue(session.model, manager.supportedModels) ?? session.model;
    if (syncedModel !== settings.model) {
      settings.setModel(syncedModel);
    }
  }, [manager.activeSessionId, manager.isDraft, manager.sessions, manager.supportedModels, settings.model, settings.setModel]);

  // Sync selectedAgent when switching to a different session
  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft) return;
    const session = manager.sessions.find((s) => s.id === manager.activeSessionId);
    if (!session) return;

    if (session.engine === "acp" && session.agentId) {
      const agent = agents.find((a) => a.id === session.agentId);
      if (agent && selectedAgent?.id !== agent.id) {
        setSelectedAgent(agent);
      }
    } else if (session.engine !== "acp" && selectedAgent !== null) {
      setSelectedAgent(null);
    }
  }, [manager.activeSessionId, manager.isDraft, manager.sessions, agents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive the latest todo list from the most recent TodoWrite tool call
  const activeTodos = useMemo(() => {
    for (let i = manager.messages.length - 1; i >= 0; i--) {
      const msg = manager.messages[i];
      if (
        msg.role === "tool_call" &&
        msg.toolName === "TodoWrite" &&
        msg.toolInput?.todos
      ) {
        return msg.toolInput.todos as TodoItem[];
      }
    }
    return [];
  }, [manager.messages]);

  const bgAgents = useBackgroundAgents({
    messages: manager.messages,
    sessionId: manager.activeSessionId,
  });

  // ── Contextual tools (tasks / agents) — auto-activate when data appears ──

  const hasTodos = activeTodos.length > 0;
  const hasAgents = bgAgents.agents.length > 0;

  const availableContextual = useMemo(() => {
    const s = new Set<ToolId>();
    if (hasTodos) s.add("tasks");
    if (hasAgents) s.add("agents");
    return s;
  }, [hasTodos, hasAgents]);

  // Auto-add contextual tools when data appears (unless suppressed)
  useEffect(() => {
    if (!hasTodos) {
      // Data gone → clear suppression so next session starts fresh
      settings.unsuppressPanel("tasks");
      return;
    }
    if (settings.suppressedPanels.has("tasks")) return;
    settings.setActiveTools((prev) => {
      if (prev.has("tasks")) return prev;
      const next = new Set(prev);
      next.add("tasks");
      return next;
    });
  }, [hasTodos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hasAgents) {
      settings.unsuppressPanel("agents");
      return;
    }
    if (settings.suppressedPanels.has("agents")) return;
    settings.setActiveTools((prev) => {
      if (prev.has("agents")) return prev;
      const next = new Set(prev);
      next.add("agents");
      return next;
    });
  }, [hasAgents]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Layout constraints ──
  // Minimum chat width — must fit the full InputBar toolbar including agent dropdown +
  // longest model name + "Ask Before Edits" permission + reasoning + context + send.
  // Breakdown: 56px outer padding (px-4+px-3) + ~550px toolbar content = ~606px, rounded up.
  const MIN_CHAT_WIDTH = 640;
  // ToolPicker strip (w-14 = 56px) + its left margin (ms-2 = 8px)
  const TOOL_PICKER_WIDTH = 64;
  const RESIZE_HANDLE_WIDTH = 8;
  // Panel min/max (declared here so dynamic minWidth and resize handlers can share them)
  const MIN_PANEL_WIDTH = 200;
  const MAX_PANEL_WIDTH = 500;
  const MIN_TOOLS_WIDTH = 280;
  const MAX_TOOLS_WIDTH = 800;

  const contentRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  // ── Panel visibility flags (used by dynamic minWidth + clamping) ──
  const hasRightPanel = ((hasTodos && settings.activeTools.has("tasks")) || (hasAgents && settings.activeTools.has("agents"))) && !!manager.activeSessionId;
  const hasToolsColumn = (settings.activeTools.has("terminal") || settings.activeTools.has("browser") || settings.activeTools.has("git") || settings.activeTools.has("files") || settings.activeTools.has("mcp") || settings.activeTools.has("changes")) && !!manager.activeSessionId;

  // ── Dynamic Electron minimum window width ──
  // Recalculates whenever panel visibility or sidebar state changes
  useEffect(() => {
    const sidebarW = sidebar.isOpen ? 260 : 0;
    const margins = 16; // ms-2 + me-2 on contentRef
    let minW = sidebarW + margins + MIN_CHAT_WIDTH;

    if (manager.activeSessionId) {
      minW += TOOL_PICKER_WIDTH;
      if (hasRightPanel) minW += MIN_PANEL_WIDTH + RESIZE_HANDLE_WIDTH;
      if (hasToolsColumn) minW += MIN_TOOLS_WIDTH + RESIZE_HANDLE_WIDTH;
    }

    window.claude.setMinWidth(Math.max(minW, 600));
  }, [sidebar.isOpen, hasRightPanel, hasToolsColumn, manager.activeSessionId]);

  // When tools column becomes visible, fire resize so xterm terminals re-fit
  useEffect(() => {
    if (hasToolsColumn) window.dispatchEvent(new Event("resize"));
  }, [hasToolsColumn]);

  // ── Right panel resize ──

  const rightPanelWidthRef = useRef(settings.rightPanelWidth);
  rightPanelWidthRef.current = settings.rightPanelWidth;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = rightPanelWidthRef.current;
      // Capture tools panel visibility at drag start
      const toolsVisible = !!toolsColumnRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        // Dynamically cap so the chat always keeps MIN_CHAT_WIDTH
        const containerWidth = contentRef.current?.clientWidth ?? window.innerWidth;
        let reserved = MIN_CHAT_WIDTH + TOOL_PICKER_WIDTH + RESIZE_HANDLE_WIDTH;
        if (toolsVisible) {
          reserved += toolsPanelWidthRef.current + RESIZE_HANDLE_WIDTH;
        }
        const dynamicMax = Math.max(MIN_PANEL_WIDTH, containerWidth - reserved);

        const delta = startX - ev.clientX;
        const next = Math.max(MIN_PANEL_WIDTH, Math.min(Math.min(MAX_PANEL_WIDTH, dynamicMax), startWidth + delta));
        settings.setRightPanelWidth(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveRightPanelWidth();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings],
  );

  // ── Tools panel resize ──

  const toolsPanelWidthRef = useRef(settings.toolsPanelWidth);
  toolsPanelWidthRef.current = settings.toolsPanelWidth;

  const handleToolsResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = toolsPanelWidthRef.current;
      // Capture right panel visibility at drag start
      const rightVisible = !!rightPanelRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        // Dynamically cap so the chat always keeps MIN_CHAT_WIDTH
        const containerWidth = contentRef.current?.clientWidth ?? window.innerWidth;
        let reserved = MIN_CHAT_WIDTH + TOOL_PICKER_WIDTH + RESIZE_HANDLE_WIDTH;
        if (rightVisible) {
          reserved += rightPanelWidthRef.current + RESIZE_HANDLE_WIDTH;
        }
        const dynamicMax = Math.max(MIN_TOOLS_WIDTH, containerWidth - reserved);

        const delta = startX - ev.clientX;
        const next = Math.max(MIN_TOOLS_WIDTH, Math.min(Math.min(MAX_TOOLS_WIDTH, dynamicMax), startWidth + delta));
        settings.setToolsPanelWidth(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveToolsPanelWidth();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings],
  );

  // ── Reactive panel clamping on window resize / project switch ──
  // When the container shrinks (window resize or panel toggle), clamp stored panel widths
  // so the chat island never goes below MIN_CHAT_WIDTH. Tools panel yields first, then right panel.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const clamp = () => {
      const containerW = el.clientWidth;
      const hasRight = !!rightPanelRef.current;
      const hasTools = !!toolsColumnRef.current;

      let reserved = MIN_CHAT_WIDTH + (manager.activeSessionId ? TOOL_PICKER_WIDTH : 0);
      if (hasRight) reserved += RESIZE_HANDLE_WIDTH;
      if (hasTools) reserved += RESIZE_HANDLE_WIDTH;

      const available = containerW - reserved;
      let rw = hasRight ? rightPanelWidthRef.current : 0;
      let tw = hasTools ? toolsPanelWidthRef.current : 0;

      if (rw + tw > available) {
        // Shrink tools panel first, then right panel
        const excess = rw + tw - available;
        const twReduction = Math.min(excess, Math.max(0, tw - MIN_TOOLS_WIDTH));
        tw = Math.max(MIN_TOOLS_WIDTH, tw - twReduction);
        const remaining = rw + tw - available;
        if (remaining > 0) rw = Math.max(MIN_PANEL_WIDTH, rw - remaining);

        // Only update state if actually changed (>1px guard against loops)
        if (hasRight && Math.abs(rw - rightPanelWidthRef.current) > 1) settings.setRightPanelWidth(rw);
        if (hasTools && Math.abs(tw - toolsPanelWidthRef.current) > 1) settings.setToolsPanelWidth(tw);
      }
    };

    const observer = new ResizeObserver(clamp);
    observer.observe(el);
    // Also clamp immediately on mount / project switch
    clamp();
    return () => observer.disconnect();
  }, [hasRightPanel, hasToolsColumn, manager.activeSessionId, activeProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tools vertical split ratios ──

  const toolsColumnRef = useRef<HTMLDivElement>(null);
  // Track the current NORMALIZED ratios so the drag handler always has correct values
  // (raw settings.toolsSplitRatios can be empty or wrong length when tools are toggled)
  const normalizedToolRatiosRef = useRef<number[]>([]);

  // Count of active panel tools (used to sync stored ratios when tools are toggled)
  const activeToolCount = useMemo(
    () => settings.toolOrder.filter((id) => settings.activeTools.has(id) && ["terminal", "git", "browser", "files", "mcp", "changes"].includes(id)).length,
    [settings.toolOrder, settings.activeTools],
  );

  // Sync stored ratios to the actual tool count whenever tools are toggled on/off.
  // Without this, the drag handler would start from stale ratios of a different length.
  useEffect(() => {
    if (activeToolCount <= 0) return;
    if (settings.toolsSplitRatios.length !== activeToolCount) {
      const synced = normalizeRatios(settings.toolsSplitRatios, activeToolCount);
      settings.setToolsSplitRatios(synced);
    }
  }, [activeToolCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToolsSplitStart = useCallback(
    (e: React.MouseEvent, dividerIndex: number) => {
      e.preventDefault();
      setIsResizing(true);
      const startY = e.clientY;
      const columnEl = toolsColumnRef.current;
      if (!columnEl) return;
      const columnHeight = columnEl.getBoundingClientRect().height;
      // Use the normalized ratios (always match current tool count, never NaN/empty)
      const startRatios = [...normalizedToolRatiosRef.current];
      if (dividerIndex + 1 >= startRatios.length) return; // safety guard
      const minRatio = 0.1;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = (ev.clientY - startY) / columnHeight;
        const next = [...startRatios];
        let upper = startRatios[dividerIndex] + delta;
        let lower = startRatios[dividerIndex + 1] - delta;
        // Clamp both sides
        if (upper < minRatio) { lower += upper - minRatio; upper = minRatio; }
        if (lower < minRatio) { upper += lower - minRatio; lower = minRatio; }
        next[dividerIndex] = upper;
        next[dividerIndex + 1] = lower;
        settings.setToolsSplitRatios(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveToolsSplitRatios();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings],
  );

  // ── Right panel vertical split (Tasks / Agents) ──

  const handleRightSplitStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startY = e.clientY;
      const startRatio = settings.rightSplitRatio;
      const panelEl = rightPanelRef.current;
      if (!panelEl) return;
      const panelHeight = panelEl.getBoundingClientRect().height;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        const next = Math.max(0.2, Math.min(0.8, startRatio + delta / panelHeight));
        settings.setRightSplitRatio(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        settings.saveRightSplitRatio();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [settings],
  );

  // Sync InputBar toggle when sessionInfo.permissionMode changes (e.g. ExitPlanMode)
  useEffect(() => {
    const mode = manager.sessionInfo?.permissionMode;
    if (mode && mode !== settings.permissionMode) {
      settings.setPermissionMode(mode);
    }
  }, [manager.sessionInfo?.permissionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const { activeTools } = settings;

  return (
    <div className="relative flex h-screen overflow-hidden bg-sidebar text-foreground">
      {/* Glass tint overlay — sits behind content, tints the native transparency */}
      {glassOverlayStyle && (
        <div
          className="pointer-events-none fixed inset-0 z-0 transition-[background] duration-300"
          style={glassOverlayStyle}
        />
      )}
      <SpaceCreator
        open={spaceCreatorOpen}
        onOpenChange={setSpaceCreatorOpen}
        editingSpace={editingSpace}
        onSave={handleSaveSpace}
      />
      <AppSidebar
        isOpen={sidebar.isOpen}
        projects={projectManager.projects}
        sessions={manager.sessions}
        activeSessionId={manager.activeSessionId}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
        onDeleteSession={manager.deleteSession}
        onRenameSession={manager.renameSession}
        onCreateProject={handleCreateProject}
        onDeleteProject={projectManager.deleteProject}
        onRenameProject={projectManager.renameProject}
        onImportCCSession={handleImportCCSession}
        onToggleSidebar={sidebar.toggle}
        onNavigateToMessage={handleNavigateToMessage}
        onMoveProjectToSpace={handleMoveProjectToSpace}
        onReorderProject={projectManager.reorderProject}
        spaces={spaceManager.spaces}
        activeSpaceId={spaceManager.activeSpaceId}
        onSelectSpace={spaceManager.setActiveSpaceId}
        onCreateSpace={handleCreateSpace}
        onEditSpace={handleEditSpace}
        onDeleteSpace={handleDeleteSpace}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div ref={contentRef} className={`flex min-w-0 flex-1 ms-2 me-2 my-2 ${isResizing ? "select-none" : ""}`}>
        {showSettings && (
          <SettingsView
            onClose={() => setShowSettings(false)}
            agents={agents}
            onSaveAgent={saveAgent}
            onDeleteAgent={deleteAgent}
          />
        )}
        {/* Keep chat area mounted (hidden) when settings is open to avoid
            destroying/recreating the entire ChatView DOM tree on toggle */}
        <div className={showSettings ? "hidden" : "contents"}>
        <div className="island relative flex min-w-[640px] flex-1 flex-col overflow-hidden rounded-lg bg-background">
          {manager.activeSessionId ? (
            <>
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-24 bg-gradient-to-b from-black to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
                <ChatHeader
                  sidebarOpen={sidebar.isOpen}
                  isProcessing={manager.isProcessing}
                  model={manager.sessionInfo?.model}
                  sessionId={manager.sessionInfo?.sessionId}
                  totalCost={manager.totalCost}
                  title={manager.activeSession?.title}
                  permissionMode={manager.sessionInfo?.permissionMode}
                  acpPermissionBehavior={manager.activeSession?.engine === "acp" ? settings.acpPermissionBehavior : undefined}
                  onToggleSidebar={sidebar.toggle}
                />
              </div>
              <ChatView
                messages={manager.messages}
                isProcessing={manager.isProcessing}
                extraBottomPadding={!!manager.pendingPermission}
                scrollToMessageId={scrollToMessageId}
                onScrolledToMessage={() => setScrollToMessageId(undefined)}
                sessionId={manager.activeSessionId}
                onRevert={manager.isConnected && manager.revertFiles ? manager.revertFiles : undefined}
                onFullRevert={manager.isConnected && manager.fullRevert ? manager.fullRevert : undefined}
                onViewTurnChanges={handleViewTurnChanges}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-24 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
                {manager.pendingPermission ? (
                  <PermissionPrompt
                    request={manager.pendingPermission}
                    onRespond={manager.respondPermission}
                  />
                ) : (
                  <InputBar
                    onSend={handleSend}
                    onStop={handleStop}
                    isProcessing={manager.isProcessing}
                    queuedCount={manager.queuedCount}
                    model={settings.model}
                    thinking={settings.thinking}
                    permissionMode={settings.permissionMode}
                    onModelChange={handleModelChange}
                    onThinkingChange={settings.setThinking}
                    onPermissionModeChange={handlePermissionModeChange}
                    projectPath={activeProjectPath}
                    contextUsage={manager.contextUsage}
                    isCompacting={manager.isCompacting}
                    onCompact={manager.compact}
                    agents={agents}
                    selectedAgent={selectedAgent}
                    onAgentChange={handleAgentChange}
                    acpConfigOptions={manager.acpConfigOptions}
                    onACPConfigChange={manager.setACPConfig}
                    acpPermissionBehavior={settings.acpPermissionBehavior}
                    onAcpPermissionBehaviorChange={settings.setAcpPermissionBehavior}
                    supportedModels={manager.supportedModels}
                    lockedEngine={lockedEngine}
                    lockedAgentId={lockedAgentId}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <div
                className={`drag-region flex h-12 items-center px-3 ${
                  !sidebar.isOpen && isMac ? "ps-[78px]" : ""
                }`}
              >
                {!sidebar.isOpen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="no-drag h-7 w-7 text-muted-foreground/60 hover:text-foreground"
                    onClick={sidebar.toggle}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <WelcomeScreen
                hasProjects={hasProjects}
                onCreateProject={handleCreateProject}
              />
            </>
          )}
        </div>

        {hasRightPanel && (
          <>
            {/* Resize handle */}
            <div
              className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
              onMouseDown={handleResizeStart}
            >
              <div
                className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${
                  isResizing
                    ? "bg-foreground/40"
                    : "bg-transparent group-hover:bg-foreground/25"
                }`}
              />
            </div>

            {/* Right panel — Tasks / Agents with optional draggable vertical split */}
            <div
              ref={rightPanelRef}
              className="flex shrink-0 flex-col overflow-hidden"
              style={{ width: settings.rightPanelWidth }}
            >
              {(() => {
                const showTodos = hasTodos && activeTools.has("tasks");
                const showAgents = hasAgents && activeTools.has("agents");
                const bothVisible = showTodos && showAgents;

                return (
                  <>
                    {showTodos && (
                      <div
                        className="island flex flex-col overflow-hidden rounded-lg bg-background"
                        style={
                          bothVisible
                            ? { height: `calc(${settings.rightSplitRatio * 100}% - 4px)`, flexShrink: 0 }
                            : { flex: "1 1 0%", minHeight: 0 }
                        }
                      >
                        <TodoPanel todos={activeTodos} />
                      </div>
                    )}
                    {bothVisible && (
                      <div
                        className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                        onMouseDown={handleRightSplitStart}
                      >
                        <div
                          className={`w-10 h-0.5 rounded-full transition-colors duration-150 ${
                            isResizing
                              ? "bg-foreground/40"
                              : "bg-transparent group-hover:bg-foreground/25"
                          }`}
                        />
                      </div>
                    )}
                    {showAgents && (
                      <div
                        className="island flex flex-col overflow-hidden rounded-lg bg-background"
                        style={
                          bothVisible
                            ? { height: `calc(${(1 - settings.rightSplitRatio) * 100}% - 4px)`, flexShrink: 0 }
                            : { flex: "1 1 0%", minHeight: 0 }
                        }
                      >
                        <BackgroundAgentsPanel agents={bgAgents.agents} onDismiss={bgAgents.dismissAgent} />
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </>
        )}

        {/* Tools panels — always mounted when session active to preserve terminal/browser state.
            Column is hidden (display: none) when no panel tools are active, keeping processes alive. */}
        {manager.activeSessionId && (
          <>
            {/* Resize handle — only visible when tools column is showing */}
            {hasToolsColumn && (
              <div
                className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
                onMouseDown={handleToolsResizeStart}
              >
                <div
                  className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${
                    isResizing
                      ? "bg-foreground/40"
                      : "bg-transparent group-hover:bg-foreground/25"
                  }`}
                />
              </div>
            )}

            <div
              ref={hasToolsColumn ? toolsColumnRef : null}
              className={`flex shrink-0 flex-col gap-0 overflow-hidden ${!hasToolsColumn ? "hidden" : ""}`}
              style={{ width: settings.toolsPanelWidth }}
            >
              {(() => {
                const toolComponents: Record<string, React.ReactNode> = {
                  terminal: <ToolsPanel cwd={activeProjectPath} />,
                  git: (
                    <GitPanel
                      cwd={activeProjectPath}
                      collapsedRepos={settings.collapsedRepos}
                      onToggleRepoCollapsed={settings.toggleRepoCollapsed}
                    />
                  ),
                  browser: <BrowserPanel />,
                  files: (
                    <FilesPanel
                      messages={manager.messages}
                      cwd={activeProjectPath}
                      onScrollToToolCall={setScrollToMessageId}
                    />
                  ),
                  mcp: (
                    <McpPanel
                      projectId={activeProjectId ?? null}
                      runtimeStatuses={manager.mcpServerStatuses}
                      isPreliminary={manager.mcpStatusPreliminary}
                      hasLiveSession={!manager.isDraft}
                      onRefreshStatus={manager.refreshMcpStatus}
                      onReconnect={manager.reconnectMcpServer}
                      onRestartWithServers={manager.restartWithMcpServers}
                    />
                  ),
                  changes: (
                    <ChangesPanel
                      messages={manager.messages}
                      isProcessing={manager.isProcessing}
                      focusTurnIndex={changesPanelFocusTurn}
                      onFocusTurnHandled={() => setChangesPanelFocusTurn(undefined)}
                    />
                  ),
                };

                // All panel tool IDs in display order
                const allToolIds = settings.toolOrder.filter((id) => id in toolComponents);
                // Active subset for flex layout sizing
                const activeToolIds = allToolIds.filter((id) => activeTools.has(id));
                const count = activeToolIds.length;
                const ratios = normalizeRatios(settings.toolsSplitRatios, count);
                normalizedToolRatiosRef.current = ratios;

                // Render ALL tools: active ones get flex layout, inactive ones stay
                // hidden (display: none) but mounted — preserves terminal processes,
                // browser sessions, and all internal state across toggles.
                return allToolIds.map((id) => {
                  const isActive = activeTools.has(id);
                  const activeIdx = isActive ? activeToolIds.indexOf(id) : -1;

                  return (
                    <div key={id} className={isActive ? "contents" : "hidden"}>
                      <div
                        className="island flex flex-col overflow-hidden rounded-lg bg-background"
                        style={isActive ? { flex: `${ratios[activeIdx]} 1 0%`, minHeight: 0 } : undefined}
                      >
                        {toolComponents[id]}
                      </div>
                      {isActive && activeIdx < count - 1 && (
                        <div
                          className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                          onMouseDown={(e) => handleToolsSplitStart(e, activeIdx)}
                        >
                          <div
                            className={`w-10 h-0.5 rounded-full transition-colors duration-150 ${
                              isResizing
                                ? "bg-foreground/40"
                                : "bg-transparent group-hover:bg-foreground/25"
                            }`}
                          />
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </>
        )}

        {/* Tool picker — always visible */}
        {manager.activeSessionId && (
          <div className="ms-2 shrink-0">
            <ToolPicker activeTools={activeTools} onToggle={handleToggleTool} availableContextual={availableContextual} toolOrder={settings.toolOrder} onReorder={handleToolReorder} projectPath={activeProjectPath} />
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
