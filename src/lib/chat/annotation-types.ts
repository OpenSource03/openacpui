/** All available annotation tool modes. */
export type AnnotationTool =
  | "select"
  | "freehand"
  | "rectangle"
  | "circle"
  | "arrow"
  | "text"
  | "highlight"
  | "eraser";

/** Base properties shared by all annotation shapes. */
interface AnnotationBase {
  id: string;
  type: AnnotationTool;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
}

/** Freehand line — series of [x,y] pairs in Konva Line format. */
export interface FreehandAnnotation extends AnnotationBase {
  type: "freehand";
  points: number[];
}

/** Rectangle or highlight (highlight uses semi-transparent fill). */
export interface RectAnnotation extends AnnotationBase {
  type: "rectangle" | "highlight";
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
}

/** Ellipse annotation. */
export interface CircleAnnotation extends AnnotationBase {
  type: "circle";
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
}

/** Arrow annotation — two endpoints. */
export interface ArrowAnnotation extends AnnotationBase {
  type: "arrow";
  points: [number, number, number, number];
}

/** Text label annotation. */
export interface TextAnnotation extends AnnotationBase {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
}

/** Union of all annotation shape types. */
export type Annotation =
  | FreehandAnnotation
  | RectAnnotation
  | CircleAnnotation
  | ArrowAnnotation
  | TextAnnotation;

/** Default annotation colors — preset palette for quick selection. */
export const ANNOTATION_COLORS = [
  "#EF4444", // red
  "#F97316", // orange
  "#EAB308", // yellow
  "#22C55E", // green
  "#3B82F6", // blue
  "#8B5CF6", // purple
  "#EC4899", // pink
  "#FFFFFF", // white
] as const;

/** Default highlight color (semi-transparent yellow). */
export const HIGHLIGHT_COLOR = "rgba(250, 204, 21, 0.35)";

/** Default stroke width. */
export const DEFAULT_STROKE_WIDTH = 3;

/** Default stroke color. */
export const DEFAULT_STROKE_COLOR = "#EF4444";

/** Default font size for text annotations. */
export const DEFAULT_FONT_SIZE = 18;
