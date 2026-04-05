/**
 * Renders a single tool island in the split-view bottom dock.
 *
 * Extracted from the 113-line `renderSplitBottomToolIsland` useCallback in AppLayout.
 * Shares the same ToolIslandContent renderer as the top-row tool columns.
 */

import React from "react";
import { ArrowUp } from "lucide-react";
import { motion } from "motion/react";
import { getHorizontalInsertSide } from "@/lib/workspace/drag";
import { getStoredProjectGitCwd } from "@/lib/session/space-projects";
import { PanelDockControls } from "@/components/PanelDockControls";
import { ToolIslandContent } from "@/components/workspace/ToolIslandContent";
import { SplitPaneHost } from "@/components/split/SplitPaneHost";
import type { ToolId } from "@/types/tools";
import type { ChatSession, Project } from "@/types";
import type { SessionPaneState } from "@/hooks/session/useSessionPane";
import type { SessionPaneBootstrap } from "@/hooks/session/types";
import type { SplitViewState } from "@/hooks/useSplitView";
import type { ToolDragState, ToolIsland, ToolIslandContextProps } from "@/types";

// ── Props ──

export interface SplitBottomToolIslandProps {
  island: ToolIsland;
  fraction: number;
  insertBeforeIndex: number;

  // Session resolution
  activeSessionId: string | null;
  activeSession: ChatSession | null;
  primaryPane: SessionPaneState;
  loadSplitPaneBootstrap: (sessionId: string) => Promise<SessionPaneBootstrap | null>;
  projects: Project[];
  activeProjectPath: string | undefined;

  // Split view state
  splitView: SplitViewState;

  // Animation
  shouldAnimateTopRowLayout: boolean;

  // Tool drag state
  splitToolDrag: ToolDragState | null;
  setSplitToolDrag: React.Dispatch<React.SetStateAction<ToolDragState | null>>;
  commitSplitToolDrop: () => void;
  resetSplitToolDrag: () => void;

  // Tool island shared context
  toolIslandCtx: ToolIslandContextProps;

  // Pane settings
  acpPermissionBehavior: "ask" | "auto_accept" | "allow_all";
  handleAgentWorktreeChange: (path: string | null) => void;
}

// ── Island renderer (shared between active and hosted) ──

function renderIslandContent(
  island: ToolIsland,
  fraction: number,
  insertBeforeIndex: number,
  session: ChatSession | null,
  paneState: SessionPaneState,
  isActiveSessionPane: boolean,
  props: SplitBottomToolIslandProps,
) {
  const {
    projects, activeProjectPath, splitView,
    shouldAnimateTopRowLayout,
    splitToolDrag, setSplitToolDrag, commitSplitToolDrop, resetSplitToolDrag,
    toolIslandCtx,
  } = props;

  const paneProject = session
    ? projects.find((project) => project.id === session.projectId) ?? null
    : null;
  const paneProjectPath = paneProject
    ? (getStoredProjectGitCwd(paneProject.id) ?? paneProject.path)
    : activeProjectPath;
  const paneProjectRoot = paneProject?.path;

  const controls = (
    <PanelDockControls
      isBottom={true}
      moveLabel="Move to top row"
      moveIcon={ArrowUp}
      onMovePlacement={() => splitView.moveToolIsland(island.id, "top")}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", island.id);
        event.dataTransfer.effectAllowed = "move";
        setSplitToolDrag({
          toolId: island.toolId,
          sourceSessionId: island.sourceSessionId,
          islandId: island.id,
          targetArea: null,
          targetIndex: null,
          targetColumnId: null,
        });
      }}
      onDragEnd={resetSplitToolDrag}
    />
  );

  return (
    <motion.div
      layout={shouldAnimateTopRowLayout}
      transition={shouldAnimateTopRowLayout
        ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
        : { duration: 0 }}
      className="island flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
      style={{ flex: `${fraction} 1 0%`, minWidth: 0 }}
      onDragOver={(event) => {
        if (!splitToolDrag || splitToolDrag.islandId === island.id) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const insertSide = getHorizontalInsertSide(rect, event.clientX);
        if (!insertSide) return;
        setSplitToolDrag((current) => current ? {
          ...current,
          targetArea: "bottom",
          targetIndex: insertSide === "before" ? insertBeforeIndex : insertBeforeIndex + 1,
        } : current);
      }}
      onDrop={(event) => {
        if (!splitToolDrag) return;
        event.preventDefault();
        commitSplitToolDrop();
      }}
    >
      <ToolIslandContent
        toolId={island.toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">}
        persistKey={island.persistKey}
        headerControls={controls}
        projectPath={paneProjectPath}
        projectRoot={paneProjectRoot}
        projectId={paneProject?.id ?? null}
        sessionId={island.sourceSessionId}
        messages={paneState.messages}
        activeEngine={session?.engine}
        isActiveSessionPane={isActiveSessionPane}
        hasLiveSession={paneState.isConnected}
        {...toolIslandCtx}
      />
    </motion.div>
  );
}

// ── Main component ──

function SplitBottomToolIslandInner(props: SplitBottomToolIslandProps) {
  const {
    island, fraction, insertBeforeIndex,
    activeSessionId, activeSession, primaryPane,
    loadSplitPaneBootstrap, acpPermissionBehavior,
  } = props;

  if (island.sourceSessionId === activeSessionId) {
    return renderIslandContent(island, fraction, insertBeforeIndex, activeSession, primaryPane, true, props);
  }

  return (
    <SplitPaneHost
      key={island.id}
      sessionId={island.sourceSessionId}
      acpPermissionBehavior={acpPermissionBehavior}
      loadBootstrap={loadSplitPaneBootstrap}
    >
      {({ session, paneState }) =>
        renderIslandContent(island, fraction, insertBeforeIndex, session, paneState, false, props)
      }
    </SplitPaneHost>
  );
}

export const SplitBottomToolIsland = React.memo(SplitBottomToolIslandInner);
