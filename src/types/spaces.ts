// ── Space types ──

export interface SpaceColor {
  hue: number;           // OKLCh hue 0-360
  chroma: number;        // OKLCh chroma 0-0.4
  gradientHue?: number;  // Optional second hue for gradient
  opacity?: number;      // Island background opacity 0.2-1, defaults to 1.0
}

export interface Space {
  id: string;
  name: string;
  icon: string;              // Emoji or lucide PascalCase name ("Rocket")
  iconType: "emoji" | "lucide";
  color: SpaceColor;
  createdAt: number;
  order: number;             // Position in bottom bar
}
