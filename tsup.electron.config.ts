import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "electron/src/main.ts",
    preload: "electron/src/preload.ts",
  },
  outDir: "electron/dist",
  format: ["cjs"],
  target: "es2020",
  platform: "node",
  splitting: false,
  clean: true,
  external: [
    "electron",
    "node-pty",
    "electron-liquid-glass",
    "@anthropic-ai/claude-agent-sdk",
    "electron-updater",
    "posthog-node",
  ],
  noExternal: [],
  treeshake: true,
});
