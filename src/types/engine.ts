// Re-export from shared types for backward compatibility
export * from "../../shared/types/engine";
// EngineHookState and BackgroundSessionSnapshot live in the renderer layer (they depend on React)
export * from "./engine-hook";
