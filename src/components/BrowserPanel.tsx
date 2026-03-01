import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type FormEvent } from "react";

// Electron webview element with navigation methods
interface ElectronWebviewElement extends HTMLElement {
  src: string;
  getURL(): string;
  getTitle(): string;
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

import {
  Globe,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X as XIcon,
  Plus,
  Lock,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabBar } from "@/components/TabBar";

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  label: string;
  isLoading: boolean;
}

export function BrowserPanel() {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const createTab = useCallback((url = "https://www.google.com") => {
    const tab: BrowserTab = {
      id: crypto.randomUUID(),
      url,
      title: "New Tab",
      label: "New Tab",
      isLoading: true,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  // Auto-create first tab
  useEffect(() => {
    if (tabs.length === 0) createTab();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const updateTab = useCallback((tabId: string, updates: Partial<BrowserTab>) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== tabId) return t;
      const merged = { ...t, ...updates };
      // Keep label in sync with title
      merged.label = merged.title || "New Tab";
      return merged;
    }));
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onNewTab={() => createTab()}
        headerIcon={Globe}
        headerLabel="Browser"
        renderTabIcon={(tab) =>
          tab.isLoading ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin opacity-50" />
          ) : (
            <Globe className="h-2.5 w-2.5 opacity-50" />
          )
        }
        tabMaxWidth="max-w-24"
        activeClass="bg-foreground/[0.08] text-foreground/80"
        inactiveClass="text-foreground/35 hover:text-foreground/55 hover:bg-foreground/[0.04]"
      />

      {/* Separator */}
      <div className="border-t border-foreground/[0.06]" />

      {/* Webview content */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 flex flex-col ${tab.id === activeTabId ? "visible" : "invisible"}`}
          >
            <WebviewInstance
              tab={tab}
              onUpdateTab={(updates) => updateTab(tab.id, updates)}
              onNavigate={(url) => updateTab(tab.id, { url, isLoading: true })}
            />
          </div>
        ))}
        {tabs.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <button
              type="button"
              onClick={() => createTab()}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-foreground/30 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/50 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              New Tab
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function WebviewInstance({
  tab,
  onUpdateTab,
  onNavigate,
}: {
  tab: BrowserTab;
  onUpdateTab: (updates: Partial<BrowserTab>) => void;
  onNavigate: (url: string) => void;
}) {
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const [urlInput, setUrlInput] = useState(tab.url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isSecure, setIsSecure] = useState(false);

  // Sync URL input when tab url changes externally
  useEffect(() => {
    setUrlInput(tab.url);
  }, [tab.url]);

  // Attach webview event listeners
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onDidNavigate = () => {
      const currentUrl = wv.getURL();
      setUrlInput(currentUrl);
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
      setIsSecure(currentUrl.startsWith("https://"));
      onUpdateTab({ url: currentUrl, title: wv.getTitle() || currentUrl, isLoading: false });
    };

    const onDidStartLoading = () => {
      onUpdateTab({ isLoading: true });
    };

    const onDidStopLoading = () => {
      const currentUrl = wv.getURL();
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
      setIsSecure(currentUrl.startsWith("https://"));
      onUpdateTab({ title: wv.getTitle() || currentUrl, isLoading: false });
    };

    const onPageTitleUpdated = (e: Event) => {
      const ev = e as CustomEvent & { title: string };
      onUpdateTab({ title: ev.title });
    };

    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigate);
    wv.addEventListener("did-start-loading", onDidStartLoading);
    wv.addEventListener("did-stop-loading", onDidStopLoading);
    wv.addEventListener("page-title-updated", onPageTitleUpdated);

    return () => {
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigate);
      wv.removeEventListener("did-start-loading", onDidStartLoading);
      wv.removeEventListener("did-stop-loading", onDidStopLoading);
      wv.removeEventListener("page-title-updated", onPageTitleUpdated);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateTo = useCallback(
    (input: string) => {
      let url = input.trim();
      if (!url) return;

      // If it looks like a URL, add protocol
      if (/^[\w-]+(\.[\w-]+)+/.test(url) && !url.includes(" ")) {
        url = `https://${url}`;
      } else if (!url.startsWith("http://") && !url.startsWith("https://")) {
        // Treat as search query
        url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
      }

      setUrlInput(url);
      onNavigate(url);
      webviewRef.current?.loadURL(url);
    },
    [onNavigate],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    navigateTo(urlInput);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setUrlInput(tab.url);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Navigation bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-foreground/30 hover:text-foreground/60 disabled:opacity-20"
          onClick={() => webviewRef.current?.goBack()}
          disabled={!canGoBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-foreground/30 hover:text-foreground/60 disabled:opacity-20"
          onClick={() => webviewRef.current?.goForward()}
          disabled={!canGoForward}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-foreground/30 hover:text-foreground/60"
          onClick={() =>
            tab.isLoading ? webviewRef.current?.stop() : webviewRef.current?.reload()
          }
        >
          {tab.isLoading ? (
            <XIcon className="h-3.5 w-3.5" />
          ) : (
            <RotateCw className="h-3 w-3" />
          )}
        </Button>

        {/* URL bar */}
        <form onSubmit={handleSubmit} className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 rounded-md bg-foreground/[0.05] px-2 py-1 transition-colors focus-within:bg-foreground/[0.08] focus-within:ring-1 focus-within:ring-foreground/[0.08]">
            {isSecure ? (
              <Lock className="h-3 w-3 shrink-0 text-emerald-500/60" />
            ) : (
              <Globe className="h-3 w-3 shrink-0 text-foreground/25" />
            )}
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground/70 outline-none placeholder:text-foreground/20"
              placeholder="Search or enter URL"
              spellCheck={false}
            />
          </div>
        </form>
      </div>

      {/* Loading bar */}
      {tab.isLoading && (
        <div className="h-px bg-foreground/[0.06] overflow-hidden">
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
