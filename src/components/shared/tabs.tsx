"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  /** Stable key, also used in the tab and panel element ids. */
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Accessible tabs (WAI-ARIA tabs pattern, automatic activation).
 *
 * Every panel is rendered into the HTML: the inactive ones carry the `hidden`
 * attribute rather than being left out, so the whole page stays crawlable and
 * readable without JavaScript's help finding it. Arrow keys move between tabs,
 * Home/End jump to the ends, and only the selected tab is in the tab order.
 */
export function Tabs({ tabs, label, className }: { tabs: TabItem[]; label: string; className?: string }) {
  const base = useId();
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    setActive(next);
    buttons.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      select(moves[e.key]);
    }
  };

  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto border-b border-border/60 [scrollbar-width:none]"
      >
        {tabs.map((tab, i) => {
          const selected = i === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={selected}
              aria-controls={panelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "-mb-px min-h-11 shrink-0 rounded-t-md border-b-2 px-3 text-sm font-semibold tracking-wide whitespace-nowrap uppercase outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/60 sm:px-4",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={panelId(tab.id)}
          aria-labelledby={tabId(tab.id)}
          hidden={i !== active}
          tabIndex={0}
          className="pt-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
