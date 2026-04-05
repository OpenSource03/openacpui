/**
 * Tab-based browser panel orchestrator.
 *
 * Manages tab CRUD, history persistence, and session persistence.
 * Visual rendering is delegated to sub-components in `./browser/`.
 */

import { forwardRef, useCallback, useEffect, useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import type { GrabbedElement } from "@/types";
import { capture } from "@/lib/analytics/analytics";
import { TabBar } from "@/components/TabBar";
import type { BrowserTab } from "./browser/browser-types";
import { MAX_BROWSER_HISTORY } from "./browser/browser-types";
import {
  getDefaultBrowserColorScheme,
  normalizeHistoryUrl,
  normalizeHistoryTitle,
  readBrowserHistory,
  readBrowserSession,
  reorderTabsById,
  resolveNavigationInput,
  writeBrowserHistory,
  writeBrowserSession,
} from "./browser/browser-utils";
import { BrowserStartPage } from "./browser/BrowserStartPage";
import { WebviewInstance } from "./browser/WebviewInstance";

// ── Props ───────────────────────────────────────────────────────────────

interface BrowserPanelProps {
  persistKey: string;
  onElementGrab?: (element: GrabbedElement) => void;
  headerControls?: React.ReactNode;
}

// ── Header icon ─────────────────────────────────────────────────────────

const BrowserHeaderIcon = forwardRef<SVGSVGElement, React.ComponentPropsWithoutRef<typeof Globe>>(
  ({ className, ...rest }, ref) => (
    <Globe ref={ref} {...rest} className={`${className ?? ""} text-sky-600/70 dark:text-sky-200/50`} />
  ),
);

// ── Component ───────────────────────────────────────────────────────────

export function BrowserPanel({ persistKey, onElementGrab, headerControls }: BrowserPanelProps) {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => readBrowserSession(persistKey).tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(() => readBrowserSession(persistKey).activeTabId);
  const [inspectMode, setInspectMode] = useState(false);
  const [emptyInput, setEmptyInput] = useState("");
  const [showEmptySuggestions, setShowEmptySuggestions] = useState(false);
  const [history, setHistory] = useState(readBrowserHistory);

  // ── Persistence effects ─────────────────────────────────────────────

  useEffect(() => {
    writeBrowserHistory(history);
  }, [history]);

  useEffect(() => {
    const session = readBrowserSession(persistKey);
    setTabs(session.tabs);
    setActiveTabId(session.activeTabId);
    setInspectMode(false);
    setEmptyInput("");
    setShowEmptySuggestions(false);
  }, [persistKey]);

  useEffect(() => {
    writeBrowserSession(persistKey, tabs, activeTabId);
  }, [activeTabId, persistKey, tabs]);

  // ── History management ──────────────────────────────────────────────

  const addHistoryEntry = useCallback((raw: string, title?: string) => {
    const normalized = normalizeHistoryUrl(raw);
    if (!normalized) return;
    const resolvedTitle = normalizeHistoryTitle(title, normalized);
    setHistory((prev) => {
      const deduped = prev.filter((entry) => entry.url !== normalized);
      return [{ url: normalized, title: resolvedTitle }, ...deduped].slice(0, MAX_BROWSER_HISTORY);
    });
  }, []);

  // ── Tab management ──────────────────────────────────────────────────

  const createTab = useCallback((url?: string) => {
    const isStartPage = !url;
    const tab: BrowserTab = {
      id: crypto.randomUUID(),
      url: url ?? "",
      title: "New Tab",
      label: "New Tab",
      isLoading: !isStartPage,
      colorScheme: getDefaultBrowserColorScheme(),
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
      merged.label = merged.title || "New Tab";
      return merged;
    }));
  }, []);

  const reorderTabs = useCallback((fromTabId: string, toTabId: string) => {
    setTabs((prev) => reorderTabsById(prev, fromTabId, toTabId));
  }, []);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
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
        onReorderTabs={reorderTabs}
        headerActions={headerControls}
      />

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
                history={history}
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
                  setInspectMode(false);
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
            history={history}
            onOpen={(value) => openFirstTab(value)}
            recentHistory={history.slice(0, 6)}
          />
        )}
      </div>
    </div>
  );
}
