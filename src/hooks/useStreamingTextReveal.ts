import { useRef, useEffect, useLayoutEffect } from "react";

/** Byte-level prefix match for detecting appended text vs mid-text rewrites. */
function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

/** Walk down rightmost children to find the deepest last text node. */
function getDeepLastTextNode(el: Node): Text | null {
  for (let n: Node | null = el.lastChild; n; n = n.lastChild) {
    if (n.nodeType === Node.TEXT_NODE) return n as Text;
    // Skip empty element tails (e.g. <br/>) — try the previous sibling
    if (!n.lastChild) {
      const prev = n.previousSibling;
      if (prev?.nodeType === Node.TEXT_NODE) return prev as Text;
      if (prev) { n = prev; continue; }
      return null;
    }
  }
  return el.nodeType === Node.TEXT_NODE ? (el as Text) : null;
}

/** Detects likely-incomplete markdown code delimiters during streaming. */
function hasUnbalancedBackticks(markdown: string): boolean {
  if (!markdown) return false;
  const parityByRun = new Map<number, number>();
  for (let i = 0; i < markdown.length;) {
    if (markdown.charCodeAt(i) !== 96) {
      i += 1;
      continue;
    }
    // Skip escaped backticks (`\``) so inline literals do not trip balancing.
    if (i > 0 && markdown.charCodeAt(i - 1) === 92) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < markdown.length && markdown.charCodeAt(j) === 96) j += 1;
    const runLen = j - i;
    parityByRun.set(runLen, (parityByRun.get(runLen) ?? 0) ^ 1);
    i = j;
  }
  for (const parity of parityByRun.values()) {
    if (parity === 1) return true;
  }
  return false;
}

function hasCodeAncestor(node: Node, stopAt: Element): boolean {
  let current: Node | null = node.parentNode;
  while (current && current !== stopAt) {
    if (current instanceof HTMLElement) {
      const tag = current.tagName;
      if (tag === "CODE" || tag === "PRE") return true;
    }
    current = current.parentNode;
  }
  return false;
}

interface InjectedSpanState {
  span: HTMLSpanElement;
  expectedPrevText: string;
  injectedText: string;
}

/**
 * Injects per-token fade-in animation into a ReactMarkdown container by
 * splitting the trailing text node in `useLayoutEffect` (before paint).
 *
 * On every React commit the sequence is:
 *  1. React updates text nodes with new content.
 *  2. `useLayoutEffect` runs synchronously (before the browser paints):
 *     a. Removes any previously injected `<span>` from the last frame.
 *     b. Compares the last block element's `textContent` to its previous value.
 *     c. If text was appended, splits the trailing text node into
 *        [old text | <span class="stream-chunk-enter">new text</span>].
 *  3. The browser paints — user sees old text at full opacity + new text fading in.
 *
 * Because cleanup and re-injection both happen before paint, the user never
 * sees the intermediate React-only state. React's reconciler simply overwrites
 * our truncated text node on the next commit (it still holds a valid ref to it).
 */
export function useStreamingTextReveal(isStreaming: boolean | undefined, markdown: string) {
  const proseRef = useRef<HTMLDivElement>(null);
  const prevBlockTextRef = useRef("");
  const prevLastBlockRef = useRef<Element | null>(null);
  const injectedSpan = useRef<InjectedSpanState | null>(null);

  // Must run before paint so the user never sees un-animated text
  useLayoutEffect(() => {
    const cleanupInjectedSpan = () => {
      const injected = injectedSpan.current;
      if (!injected) return;
      const { span, expectedPrevText, injectedText } = injected;
      const prev = span.previousSibling;
      // Only merge when the node is still in the exact truncated state.
      // If React already restored full text, merging again would duplicate.
      if (prev && prev.nodeType === Node.TEXT_NODE) {
        const prevText = prev.textContent ?? "";
        if (prevText === expectedPrevText) {
          prev.textContent = prevText + injectedText;
        }
      }
      if (span.isConnected) span.remove();
      injectedSpan.current = null;
    };

    // Step 1: merge the injected span back into the preceding text node.
    // When the content string is identical between renders (e.g. the rAF flush
    // already set the final text before the `assistant` snapshot arrives),
    // React's reconciler skips updating the text node — but we truncated it
    // last frame. Merging restores the full value so no text is lost.
    cleanupInjectedSpan();

    if (!isStreaming || !proseRef.current) {
      prevBlockTextRef.current = "";
      prevLastBlockRef.current = null;
      return;
    }

    const container = proseRef.current;

    // Step 2: identify the last animatable block (skip code blocks / not-prose)
    let lastBlock: Element | null = null;
    for (let i = container.children.length - 1; i >= 0; i--) {
      const child = container.children[i] as HTMLElement;
      if (child.classList?.contains("not-prose")) continue;
      if (child.tagName === "PRE") continue;
      lastBlock = child;
      break;
    }
    if (!lastBlock) return;

    // Detect when the active block changes (new paragraph appeared)
    if (lastBlock !== prevLastBlockRef.current) {
      prevLastBlockRef.current = lastBlock;
      prevBlockTextRef.current = ""; // all text in the new block is "new"
    }

    const blockText = lastBlock.textContent ?? "";
    const prevText = prevBlockTextRef.current;
    prevBlockTextRef.current = blockText;

    // Streaming markdown can be structurally unstable around unmatched backticks.
    // Skip DOM splitting on those frames to avoid malformed inline-code transitions.
    const markdownTail = markdown.length > 1200 ? markdown.slice(-1200) : markdown;
    if (hasUnbalancedBackticks(markdownTail)) return;

    // Only animate pure appends — if text shrank or changed in the middle
    // (e.g. markdown syntax closing), skip this frame gracefully.
    if (blockText.length <= prevText.length) return;
    const prefixLen = commonPrefixLength(prevText, blockText);
    if (prefixLen < prevText.length) return;

    const addedText = blockText.slice(prefixLen);
    if (!addedText) return;

    // Step 3: find the deepest last text node inside the block
    const textNode = getDeepLastTextNode(lastBlock);
    if (!textNode || !textNode.parentNode) return;
    // Avoid splitting inside <code> where markdown structure can still shift.
    if (hasCodeAncestor(textNode, lastBlock)) return;

    const nodeText = textNode.textContent ?? "";
    // Safe path: appended block text must be entirely represented by the tail
    // of the deepest last text node. Otherwise this frame likely crossed a
    // markdown structure boundary and should not be surgically split.
    if (!nodeText.endsWith(addedText)) return;
    const splitAt = nodeText.length - addedText.length;
    const prefixText = nodeText.slice(0, splitAt);

    // Truncate the React-owned text node and append an animated span
    textNode.textContent = prefixText;
    const span = document.createElement("span");
    span.className = "stream-chunk-enter";
    span.textContent = addedText;
    textNode.parentNode.insertBefore(span, textNode.nextSibling);
    injectedSpan.current = {
      span,
      expectedPrevText: prefixText,
      injectedText: addedText,
    };
  });

  // Final cleanup when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      const injected = injectedSpan.current;
      if (injected) {
        const { span, expectedPrevText, injectedText } = injected;
        const prev = span.previousSibling;
        if (prev && prev.nodeType === Node.TEXT_NODE) {
          const prevText = prev.textContent ?? "";
          if (prevText === expectedPrevText) {
            prev.textContent = prevText + injectedText;
          }
        }
        if (span.isConnected) span.remove();
        injectedSpan.current = null;
      }
      prevBlockTextRef.current = "";
      prevLastBlockRef.current = null;
    }
  }, [isStreaming]);

  return proseRef;
}
