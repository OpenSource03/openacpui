import type { AcpPermissionBehavior } from "@/types";

/** Shared className overrides for ghost toolbar buttons in the input bar.
 *  Applied on top of `<Button variant="ghost" size="xs">` to match the
 *  toolbar look: muted text, subtle hover, rounded-lg corners. */
export const TOOLBAR_BTN =
  "rounded-lg font-normal text-muted-foreground transition-colors duration-150 hover:bg-muted/50 hover:text-foreground";

export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type AcceptedMediaType = (typeof ACCEPTED_IMAGE_TYPES)[number];

export const ACP_PERMISSION_BEHAVIORS = [
  {
    id: "ask" as const,
    label: "Ask",
    description: "Show permission prompt",
  },
  {
    id: "auto_accept" as const,
    label: "Auto Accept",
    description: "Auto-approve each tool call",
  },
  {
    id: "allow_all" as const,
    label: "Allow All",
    description: "Auto-approve with always-allow",
  },
] as const satisfies ReadonlyArray<{
  id: AcpPermissionBehavior;
  label: string;
  description: string;
}>;

export const PERMISSION_MODES = [
  { id: "default", label: "Ask Before Edits" },
  { id: "acceptEdits", label: "Accept Edits" },
  { id: "bypassPermissions", label: "Allow All" },
] as const;

export const CODEX_PERMISSION_MODE_DETAILS: Record<
  (typeof PERMISSION_MODES)[number]["id"],
  { policy: string; description: string }
> = {
  default: {
    policy: "on-request",
    description: "Prompt before commands and file edits",
  },
  acceptEdits: {
    policy: "untrusted",
    description:
      "Auto-approve trusted edits; prompt for untrusted actions",
  },
  bypassPermissions: {
    policy: "never",
    description: "No approval prompts",
  },
};
