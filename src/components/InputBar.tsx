// Re-export shim — InputBar has been decomposed into src/components/input-bar/
// This file preserves backward compatibility for any existing imports.
export { InputBar } from "./input-bar";
export type { InputBarProps } from "./input-bar";
export {
  LOCAL_CLEAR_COMMAND,
  getAvailableSlashCommands,
  getSlashCommandReplacement,
  isClearCommandText,
} from "./input-bar";
