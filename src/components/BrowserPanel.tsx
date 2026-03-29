import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type FormEvent } from "react";
import type { GrabbedElement } from "@/types/ui";
import { getInspectorScript, getCleanupScript, GRAB_MARKER } from "@/lib/element-inspector";
import { capture } from "@/lib/analytics";

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
  executeJavaScript(code: string): Promise<unknown>;
}

import {
  Globe,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X as XIcon,
  Lock,
  Loader2,
  Crosshair,
  Eye,
  Sparkles,
  Search,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TabBar } from "@/components/TabBar";

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  label: string;
  isLoading: boolean;
  isStartPage?: boolean;
}

interface BrowserHistoryEntry {
  url: string;
  title: string;
}

interface BrowserPanelProps {
  onElementGrab?: (element: GrabbedElement) => void;
}

const BROWSER_HISTORY_KEY = "harnss-browser-history";
const MAX_BROWSER_HISTORY = 100;

function normalizeHistoryUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

function normalizeHistoryTitle(raw: string | undefined, url: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > 0) return trimmed;
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

function resolveNavigationInput(input: string): string | null {
  let url = input.trim();
  if (!url) return null;

  // If it looks like a URL, add protocol
  if (/^[\w-]+(\.[\w-]+)+/.test(url) && !url.includes(" ")) {
    url = `https://${url}`;
  } else if (!url.startsWith("http://") && !url.startsWith("https://")) {
    // Treat as search query
    url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }

  return url;
}

const BrowserHeaderIcon = forwardRef<SVGSVGElement, React.ComponentPropsWithoutRef<typeof Globe>>(
  ({ className, ...rest }, ref) => (
    <Globe ref={ref} {...rest} className={`${className ?? ""} text-sky-600/70 dark:text-sky-200/50`} />
  ),
);

export const BrowserPanel = memo(function BrowserPanel({ onElementGrab }: BrowserPanelProps) {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [inspectMode, setInspectMode] = useState(false);
  const [emptyInput, setEmptyInput] = useState("");
  const [showEmptySuggestions, setShowEmptySuggestions] = useState(false);
  const [history, setHistory] = useState<BrowserHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(BROWSER_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const normalized: BrowserHistoryEntry[] = [];
      for (const item of parsed) {
        if (typeof item === "string") {
          const url = normalizeHistoryUrl(item);
          if (!url) continue;
          normalized.push({ url, title: normalizeHistoryTitle(undefined, url) });
          continue;
        }
        if (item && typeof item === "object") {
          const rec = item as { url?: unknown; title?: unknown };
          const url = typeof rec.url === "string" ? normalizeHistoryUrl(rec.url) : null;
          if (!url) continue;
          const title = normalizeHistoryTitle(typeof rec.title === "string" ? rec.title : undefined, url);
          normalized.push({ url, title });
        }
      }
      return normalized.slice(0, MAX_BROWSER_HISTORY);
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(BROWSER_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_BROWSER_HISTORY)));
    } catch {
      /* ignore localStorage errors */
    }
  }, [history]);

  const addHistoryEntry = useCallback((raw: string, title?: string) => {
    const normalized = normalizeHistoryUrl(raw);
    if (!normalized) return;
    const resolvedTitle = normalizeHistoryTitle(title, normalized);
    setHistory((prev) => {
      const deduped = prev.filter((entry) => entry.url !== normalized);
      return [{ url: normalized, title: resolvedTitle }, ...deduped].slice(0, MAX_BROWSER_HISTORY);
    });
  }, []);

  const createTab = useCallback((url?: string) => {
    const isStartPage = !url;
    const tab: BrowserTab = {
      id: crypto.randomUUID(),
      url: url ?? "",
      title: "New Tab",
      label: "New Tab",
      isLoading: !isStartPage,
      isStartPage,
    };
    setTabs((prev) => [...prev, tab]);
    capture("browser_tab_created");
    setActiveTabId(tab.id);
  }, []);

  const openFirstTab = useCallback((value?: string) => {
    const source = value ?? emptyInput;
    const resolved = resolveNavigationInput(source);
    if (!resolved) return;
    createTab(resolved);
    setEmptyInput("");
    setShowEmptySuggestions(false);
  }, [createTab, emptyInput]);

  const openTabFromStartPage = useCallback((tabId: string, input: string) => {
    const resolved = resolveNavigationInput(input);
    if (!resolved) return false;
    setTabs((prev) => prev.map((tab) => (tab.id === tabId
      ? { ...tab, url: resolved, isLoading: true, isStartPage: false }
      : tab)));
    return true;
  }, []);

  const emptyFilteredHistory = useMemo(() => {
    const query = emptyInput.trim().toLowerCase();
    if (!query) return history.slice(0, 8);
    return history
      .filter((entry) =>
        entry.url.toLowerCase().includes(query) || entry.title.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [history, emptyInput]);

  const emptyCompletion = useMemo(() => {
    const query = emptyInput.trim().toLowerCase();
    if (!query) return undefined;
    return history.find((entry) => {
      const lower = entry.url.toLowerCase();
      return lower.startsWith(query) && lower !== query;
    })?.url;
  }, [history, emptyInput]);

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
        headerIcon={BrowserHeaderIcon}
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

      {/* Webview content */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 flex flex-col ${tab.id === activeTabId ? "visible" : "invisible"}`}
          >
            {tab.isStartPage ? (
              <BrowserStartPage
                input={emptyInput}
                setInput={setEmptyInput}
                showSuggestions={showEmptySuggestions}
                setShowSuggestions={setShowEmptySuggestions}
                filteredHistory={emptyFilteredHistory}
                completion={emptyCompletion}
                onOpen={(value) => {
                  const opened = openTabFromStartPage(tab.id, value);
                  if (opened) {
                    setEmptyInput("");
                    setShowEmptySuggestions(false);
                  }
                }}
                recentHistory={history.slice(0, 6)}
              />
            ) : (
              <WebviewInstance
                tab={tab}
                onUpdateTab={(updates) => updateTab(tab.id, updates)}
                onNavigate={(url) => updateTab(tab.id, { url, isLoading: true, isStartPage: false })}
                history={history}
                onVisitUrl={addHistoryEntry}
                inspectMode={inspectMode && tab.id === activeTabId}
                onToggleInspect={() => setInspectMode((prev) => !prev)}
                onElementGrab={(element) => {
                  setInspectMode(false); // One-shot: auto-disable after grab
                  onElementGrab?.(element);
                }}
                onInspectCancel={() => setInspectMode(false)}
              />
            )}
          </div>
        ))}
        {tabs.length === 0 && (
          <BrowserStartPage
            input={emptyInput}
            setInput={setEmptyInput}
            showSuggestions={showEmptySuggestions}
            setShowSuggestions={setShowEmptySuggestions}
            filteredHistory={emptyFilteredHistory}
            completion={emptyCompletion}
            onOpen={(value) => openFirstTab(value)}
            recentHistory={history.slice(0, 6)}
          />
        )}
      </div>
    </div>
  );
});

function BrowserStartPage({
  input,
  setInput,
  showSuggestions,
  setShowSuggestions,
  filteredHistory,
  completion,
  onOpen,
  recentHistory,
}: {
  input: string;
  setInput: (value: string) => void;
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  filteredHistory: BrowserHistoryEntry[];
  completion?: string;
  onOpen: (value: string) => void;
  recentHistory: BrowserHistoryEntry[];
}) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="relative flex h-full items-center justify-center overflow-y-auto overflow-x-hidden px-6">
      {/* Atmospheric ambient glow — breathes on focus */}
      <div
        className="pointer-events-none absolute top-[38%] left-1/2 h-[280px] w-[420px] rounded-full bg-blue-500/[0.03] blur-[100px] dark:bg-blue-400/[0.05]"
        style={{
          opacity: isFocused ? 1 : 0.3,
          transform: `translate(-50%, -50%) scale(${isFocused ? 1.15 : 1})`,
          transition: "opacity 800ms cubic-bezier(0.4, 0, 0.2, 1), transform 800ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onOpen(input);
        }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="flex flex-col items-center gap-7">
          {/* Hero — icon + title */}
          <div className="flex flex-col items-center gap-3.5">
            <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.025] p-3.5">
              <Globe className="h-6 w-6 text-foreground/30" />
            </div>
            <div className="text-center">
              <h2 className="text-[15px] font-semibold tracking-tight text-foreground/80">
                Browse the web
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-foreground/35">
                Preview, inspect, and grab elements into your conversation
              </p>
            </div>
          </div>

          {/* Search bar — hero element with glow border */}
          <div className="relative w-full">
            {/* Gradient glow ring — visible on focus */}
            <div
              className="absolute -inset-px rounded-xl bg-gradient-to-r from-blue-500/20 via-indigo-400/15 to-blue-500/20 blur-[1px]"
              style={{
                opacity: isFocused ? 1 : 0,
                transition: "opacity 500ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />

            <div className="relative flex items-center gap-2.5 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-3.5 py-2.5 transition-all duration-300 focus-within:border-foreground/[0.14] focus-within:bg-foreground/[0.04]">
              <Search className="h-4 w-4 shrink-0 text-foreground/25" />

              <div className="relative min-w-0 flex-1">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onFocus={() => {
                    setIsFocused(true);
                    setShowSuggestions(true);
                  }}
                  onBlur={() => {
                    setIsFocused(false);
                    window.setTimeout(() => setShowSuggestions(false), 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setShowSuggestions(false);
                      (e.target as HTMLInputElement).blur();
                      return;
                    }
                    if (e.key === "Tab" && completion) {
                      e.preventDefault();
                      setInput(completion);
                    }
                  }}
                  className="w-full bg-transparent text-sm text-foreground/80 outline-none placeholder:text-foreground/20"
                  placeholder="Search or enter URL…"
                  spellCheck={false}
                  autoFocus
                />
                {/* Ghost text completion overlay */}
                {completion && input.trim() && (
                  <div className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-sm">
                    <span className="invisible whitespace-pre">{input}</span>
                    <span className="text-foreground/[0.12]">{completion.slice(input.length)}</span>
                  </div>
                )}
              </div>

              {/* Tab hint */}
              {completion && input.trim() && (
                <kbd className="shrink-0 rounded border border-foreground/[0.08] bg-foreground/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-foreground/25">
                  Tab
                </kbd>
              )}

              {/* Go button — appears when input has content */}
              {input.trim() && (
                <button
                  type="submit"
                  className="shrink-0 rounded-lg bg-foreground/[0.06] p-1.5 text-foreground/35 transition-colors hover:bg-foreground/[0.12] hover:text-foreground/60"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* URL suggestions dropdown */}
            {showSuggestions && filteredHistory.length > 0 && (
              <div className="absolute inset-x-0 top-[calc(100%+6px)] z-20 max-h-52 overflow-y-auto rounded-xl border border-foreground/[0.08] bg-background/95 py-1.5 shadow-lg backdrop-blur-sm">
                {filteredHistory.map((entry) => (
                  <button
                    key={entry.url}
                    type="button"
                    className="flex w-full items-center gap-2.5 px-3.5 py-1.5 text-start transition-colors hover:bg-foreground/[0.04]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setInput(entry.url);
                      setShowSuggestions(false);
                      onOpen(entry.url);
                    }}
                  >
                    <Globe className="h-3 w-3 shrink-0 text-foreground/20" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-foreground/70">{entry.title}</div>
                      <div className="truncate text-[11px] text-foreground/25">{entry.url}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Feature indicators — minimal horizontal list, wraps at narrow widths */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-foreground/30">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Eye className="h-3 w-3 shrink-0" />
              Preview
            </span>
            <span className="h-3 w-px bg-foreground/[0.08]" />
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Crosshair className="h-3 w-3 shrink-0" />
              Inspect
            </span>
            <span className="h-3 w-px bg-foreground/[0.08]" />
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Sparkles className="h-3 w-3 shrink-0" />
              Use in chat
            </span>
          </div>

          {/* Recent sites — letter avatars with hover arrows */}
          {recentHistory.length > 0 && (
            <div className="w-full pt-1">
              <div className="mb-2.5 flex items-center gap-3">
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-foreground/25">
                  Recent
                </span>
                <div className="h-px flex-1 bg-foreground/[0.05]" />
              </div>
              <div className="grid gap-0.5 sm:grid-cols-2">
                {recentHistory.map((entry) => {
                  let hostname = entry.url;
                  let letter = "?";
                  try {
                    hostname = new URL(entry.url).hostname.replace(/^www\./, "");
                    letter = hostname.charAt(0).toUpperCase();
                  } catch {
                    /* keep defaults */
                  }
                  return (
                    <button
                      key={`recent-${entry.url}`}
                      type="button"
                      className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-foreground/[0.035]"
                      onClick={() => onOpen(entry.url)}
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground/[0.05] text-[11px] font-semibold text-foreground/30 transition-colors group-hover:bg-foreground/[0.08] group-hover:text-foreground/50">
                        {letter}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-foreground/60 transition-colors group-hover:text-foreground/80">
                          {entry.title}
                        </div>
                        <div className="truncate text-[10px] text-foreground/20">
                          {hostname}
                        </div>
                      </div>
                      <ArrowUpRight className="h-3 w-3 shrink-0 text-foreground/0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground/25" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

function WebviewInstance({
  tab,
  onUpdateTab,
  onNavigate,
  history,
  onVisitUrl,
  inspectMode,
  onToggleInspect,
  onElementGrab,
  onInspectCancel,
}: {
  tab: BrowserTab;
  onUpdateTab: (updates: Partial<BrowserTab>) => void;
  onNavigate: (url: string) => void;
  history: BrowserHistoryEntry[];
  onVisitUrl: (url: string, title?: string) => void;
  inspectMode?: boolean;
  onToggleInspect?: () => void;
  onElementGrab?: (element: GrabbedElement) => void;
  onInspectCancel?: () => void;
}) {
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const [urlInput, setUrlInput] = useState(tab.url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isSecure, setIsSecure] = useState(false);
  const [isDomReady, setIsDomReady] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

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

  // Sync URL input when tab url changes externally
  useEffect(() => {
    setUrlInput(tab.url);
  }, [tab.url]);

  // Keep callback refs fresh so the console-message listener always sees latest
  const onElementGrabRef = useRef(onElementGrab);
  onElementGrabRef.current = onElementGrab;
  const onInspectCancelRef = useRef(onInspectCancel);
  onInspectCancelRef.current = onInspectCancel;

  // Attach webview event listeners
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onDidNavigate = () => {
      const currentUrl = wv.getURL();
      const currentTitle = wv.getTitle() || currentUrl;
      setUrlInput(currentUrl);
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
      setIsSecure(currentUrl.startsWith("https://"));
      onUpdateTab({ url: currentUrl, title: currentTitle, isLoading: false });
      onVisitUrl(currentUrl, currentTitle);
      // Navigation destroys injected scripts — reset inspect mode
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
      const ev = e as CustomEvent & { title: string };
      onUpdateTab({ title: ev.title });
    };
    const onDomReady = () => {
      setIsDomReady(true);
    };

    // Listen for element grab messages from the injected inspector script
    const onConsoleMessage = (e: Event) => {
      const ev = e as Event & { message: string; level: number };
      try {
        const parsed = JSON.parse(ev.message);
        if (parsed?.[GRAB_MARKER] !== true) return;

        if (parsed.cancelled) {
          onInspectCancelRef.current?.();
          return;
        }

        if (parsed.data) {
          // Spread page-controlled data first so our id/url can't be overridden
          const element: GrabbedElement = {
            ...parsed.data,
            id: crypto.randomUUID(),
            url: wv.getURL(),
          };
          onElementGrabRef.current?.(element);
        }
      } catch {
        // Not our message — ignore parse errors from normal console output
      }
    };

    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigate);
    wv.addEventListener("did-start-loading", onDidStartLoading);
    wv.addEventListener("did-stop-loading", onDidStopLoading);
    wv.addEventListener("page-title-updated", onPageTitleUpdated);
    wv.addEventListener("console-message", onConsoleMessage);
    wv.addEventListener("dom-ready", onDomReady);

    return () => {
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigate);
      wv.removeEventListener("did-start-loading", onDidStartLoading);
      wv.removeEventListener("did-stop-loading", onDidStopLoading);
      wv.removeEventListener("page-title-updated", onPageTitleUpdated);
      wv.removeEventListener("console-message", onConsoleMessage);
      wv.removeEventListener("dom-ready", onDomReady);
    };
  }, [onUpdateTab, onVisitUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Inject or clean up the inspector script when inspect mode changes
  useEffect(() => {
    if (inspectMode) {
      const ok = withWebview((wv) => {
        wv.executeJavaScript(getInspectorScript()).catch(() => {
          // Webview may be in transient state during navigation — ignore.
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

  const canNavigateControls = isDomReady;
  const filteredHistory = useMemo(() => {
    const query = urlInput.trim().toLowerCase();
    if (!query) return history.slice(0, 8);
    return history
      .filter((entry) =>
        entry.url.toLowerCase().includes(query) || entry.title.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [history, urlInput]);
  const completion = useMemo(() => {
    const query = urlInput.trim().toLowerCase();
    if (!query) return undefined;
    return history.find((entry) => {
      const lower = entry.url.toLowerCase();
      return lower.startsWith(query) && lower !== query;
    })?.url;
  }, [history, urlInput]);

  const navigateTo = useCallback(
    (input: string) => {
      const url = resolveNavigationInput(input);
      if (!url) return;

      setUrlInput(url);
      onNavigate(url);
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
      setShowSuggestions(false);
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key === "Tab" && completion) {
      e.preventDefault();
      setUrlInput(completion);
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
          onClick={handleGoBack}
          disabled={!canNavigateControls || !canGoBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-foreground/30 hover:text-foreground/60 disabled:opacity-20"
          onClick={handleGoForward}
          disabled={!canNavigateControls || !canGoForward}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-foreground/30 hover:text-foreground/60"
          onClick={handleReloadOrStop}
          disabled={!canNavigateControls}
        >
          {tab.isLoading ? (
            <XIcon className="h-3.5 w-3.5" />
          ) : (
            <RotateCw className="h-3 w-3" />
          )}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 shrink-0 ${
                inspectMode
                  ? "text-blue-400 bg-blue-500/10 hover:text-blue-300"
                  : "text-foreground/30 hover:text-foreground/60"
              }`}
              onClick={onToggleInspect}
              disabled={!canNavigateControls}
            >
              <Crosshair className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {inspectMode ? "Cancel inspect" : "Grab element"}
          </TooltipContent>
        </Tooltip>

        {/* URL bar */}
        <form onSubmit={handleSubmit} className="relative min-w-0 flex-1">
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
              onFocus={(e) => {
                e.target.select();
                setShowSuggestions(true);
              }}
              onBlur={() => {
                window.setTimeout(() => setShowSuggestions(false), 120);
              }}
              className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground/70 outline-none placeholder:text-foreground/20"
              placeholder="Search or enter URL"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {showSuggestions && filteredHistory.length > 0 && (
            <div className="absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-52 overflow-y-auto rounded-md border border-foreground/[0.08] bg-background py-1 shadow-lg">
              {filteredHistory.map((entry) => (
                <button
                  key={entry.url}
                  type="button"
                  className="block w-full px-2.5 py-1.5 text-start hover:bg-foreground/[0.05]"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setUrlInput(entry.url);
                    setShowSuggestions(false);
                    navigateTo(entry.url);
                  }}
                >
                  <div className="truncate text-xs text-foreground/80">{entry.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{entry.url}</div>
                </button>
              ))}
            </div>
          )}
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
