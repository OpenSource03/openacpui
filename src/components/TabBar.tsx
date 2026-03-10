/**
 * Generic tab bar used by ToolsPanel and BrowserPanel.
 * Renders a row of closeable tabs with a header icon/label and a "new tab" button.
 */

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

export interface TabBarTab {
  id: string;
  label: string;
}

interface TabBarProps<T extends TabBarTab> {
  tabs: T[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  /** Icon shown before the header label. */
  headerIcon: LucideIcon;
  /** Text label shown next to the header icon. */
  headerLabel: string;
  /** Optional per-tab icon renderer. Receives the tab and whether it's active. */
  renderTabIcon?: (tab: T) => React.ReactNode;
  /** Max width for truncated tab labels (Tailwind class like "max-w-20"). Defaults to "max-w-20". */
  tabMaxWidth?: string;
  /** Override active tab text classes. */
  activeClass?: string;
  /** Override inactive tab text classes. */
  inactiveClass?: string;
}

export function TabBar<T extends TabBarTab>({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  headerIcon: HeaderIcon,
  headerLabel,
  renderTabIcon,
  tabMaxWidth = "max-w-20",
  activeClass = "bg-foreground/[0.08] text-foreground/90",
  inactiveClass = "text-foreground/40 hover:text-foreground/60 hover:bg-foreground/[0.04]",
}: TabBarProps<T>) {
  const hasHeaderLabel = headerLabel.trim().length > 0;

  return (
    <div className="flex items-center gap-1 px-2 pt-2 pb-1">
      {/* Header icon + label */}
      <div className={`flex items-center ps-1.5 ${hasHeaderLabel ? "gap-1.5" : "gap-0"}`}>
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-foreground/[0.04]">
          <HeaderIcon className="h-3 w-3 text-foreground/45" />
        </div>
        {hasHeaderLabel && (
          <span className="text-[11px] font-semibold tracking-wide text-foreground/50 uppercase">{headerLabel}</span>
        )}
      </div>

      {/* Tabs */}
      <div className={`flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto ${hasHeaderLabel ? "ms-2" : "ms-1"}`}>
        {tabs.map((tab) => {
          const isActiveTab = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`group relative flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-150 cursor-pointer ${
                isActiveTab ? activeClass : inactiveClass
              }`}
            >
              {renderTabIcon?.(tab)}
              <span className={`truncate ${tabMaxWidth}`}>{tab.label}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }
                }}
                className="ms-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 group-hover:opacity-100"
              >
                <X className="h-2.5 w-2.5" />
              </span>
              {/* Active tab bottom indicator */}
              {isActiveTab && (
                <span className="absolute inset-x-1.5 -bottom-px h-[1.5px] rounded-full bg-foreground/30" />
              )}
            </button>
          );
        })}
      </div>

      {/* New tab button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 rounded-md text-foreground/30 transition-all duration-150 hover:bg-foreground/[0.06] hover:text-foreground/60"
        onClick={onNewTab}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
