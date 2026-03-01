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
  inactiveClass = "text-foreground/45 hover:text-foreground/65 hover:bg-foreground/[0.04]",
}: TabBarProps<T>) {
  return (
    <div className="flex items-center gap-1 px-2 pt-2 pb-1">
      <div className="flex items-center gap-1.5 ps-1.5">
        <HeaderIcon className="h-3.5 w-3.5 text-foreground/50" />
        <span className="text-xs font-medium text-foreground/60">{headerLabel}</span>
      </div>

      <div className="ms-2 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectTab(tab.id)}
            className={`group flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors cursor-pointer ${
              tab.id === activeTabId ? activeClass : inactiveClass
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
          </button>
        ))}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 text-foreground/40 hover:text-foreground/70"
        onClick={onNewTab}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
