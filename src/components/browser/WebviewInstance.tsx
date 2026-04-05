/**
 * Manages a single Electron webview tab: navigation, color scheme,
 * element inspection, and the webview element itself.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GrabbedElement } from "@/types";
import { getInspectorScript, getCleanupScript } from "@/lib/element-inspector";
import { reportError } from "@/lib/analytics/analytics";
import { useBrowserWebviewEvents } from "@/hooks/useBrowserWebviewEvents";
import type { BrowserHistoryEntry, BrowserTab, ElectronWebviewElement } from "./browser-types";
import { resolveNavigationInput } from "./browser-utils";
import { BrowserNavBar } from "./BrowserNavBar";

// ── Props ───────────────────────────────────────────────────────────────

interface WebviewInstanceProps {
  tab: BrowserTab;
  onUpdateTab: (updates: Partial<BrowserTab>) => void;
  onNavigate: (url: string) => void;
  history: BrowserHistoryEntry[];
  onVisitUrl: (url: string, title?: string) => void;
  inspectMode?: boolean;
  onToggleInspect?: () => void;
  onElementGrab?: (element: GrabbedElement) => void;
  onInspectCancel?: () => void;
}

// ── Component ───────────────────────────────────────────────────────────

export function WebviewInstance({
  tab,
  onUpdateTab,
  onNavigate,
  history,
  onVisitUrl,
  inspectMode,
  onToggleInspect,
  onElementGrab,
  onInspectCancel,
}: WebviewInstanceProps) {
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const [urlInput, setUrlInput] = useState(tab.url);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // ── Webview event state ─────────────────────────────────────────────

  const { canGoBack, canGoForward, isSecure, isDomReady, isDevToolsOpen, setDevToolsOpen } =
    useBrowserWebviewEvents(webviewRef, {
      onUpdateTab,
      onVisitUrl,
      onElementGrab,
      onInspectCancel,
    });

  // ── Webview action helper ───────────────────────────────────────────

  const withWebview = useCallback(
    (
      action: (wv: ElectronWebviewElement) => void,
      options?: { requireDomReady?: boolean },
    ): boolean => {
      const wv = webviewRef.current;
      if (!wv) return false;
      if ((options?.requireDomReady ?? true) && !isDomReady) return false;
      action(wv);
      return true;
    },
    [isDomReady],
  );

  // ── Color scheme ────────────────────────────────────────────────────

  const applyColorScheme = useCallback(async () => {
    if (!isDomReady) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const result = await window.claude.setBrowserColorScheme(wv.getWebContentsId(), tab.colorScheme);
    if (!result.ok) {
      throw new Error(result.error ?? "Failed to apply browser color scheme");
    }
  }, [isDomReady, tab.colorScheme]);

  useEffect(() => {
    applyColorScheme().catch((err) => {
      reportError("BROWSER_COLOR_SCHEME", err, { colorScheme: tab.colorScheme });
    });
  }, [applyColorScheme, tab.colorScheme]);

  // ── Sync URL input when tab url changes externally ──────────────────

  useEffect(() => {
    setUrlInput(tab.url);
  }, [tab.url]);

  // ── Inject / clean up inspector script ──────────────────────────────

  useEffect(() => {
    if (inspectMode) {
      const ok = withWebview((wv) => {
        wv.executeJavaScript(getInspectorScript()).catch(() => {
          // Webview may be in transient state during navigation
        });
      });
      if (!ok) return;
    } else {
      const ok = withWebview((wv) => {
        wv.executeJavaScript(getCleanupScript()).catch(() => {});
      });
      if (!ok) return;
    }
  }, [inspectMode, withWebview]);

  // ── Navigation handlers ─────────────────────────────────────────────

  const handleGoBack = useCallback(() => {
    withWebview((wv) => wv.goBack());
  }, [withWebview]);

  const handleGoForward = useCallback(() => {
    withWebview((wv) => wv.goForward());
  }, [withWebview]);

  const handleReloadOrStop = useCallback(() => {
    withWebview((wv) => {
      if (tab.isLoading) {
        wv.stop();
      } else {
        wv.reload();
      }
    });
  }, [tab.isLoading, withWebview]);

  const handleToggleColorScheme = useCallback(() => {
    onUpdateTab({ colorScheme: tab.colorScheme === "dark" ? "light" : "dark" });
  }, [onUpdateTab, tab.colorScheme]);

  const handleToggleDevTools = useCallback(() => {
    withWebview((wv) => {
      if (wv.isDevToolsOpened()) {
        wv.closeDevTools();
        setDevToolsOpen(false);
        return;
      }
      wv.openDevTools({ mode: "detach", activate: true });
      setDevToolsOpen(true);
    });
  }, [withWebview, setDevToolsOpen]);

  const navigateTo = useCallback(
    (input: string) => {
      const url = resolveNavigationInput(input);
      if (!url) return;

      const currentUrl = webviewRef.current?.getURL() || tab.url;
      if (currentUrl && url === currentUrl) {
        setUrlInput(url);
        onUpdateTab({ isLoading: true });
        withWebview((wv) => wv.reload(), { requireDomReady: false });
        return;
      }

      setUrlInput(url);
      onNavigate(url);
    },
    [onNavigate, onUpdateTab, tab.url, withWebview],
  );

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      <BrowserNavBar
        urlInput={urlInput}
        onUrlInputChange={setUrlInput}
        showSuggestions={showSuggestions}
        onShowSuggestionsChange={setShowSuggestions}
        history={history}
        onNavigate={navigateTo}
        isSecure={isSecure}
        tabUrl={tab.url}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        isLoading={tab.isLoading}
        canNavigate={isDomReady}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReloadOrStop={handleReloadOrStop}
        inspectMode={inspectMode ?? false}
        onToggleInspect={onToggleInspect ?? (() => {})}
        isDevToolsOpen={isDevToolsOpen}
        onToggleDevTools={handleToggleDevTools}
        colorScheme={tab.colorScheme}
        onToggleColorScheme={handleToggleColorScheme}
      />

      {/* Loading bar */}
      {tab.isLoading && (
        <div className="h-px overflow-hidden bg-foreground/[0.06]">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500/40" />
        </div>
      )}

      {/* Webview */}
      <div className="min-h-0 flex-1">
        <webview
          ref={webviewRef as React.RefObject<ElectronWebviewElement>}
          src={tab.url}
          className="h-full w-full"
          {...({ allowpopups: "true" } as Record<string, string>)}
        />
      </div>
    </div>
  );
}
