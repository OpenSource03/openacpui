export type ThemeDefinition = {
  id: string;
  name: string;
  type: "dark" | "light";
  monaco: {
    base: "vs" | "vs-dark" | "hc-black";
    colors: Record<string, string>;
    rules: Array<{ token: string; foreground?: string; background?: string; fontStyle?: string }>;
  };
  ui: Record<string, string>;
};


export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    id: "default-dark",
    name: "Default Dark",
    type: "dark",
    monaco: {
      base: "vs-dark",
      colors: {},
      rules: [],
    },
    ui: {},
  },
  {
    id: "dracula",
    name: "Dracula",
    type: "dark",
    monaco: {
      base: "vs-dark",
      colors: {
        "editor.background": "#282a36",
        "editor.foreground": "#f8f8f2",
        "editor.selectionBackground": "#44475a",
        "editor.lineHighlightBackground": "#44475a75",
        "editorCursor.foreground": "#f8f8f2",
      },
      rules: [
        { token: "comment", foreground: "6272a4", fontStyle: "italic" },
        { token: "keyword", foreground: "ff79c6" },
        { token: "string", foreground: "f1fa8c" },
        { token: "number", foreground: "bd93f9" },
        { token: "type", foreground: "8be9fd", fontStyle: "italic" },
        { token: "function", foreground: "50fa7b" },
        { token: "variable", foreground: "f8f8f2" },
        { token: "constant", foreground: "bd93f9" },
        { token: "tag", foreground: "ff79c6" },
        { token: "attribute.name", foreground: "50fa7b" },
        { token: "attribute.value", foreground: "f1fa8c" },
        { token: "delimiter", foreground: "f8f8f2" },
        { token: "operator", foreground: "ff79c6" },
      ],
    },
    ui: {
      background: "#282a36", foreground: "#f8f8f2", card: "#21222c", cardForeground: "#f8f8f2",
      popover: "#21222c", popoverForeground: "#f8f8f2", primary: "#bd93f9", primaryForeground: "#282a36",
      secondary: "#44475a", secondaryForeground: "#f8f8f2", muted: "#44475a", mutedForeground: "#6272a4",
      accent: "#44475a", accentForeground: "#f8f8f2", destructive: "#ff5555", border: "#44475a",
      input: "#44475a", ring: "#bd93f9", sidebarBackground: "#21222c", sidebarForeground: "#f8f8f2",
      sidebarBorder: "#44475a",
    },
  },
  {
    id: "one-dark",
    name: "One Dark",
    type: "dark",
    monaco: {
      base: "vs-dark",
      colors: {
        "editor.background": "#282c34",
        "editor.foreground": "#abb2bf",
        "editor.selectionBackground": "#3e4451",
        "editor.lineHighlightBackground": "#2c313c",
        "editorCursor.foreground": "#528bff",
      },
      rules: [
        { token: "comment", foreground: "5c6370", fontStyle: "italic" },
        { token: "keyword", foreground: "c678dd" },
        { token: "string", foreground: "98c379" },
        { token: "number", foreground: "d19a66" },
        { token: "type", foreground: "e5c07b" },
        { token: "function", foreground: "61afef" },
        { token: "variable", foreground: "e06c75" },
        { token: "tag", foreground: "e06c75" },
        { token: "attribute.name", foreground: "d19a66" },
        { token: "attribute.value", foreground: "98c379" },
        { token: "operator", foreground: "56b6c2" },
      ],
    },
    ui: {
      background: "#282c34", foreground: "#abb2bf", card: "#21252b", cardForeground: "#abb2bf",
      popover: "#21252b", popoverForeground: "#abb2bf", primary: "#61afef", primaryForeground: "#282c34",
      secondary: "#3e4451", secondaryForeground: "#abb2bf", muted: "#3e4451", mutedForeground: "#5c6370",
      accent: "#3e4451", accentForeground: "#abb2bf", destructive: "#e06c75", border: "#3e4451",
      input: "#3e4451", ring: "#61afef", sidebarBackground: "#21252b", sidebarForeground: "#abb2bf",
      sidebarBorder: "#3e4451",
    },
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    type: "dark",
    monaco: {
      base: "vs-dark",
      colors: {
        "editor.background": "#1e1e2e",
        "editor.foreground": "#cdd6f4",
        "editor.selectionBackground": "#45475a",
        "editor.lineHighlightBackground": "#313244",
        "editorCursor.foreground": "#f5e0dc",
      },
      rules: [
        { token: "comment", foreground: "6c7086", fontStyle: "italic" },
        { token: "keyword", foreground: "cba6f7" },
        { token: "string", foreground: "a6e3a1" },
        { token: "number", foreground: "fab387" },
        { token: "type", foreground: "f9e2af" },
        { token: "function", foreground: "89b4fa" },
        { token: "variable", foreground: "cdd6f4" },
        { token: "tag", foreground: "cba6f7" },
        { token: "operator", foreground: "89dceb" },
      ],
    },
    ui: {
      background: "#1e1e2e", foreground: "#cdd6f4", card: "#181825", cardForeground: "#cdd6f4",
      popover: "#181825", popoverForeground: "#cdd6f4", primary: "#cba6f7", primaryForeground: "#1e1e2e",
      secondary: "#313244", secondaryForeground: "#cdd6f4", muted: "#313244", mutedForeground: "#6c7086",
      accent: "#313244", accentForeground: "#cdd6f4", destructive: "#f38ba8", border: "#313244",
      input: "#313244", ring: "#cba6f7", sidebarBackground: "#181825", sidebarForeground: "#cdd6f4",
      sidebarBorder: "#313244",
    },
  },
  {
    id: "nord",
    name: "Nord",
    type: "dark",
    monaco: {
      base: "vs-dark",
      colors: {
        "editor.background": "#2e3440",
        "editor.foreground": "#d8dee9",
        "editor.selectionBackground": "#434c5e",
        "editor.lineHighlightBackground": "#3b4252",
        "editorCursor.foreground": "#d8dee9",
      },
      rules: [
        { token: "comment", foreground: "616e88", fontStyle: "italic" },
        { token: "keyword", foreground: "81a1c1" },
        { token: "string", foreground: "a3be8c" },
        { token: "number", foreground: "b48ead" },
        { token: "type", foreground: "8fbcbb" },
        { token: "function", foreground: "88c0d0" },
        { token: "variable", foreground: "d8dee9" },
        { token: "tag", foreground: "81a1c1" },
        { token: "operator", foreground: "81a1c1" },
      ],
    },
    ui: {
      background: "#2e3440", foreground: "#d8dee9", card: "#2e3440", cardForeground: "#d8dee9",
      popover: "#3b4252", popoverForeground: "#d8dee9", primary: "#88c0d0", primaryForeground: "#2e3440",
      secondary: "#3b4252", secondaryForeground: "#d8dee9", muted: "#3b4252", mutedForeground: "#616e88",
      accent: "#3b4252", accentForeground: "#d8dee9", destructive: "#bf616a", border: "#3b4252",
      input: "#3b4252", ring: "#88c0d0", sidebarBackground: "#2e3440", sidebarForeground: "#d8dee9",
      sidebarBorder: "#3b4252",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    type: "dark",
    monaco: {
      base: "vs-dark",
      colors: {
        "editor.background": "#1a1b26",
        "editor.foreground": "#a9b1d6",
        "editor.selectionBackground": "#33467c",
        "editor.lineHighlightBackground": "#1e2030",
        "editorCursor.foreground": "#c0caf5",
      },
      rules: [
        { token: "comment", foreground: "565f89", fontStyle: "italic" },
        { token: "keyword", foreground: "9d7cd8" },
        { token: "string", foreground: "9ece6a" },
        { token: "number", foreground: "ff9e64" },
        { token: "type", foreground: "2ac3de" },
        { token: "function", foreground: "7aa2f7" },
        { token: "variable", foreground: "c0caf5" },
        { token: "tag", foreground: "f7768e" },
        { token: "operator", foreground: "89ddff" },
      ],
    },
    ui: {
      background: "#1a1b26", foreground: "#a9b1d6", card: "#16161e", cardForeground: "#a9b1d6",
      popover: "#16161e", popoverForeground: "#a9b1d6", primary: "#7aa2f7", primaryForeground: "#1a1b26",
      secondary: "#292e42", secondaryForeground: "#a9b1d6", muted: "#292e42", mutedForeground: "#565f89",
      accent: "#292e42", accentForeground: "#a9b1d6", destructive: "#f7768e", border: "#292e42",
      input: "#292e42", ring: "#7aa2f7", sidebarBackground: "#16161e", sidebarForeground: "#a9b1d6",
      sidebarBorder: "#292e42",
    },
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    type: "dark",
    monaco: {
      base: "vs-dark",
      colors: {
        "editor.background": "#282828",
        "editor.foreground": "#ebdbb2",
        "editor.selectionBackground": "#504945",
        "editor.lineHighlightBackground": "#32302f",
        "editorCursor.foreground": "#ebdbb2",
      },
      rules: [
        { token: "comment", foreground: "928374", fontStyle: "italic" },
        { token: "keyword", foreground: "fb4934" },
        { token: "string", foreground: "b8bb26" },
        { token: "number", foreground: "d3869b" },
        { token: "type", foreground: "fabd2f" },
        { token: "function", foreground: "83a598" },
        { token: "variable", foreground: "ebdbb2" },
        { token: "tag", foreground: "fb4934" },
        { token: "operator", foreground: "fe8019" },
      ],
    },
    ui: {
      background: "#282828", foreground: "#ebdbb2", card: "#1d2021", cardForeground: "#ebdbb2",
      popover: "#1d2021", popoverForeground: "#ebdbb2", primary: "#fabd2f", primaryForeground: "#282828",
      secondary: "#3c3836", secondaryForeground: "#ebdbb2", muted: "#3c3836", mutedForeground: "#928374",
      accent: "#3c3836", accentForeground: "#ebdbb2", destructive: "#fb4934", border: "#3c3836",
      input: "#3c3836", ring: "#fabd2f", sidebarBackground: "#1d2021", sidebarForeground: "#ebdbb2",
      sidebarBorder: "#3c3836",
    },
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    type: "dark",
    monaco: {
      base: "vs-dark",
      colors: {
        "editor.background": "#0d1117",
        "editor.foreground": "#c9d1d9",
        "editor.selectionBackground": "#264f78",
        "editor.lineHighlightBackground": "#161b22",
        "editorCursor.foreground": "#c9d1d9",
      },
      rules: [
        { token: "comment", foreground: "8b949e", fontStyle: "italic" },
        { token: "keyword", foreground: "ff7b72" },
        { token: "string", foreground: "a5d6ff" },
        { token: "number", foreground: "79c0ff" },
        { token: "type", foreground: "ffa657" },
        { token: "function", foreground: "d2a8ff" },
        { token: "variable", foreground: "ffa657" },
        { token: "tag", foreground: "7ee787" },
        { token: "operator", foreground: "ff7b72" },
      ],
    },
    ui: {
      background: "#0d1117", foreground: "#c9d1d9", card: "#161b22", cardForeground: "#c9d1d9",
      popover: "#161b22", popoverForeground: "#c9d1d9", primary: "#58a6ff", primaryForeground: "#0d1117",
      secondary: "#21262d", secondaryForeground: "#c9d1d9", muted: "#21262d", mutedForeground: "#8b949e",
      accent: "#21262d", accentForeground: "#c9d1d9", destructive: "#f85149", border: "#30363d",
      input: "#21262d", ring: "#58a6ff", sidebarBackground: "#010409", sidebarForeground: "#c9d1d9",
      sidebarBorder: "#21262d",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    type: "dark",
    monaco: {
      base: "vs-dark",
      colors: {
        "editor.background": "#002b36",
        "editor.foreground": "#839496",
        "editor.selectionBackground": "#073642",
        "editor.lineHighlightBackground": "#073642",
        "editorCursor.foreground": "#839496",
      },
      rules: [
        { token: "comment", foreground: "586e75", fontStyle: "italic" },
        { token: "keyword", foreground: "859900" },
        { token: "string", foreground: "2aa198" },
        { token: "number", foreground: "d33682" },
        { token: "type", foreground: "b58900" },
        { token: "function", foreground: "268bd2" },
        { token: "variable", foreground: "839496" },
        { token: "tag", foreground: "268bd2" },
        { token: "operator", foreground: "859900" },
      ],
    },
    ui: {
      background: "#002b36", foreground: "#839496", card: "#073642", cardForeground: "#839496",
      popover: "#073642", popoverForeground: "#839496", primary: "#268bd2", primaryForeground: "#fdf6e3",
      secondary: "#073642", secondaryForeground: "#839496", muted: "#073642", mutedForeground: "#586e75",
      accent: "#073642", accentForeground: "#93a1a1", destructive: "#dc322f", border: "#073642",
      input: "#073642", ring: "#268bd2", sidebarBackground: "#002b36", sidebarForeground: "#839496",
      sidebarBorder: "#073642",
    },
  },
];

const UI_KEY_TO_CSS: Record<string, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  border: "--border",
  input: "--input",
  ring: "--ring",
  sidebarBackground: "--sidebar-background",
  sidebarForeground: "--sidebar-foreground",
  sidebarBorder: "--sidebar-border",
};

export function applyThemeUI(theme: ThemeDefinition): void {
  if (Object.keys(theme.ui).length === 0) return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.ui)) {
    const cssVar = UI_KEY_TO_CSS[key];
    if (cssVar) root.style.setProperty(cssVar, value);
  }
}

export function clearThemeUI(): void {
  const root = document.documentElement;
  for (const cssVar of Object.values(UI_KEY_TO_CSS)) {
    root.style.removeProperty(cssVar);
  }
}

export function getMonacoThemeName(themeId: string): string {
  return `harnss-${themeId}`;
}
