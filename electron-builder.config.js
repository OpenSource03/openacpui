/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.openacpui.app",
  productName: "OpenACP UI",

  directories: {
    output: "release/${version}",
    buildResources: "build",
  },

  // --- Files to include in the app ---
  files: [
    "electron/dist/**/*",
    "dist/**/*",
    "package.json",
    "!src/**",
    "!electron/src/**",
    "!docs/**",
    "!logs/**",
    "!opcode-reference/**",
    "!tsup.electron.config.ts",
    "!vite.config.ts",
    "!tsconfig.json",
    "!electron/tsconfig.json",
    "!components.json",
    "!*.md",
    "!.claude/**",
    "!.git/**",
    "!.github/**",
    "!build/**",
    "!scripts/**",
    "!release/**",
  ],

  // --- ASAR packing ---
  asar: true,
  asarUnpack: [
    "node_modules/node-pty/**",
    "node_modules/electron-liquid-glass/**",
    "node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
    "node_modules/@anthropic-ai/claude-agent-sdk/*.wasm",
    "node_modules/@anthropic-ai/claude-agent-sdk/vendor/**",
    "node_modules/@anthropic-ai/claude-agent-sdk/manifest*.json",
  ],

  npmRebuild: true,
  nodeGypRebuild: false,
  includePdb: false,

  // --- macOS ---
  mac: {
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    category: "public.app-category.developer-tools",
    icon: "build/icon.png",
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
  },

  dmg: {
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: "link", path: "/Applications" },
    ],
    window: { width: 540, height: 380 },
  },

  // --- Windows ---
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "build/icon.png",
    files: [
      "!node_modules/electron-liquid-glass/**",
      "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/arm64-darwin/**",
      "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/x64-darwin/**",
      "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/arm64-linux/**",
      "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/x64-linux/**",
      "!node_modules/node-pty/prebuilds/darwin-*/**",
      "!node_modules/node-pty/prebuilds/linux-*/**",
    ],
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    artifactName: "${productName}-Setup-${version}.${ext}",
  },

  // --- Linux ---
  linux: {
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
    ],
    category: "Development",
    icon: "build/icon.png",
    files: [
      "!node_modules/electron-liquid-glass/**",
      "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/arm64-darwin/**",
      "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/x64-darwin/**",
      "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/arm64-win32/**",
      "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/x64-win32/**",
      "!node_modules/node-pty/prebuilds/darwin-*/**",
      "!node_modules/node-pty/prebuilds/win32-*/**",
    ],
  },

  deb: {
    depends: ["libnotify4", "libsecret-1-0"],
  },

  // --- Auto-update ---
  publish: {
    provider: "github",
    owner: "OpenSource03",
    repo: "openacpui",
    releaseType: "release",
  },

  afterSign: "scripts/notarize.js",
};
