import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["electron/src/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    environment: "node",
    alias: {
      "@/": path.resolve(__dirname, "src/"),
      "@shared/": path.resolve(__dirname, "shared/"),
    },
    restoreMocks: true,
  },
});
