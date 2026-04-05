// ── Attachment types ──

export interface ImageAttachment {
  id: string;
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  fileName?: string;
}

/** Element data captured by the browser inspector (Element Grab feature). */
export interface GrabbedElement {
  id: string;
  /** Page URL where the element was captured */
  url: string;
  tag: string;
  /** Best-effort unique CSS selector path */
  selector: string;
  classes: string[];
  /** Whitelisted attributes (id, href, src, alt, role, aria-label, data-testid, etc.) */
  attributes: Record<string, string>;
  /** innerText truncated to 500 chars */
  textContent: string;
  /** outerHTML truncated to 2000 chars */
  outerHTML: string;
  /** Key computed styles (display, position, color, font-size, etc.) */
  computedStyles: Record<string, string>;
  boundingRect: { x: number; y: number; width: number; height: number };
}
