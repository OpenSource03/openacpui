import { ChevronDown, Map, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AcpPermissionBehavior } from "@/types";
import {
  TOOLBAR_BTN,
  ACP_PERMISSION_BEHAVIORS,
  PERMISSION_MODES,
  CODEX_PERMISSION_MODE_DETAILS,
} from "./constants";

// ── Sub-components ──

/** Permission mode dropdown -- used by Claude and Codex engines */
function PermissionDropdown({
  permissionMode,
  onPermissionModeChange,
  showDetails,
  disabled,
}: {
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  /** When true, shows policy + description (Codex style) */
  showDetails?: boolean;
  disabled?: boolean;
}) {
  const selectedMode =
    PERMISSION_MODES.find((m) => m.id === permissionMode) ??
    PERMISSION_MODES[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={TOOLBAR_BTN}
          disabled={disabled}
        >
          <Shield className="size-3" />
          {selectedMode.label}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PERMISSION_MODES.map((m) => {
          const details = showDetails
            ? CODEX_PERMISSION_MODE_DETAILS[m.id]
            : undefined;
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => onPermissionModeChange(m.id)}
              className={m.id === permissionMode ? "bg-accent" : ""}
            >
              {details ? (
                <div className="flex min-w-0 flex-col">
                  <span>{m.label}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="font-mono text-foreground/80">
                      {details.policy}
                    </span>
                    <span aria-hidden="true">&middot;</span>
                    <span>{details.description}</span>
                  </span>
                </div>
              ) : (
                m.label
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Plan mode toggle button -- used by Claude and Codex engines */
function PlanModeToggle({
  planMode,
  onPlanModeChange,
  disabled,
}: {
  planMode: boolean;
  onPlanModeChange: (enabled: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={() => onPlanModeChange(!planMode)}
          className={`rounded-lg font-normal ${
            planMode
              ? "text-blue-400 bg-blue-500/10 hover:bg-blue-500/15 hover:text-blue-400 dark:hover:bg-blue-500/15"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          }`}
        >
          <Map className="size-3" />
          Plan
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">
          {planMode ? "Plan mode on" : "Plan mode off"} (Shift+Tab)
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Main component ──

export interface EngineControlsProps {
  isCodexAgent: boolean;
  isACPAgent: boolean;
  isProcessing: boolean;
  disabled?: boolean;
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  planMode: boolean;
  onPlanModeChange: (enabled: boolean) => void;
  acpPermissionBehavior?: AcpPermissionBehavior;
  onAcpPermissionBehaviorChange?: (behavior: AcpPermissionBehavior) => void;
}

/** Renders plan/permission controls per engine (model/config moved to engine picker). */
export function EngineControls({
  isCodexAgent,
  isACPAgent,
  isProcessing,
  disabled,
  permissionMode,
  onPermissionModeChange,
  planMode,
  onPlanModeChange,
  acpPermissionBehavior,
  onAcpPermissionBehaviorChange,
}: EngineControlsProps) {
  if (isACPAgent) {
    if (!onAcpPermissionBehaviorChange) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className={TOOLBAR_BTN}
            disabled={isProcessing || disabled}
          >
            <Shield className="size-3" />
            {ACP_PERMISSION_BEHAVIORS.find(
              (b) => b.id === acpPermissionBehavior,
            )?.label ?? "Ask"}
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {ACP_PERMISSION_BEHAVIORS.map((b) => (
            <DropdownMenuItem
              key={b.id}
              onClick={() => onAcpPermissionBehaviorChange(b.id)}
              className={b.id === acpPermissionBehavior ? "bg-accent" : ""}
            >
              <div>
                <div>{b.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {b.description}
                </div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <PlanModeToggle
        planMode={planMode}
        onPlanModeChange={onPlanModeChange}
        disabled={disabled}
      />
      <PermissionDropdown
        permissionMode={permissionMode}
        onPermissionModeChange={onPermissionModeChange}
        showDetails={isCodexAgent}
        disabled={disabled}
      />
    </>
  );
}
