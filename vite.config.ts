import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-markdown": ["react-markdown", "remark-gfm"],
          "vendor-syntax": ["react-syntax-highlighter", "refractor"],
          "vendor-xterm": ["@xterm/xterm", "@xterm/addon-fit"],
          "vendor-diff": ["diff"],
          "vendor-konva": ["konva", "react-konva"],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
