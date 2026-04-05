import { useCallback, type ComponentProps } from "react";
import { InputBar } from "./input-bar";
import { PermissionPrompt } from "./PermissionPrompt";
import { WorktreeBar } from "./WorktreeBar";

type InputBarProps = ComponentProps<typeof InputBar>;
type PermissionPromptProps = ComponentProps<typeof PermissionPrompt>;

interface BottomComposerProps extends InputBarProps {
  pendingPermission: PermissionPromptProps["request"] | null;
  onRespondPermission: PermissionPromptProps["onRespond"];
  selectedWorktreePath?: string | null;
  onSelectWorktree?: (path: string) => void;
  isEmptySession?: boolean;
}

export function BottomComposer({
  pendingPermission,
  onRespondPermission,
  selectedWorktreePath,
  onSelectWorktree,
  isEmptySession,
  ...inputBarProps
}: BottomComposerProps) {
  const hasPendingPermission = !!pendingPermission;

  // Wrap InputBar's onSend for WorktreeBar's simpler (text-only) signature
  const handleWorktreeSend = useCallback(
    (text: string) => inputBarProps.onSend(text),
    [inputBarProps.onSend],
  );

  return (
    <>
      {onSelectWorktree && (
        <WorktreeBar
          projectPath={inputBarProps.projectPath}
          selectedWorktreePath={selectedWorktreePath ?? null}
          onSelectWorktree={onSelectWorktree}
          onSend={handleWorktreeSend}
          isEmptySession={isEmptySession ?? false}
        />
      )}
      {pendingPermission ? (
        <PermissionPrompt
          key={pendingPermission.requestId}
          request={pendingPermission}
          onRespond={onRespondPermission}
        />
      ) : null}
      <div
        hidden={hasPendingPermission}
        aria-hidden={hasPendingPermission}
        inert={hasPendingPermission || undefined}
      >
        <InputBar {...inputBarProps} />
      </div>
    </>
  );
}
