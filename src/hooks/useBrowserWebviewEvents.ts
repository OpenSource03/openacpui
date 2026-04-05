/**
 * Manages Electron webview event listeners for browser tab instances.
 *
 * Encapsulates all webview lifecycle events (navigation, loading, title,
 * DOM ready, DevTools, console messages) and provides derived state
 * (canGoBack, canGoForward, isSecure, isDomReady, isDevToolsOpen).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BrowserTab,
  ElectronWebviewElement,
  WebviewConsoleEvent,
  WebviewTitleEvent,
} from "@/components/browser/browser-types";
import type { GrabbedElement } from "@/types";
import { GRAB_MARKER } from "@/lib/element-inspector";

// ── Types ───────────────────────────────────────────────────────────────

interface WebviewEventCallbacks {
  onUpdateTab: (updates: Partial<BrowserTab>) => void;
  onVisitUrl: (url: string, title?: string) => void;
  onElementGrab?: (element: GrabbedElement) => void;
  onInspectCancel?: () => void;
}

export interface WebviewEventState {
  canGoBack: boolean;
  canGoForward: boolean;
  isSecure: boolean;
  isDomReady: boolean;
  isDevToolsOpen: boolean;
  /** Imperatively override DevTools open state (used by toggle handler). */
  setDevToolsOpen: (open: boolean) => void;
}

// ── Hook ────────────────────────────────────────────────────────────────

export function useBrowserWebviewEvents(
  webviewRef: React.RefObject<ElectronWebviewElement | null>,
  callbacks: WebviewEventCallbacks,
): WebviewEventState {
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isSecure, setIsSecure] = useState(false);
  const [isDomReady, setIsDomReady] = useState(false);
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);

  // Keep callback refs fresh so event listeners always see latest values
  const onElementGrabRef = useRef(callbacks.onElementGrab);
  onElementGrabRef.current = callbacks.onElementGrab;
  const onInspectCancelRef = useRef(callbacks.onInspectCancel);
  onInspectCancelRef.current = callbacks.onInspectCancel;

  const setDevToolsOpen = useCallback((open: boolean) => setIsDevToolsOpen(open), []);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const { onUpdateTab, onVisitUrl } = callbacks;

    const onDidNavigate = () => {
      const currentUrl = wv.getURL();
      const currentTitle = wv.getTitle() || currentUrl;
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
      setIsSecure(currentUrl.startsWith("https://"));
      onUpdateTab({ url: currentUrl, title: currentTitle, isLoading: false });
      onVisitUrl(currentUrl, currentTitle);
      // Navigation destroys injected scripts -- reset inspect mode
      onInspectCancelRef.current?.();
    };

    const onDidStartLoading = () => {
      setIsDomReady(false);
      onUpdateTab({ isLoading: true });
    };

    const onDidStopLoading = () => {
      const currentUrl = wv.getURL();
      const currentTitle = wv.getTitle() || currentUrl;
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
      setIsSecure(currentUrl.startsWith("https://"));
      onUpdateTab({ title: currentTitle, isLoading: false });
      onVisitUrl(currentUrl, currentTitle);
    };

    const onPageTitleUpdated = (e: Event) => {
      const ev = e as WebviewTitleEvent;
      onUpdateTab({ title: ev.title });
    };

    const onDomReady = () => {
      setIsDomReady(true);
      setIsDevToolsOpen(wv.isDevToolsOpened());
    };

    const onDevToolsOpened = () => setIsDevToolsOpen(true);
    const onDevToolsClosed = () => setIsDevToolsOpen(false);

    // Listen for element grab messages from the injected inspector script
    const onConsoleMessage = (e: Event) => {
      const ev = e as WebviewConsoleEvent;
      try {
        const parsed = JSON.parse(ev.message);
        if (parsed?.[GRAB_MARKER] !== true) return;

        if (parsed.cancelled) {
          onInspectCancelRef.current?.();
          return;
        }

        if (parsed.data) {
          const element: GrabbedElement = {
            ...parsed.data,
            id: crypto.randomUUID(),
            url: wv.getURL(),
          };
          onElementGrabRef.current?.(element);
        }
      } catch {
        // Not our message -- ignore parse errors from normal console output
      }
    };

    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigate);
    wv.addEventListener("did-start-loading", onDidStartLoading);
    wv.addEventListener("did-stop-loading", onDidStopLoading);
    wv.addEventListener("page-title-updated", onPageTitleUpdated);
    wv.addEventListener("console-message", onConsoleMessage);
    wv.addEventListener("dom-ready", onDomReady);
    wv.addEventListener("devtools-opened", onDevToolsOpened);
    wv.addEventListener("devtools-closed", onDevToolsClosed);

    return () => {
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigate);
      wv.removeEventListener("did-start-loading", onDidStartLoading);
      wv.removeEventListener("did-stop-loading", onDidStopLoading);
      wv.removeEventListener("page-title-updated", onPageTitleUpdated);
      wv.removeEventListener("console-message", onConsoleMessage);
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("devtools-opened", onDevToolsOpened);
      wv.removeEventListener("devtools-closed", onDevToolsClosed);
    };
  }, [webviewRef, callbacks.onUpdateTab, callbacks.onVisitUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return { canGoBack, canGoForward, isSecure, isDomReady, isDevToolsOpen, setDevToolsOpen };
}
