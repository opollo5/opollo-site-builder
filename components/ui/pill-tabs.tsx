"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// PillTabs — pill-shaped tab group.
//
// Spec:
//   Active:   bg-[#00e5a0], white text, rounded-full
//   Inactive: transparent bg, text-[#4B5563], rounded-full, hover bg-[#F3F4F6]
//   No borders on individual tabs.
//
// Each tab renders as a <Link> when `href` is supplied (navigation tabs)
// or as a <button> otherwise (state-driven tabs). Disabled tabs render
// as a non-interactive span.
// ---------------------------------------------------------------------------

export interface PillTab {
  label: string;
  value: string;
  /** When set, the tab renders as a Next.js <Link> instead of a <button>. */
  href?: string;
  disabled?: boolean;
}

export interface PillTabsProps {
  tabs: readonly PillTab[];
  activeValue: string;
  /** Called when a button-mode tab is selected. Not needed for href-based tabs. */
  onSelect?: (value: string) => void;
  className?: string;
}

const TAB_BASE =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap";

const TAB_ACTIVE = "bg-[var(--tab-active-bg)] text-[var(--tab-active-text)]";

const TAB_INACTIVE =
  "bg-transparent text-[var(--tab-inactive-text)] hover:bg-[var(--icon-control-hover)] hover:text-[var(--tx-primary)]";

const TAB_DISABLED = "bg-transparent text-[var(--tx-muted)] cursor-not-allowed";

export function PillTabs({ tabs, activeValue, onSelect, className }: PillTabsProps) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {tabs.map((tab) => {
        const isActive = tab.value === activeValue;
        const tabClass = cn(
          TAB_BASE,
          isActive ? TAB_ACTIVE : tab.disabled ? TAB_DISABLED : TAB_INACTIVE,
        );

        if (tab.disabled) {
          return (
            <span
              key={tab.value}
              role="tab"
              aria-selected={false}
              aria-disabled
              className={tabClass}
            >
              {tab.label}
            </span>
          );
        }

        if (tab.href) {
          return (
            <Link
              key={tab.value}
              href={tab.href}
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? "page" : undefined}
              className={tabClass}
            >
              {tab.label}
            </Link>
          );
        }

        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect?.(tab.value)}
            className={tabClass}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
