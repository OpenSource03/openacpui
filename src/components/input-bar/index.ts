export { InputBar } from "./InputBar";
export type { InputBarProps } from "./InputBar";

// Re-export slash command utilities for external consumers (tests, other components)
export {
  LOCAL_CLEAR_COMMAND,
  getAvailableSlashCommands,
  getSlashCommandReplacement,
  isClearCommandText,
  shouldSubmitOnEnter,
} from "./input-bar-utils";
