import type { SlashCommand } from "@/types";
import type { AcceptedMediaType } from "./constants";
import { ACCEPTED_IMAGE_TYPES } from "./constants";

const BLANK_AUDIO_PLACEHOLDER_RE = /\[BLANK_AUDIO\]/gi;

/** Read a file as base64 data with its media type. */
export function readFileAsBase64(
  file: globalThis.File,
): Promise<{ data: string; mediaType: AcceptedMediaType }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve({ data: base64, mediaType: file.type as AcceptedMediaType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Check if a file has an accepted image MIME type. */
export function isAcceptedImage(file: globalThis.File): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type);
}

/** Insert text at the current cursor position in a contentEditable element. */
export function insertTextAtCursor(
  el: HTMLElement | null,
  text: string,
): void {
  if (!el) return;
  el.focus();

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    // No cursor -- append to end
    el.appendChild(document.createTextNode(text));
  } else {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    // Move cursor after inserted text
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Trigger input handler so hasContent updates and send button enables
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Fast non-whitespace check that short-circuits early for typical prompts. */
export function hasMeaningfulText(text: string): boolean {
  const sanitized = stripVoicePlaceholderText(text);
  for (let i = 0; i < sanitized.length; i++) {
    const code = sanitized.charCodeAt(i);
    if (
      code !== 32 && // space
      code !== 9 && // tab
      code !== 10 && // \n
      code !== 13 && // \r
      code !== 11 && // vertical tab
      code !== 12 && // form feed
      code !== 160 // nbsp
    ) {
      return true;
    }
  }
  return false;
}

/** Remove placeholder text inserted by native dictation when no speech was captured. */
export function stripVoicePlaceholderText(text: string): string {
  return text.replace(BLANK_AUDIO_PLACEHOLDER_RE, "");
}

/** Extract full text + mention paths from a contentEditable element. */
export function extractEditableContent(el: HTMLElement): {
  text: string;
  mentionPaths: string[];
  deepMentionPaths: Set<string>;
} {
  let text = "";
  const mentionPaths: string[] = [];
  const deepMentionPaths = new Set<string>();
  const BLOCK_TAGS = new Set([
    "DIV",
    "P",
    "LI",
    "PRE",
    "BLOCKQUOTE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
  ]);

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node instanceof HTMLElement) {
      const mentionPath = node.dataset.mentionPath;
      if (mentionPath) {
        const isDeep = node.dataset.mentionDeep === "true";
        text += `@${isDeep ? "#" : ""}${mentionPath}`;
        mentionPaths.push(mentionPath);
        if (isDeep) {
          deepMentionPaths.add(mentionPath);
        }
      } else if (node.tagName === "BR") {
        text += "\n";
      } else {
        for (const child of node.childNodes) walk(child);
        // Preserve line boundaries when the editor stores rows as block nodes.
        if (BLOCK_TAGS.has(node.tagName) && !text.endsWith("\n")) {
          text += "\n";
        }
      }
    }
  };

  for (const child of el.childNodes) walk(child);
  return {
    text: stripVoicePlaceholderText(
      text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " "),
    ),
    mentionPaths: [...new Set(mentionPaths)],
    deepMentionPaths,
  };
}

/** Simple fuzzy match: all query chars must appear in order. */
export function fuzzyMatch(
  query: string,
  target: string,
): { match: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (t.startsWith(q)) return { match: true, score: 100 + 1 / target.length };
  if (t.includes(q)) return { match: true, score: 50 + 1 / target.length };

  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length)
    return { match: true, score: 10 + qi / target.length };

  return { match: false, score: 0 };
}

type EnterKeyEventLike = {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
  };
};

/** Enter should submit only when not composing text via an IME. */
export function shouldSubmitOnEnter(event: EnterKeyEventLike): boolean {
  if (event.key !== "Enter" || event.shiftKey) return false;
  const nativeEvent = event.nativeEvent;
  return !(
    event.isComposing ||
    nativeEvent?.isComposing ||
    nativeEvent?.keyCode === 229
  );
}

// ── Slash command helpers (exported for tests + external consumers) ──

export const LOCAL_CLEAR_COMMAND: SlashCommand = {
  name: "clear",
  description: "Open a new chat without sending anything to the agent",
  argumentHint: "",
  source: "local",
};

export function getAvailableSlashCommands(
  slashCommands?: SlashCommand[],
): SlashCommand[] {
  const commands =
    slashCommands?.filter(
      (cmd) => cmd.name !== LOCAL_CLEAR_COMMAND.name,
    ) ?? [];
  return [LOCAL_CLEAR_COMMAND, ...commands];
}

export function isClearCommandText(text: string): boolean {
  return text.trim() === `/${LOCAL_CLEAR_COMMAND.name}`;
}

export function getSlashCommandReplacement(cmd: SlashCommand): string {
  switch (cmd.source) {
    case "claude":
    case "acp":
      return `/${cmd.name} `;
    case "codex-skill":
      return cmd.defaultPrompt
        ? `$${cmd.name} ${cmd.defaultPrompt}`
        : `$${cmd.name} `;
    case "codex-app":
      return `$${cmd.appSlug ?? cmd.name} `;
    case "local":
      // Local commands execute directly, so keep the exact command text with no trailing space.
      return `/${cmd.name}`;
  }
}

// ── In-source tests ──

if (import.meta.vitest) {
  const { it, describe, expect } = import.meta.vitest;

  describe("extractEditableContent", () => {
    it("extracts shallow mention paths from data attributes", () => {
      const container = document.createElement("div");
      const mention = document.createElement("span");
      mention.dataset.mentionPath = "foo/bar";
      container.appendChild(mention);

      const result = extractEditableContent(container);

      expect(result.text).toBe("@foo/bar");
      expect(result.mentionPaths).toEqual(["foo/bar"]);
      expect(result.deepMentionPaths.size).toBe(0);
    });

    it("extracts deep mention paths and formats text with @# prefix", () => {
      const container = document.createElement("div");
      const block = document.createElement("div");
      const deepMention = document.createElement("span");

      deepMention.dataset.mentionPath = "space/123";
      deepMention.dataset.mentionDeep = "true";

      block.appendChild(document.createTextNode("See "));
      block.appendChild(deepMention);
      container.appendChild(block);

      const result = extractEditableContent(container);

      // Block elements append a trailing newline.
      expect(result.text).toBe("See @#space/123\n");
      expect(result.mentionPaths).toEqual(["space/123"]);
      expect(result.deepMentionPaths.has("space/123")).toBe(true);
    });

  });
}
