"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// Canonical role="menuitem" button for platform-picker and similar dropdown lists.
// Use inside a role="menu" container.

export interface MenuItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Leading element (icon, avatar, etc.) — rendered before the label. */
  icon?: React.ReactNode;
  /** Trailing element (status text, badge, arrow) — rendered after the label. */
  trailing?: React.ReactNode;
}

export function MenuItem({
  icon,
  trailing,
  className,
  children,
  ...props
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
        "transition-smooth hover:bg-muted/60 focus:bg-muted/60 focus:outline-none",
        "focus-visible:shadow-[var(--shadow-focus)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {icon && (
        <span className="flex-shrink-0 text-foreground" aria-hidden>
          {icon}
        </span>
      )}
      <span className="flex-1 font-medium">{children}</span>
      {trailing && (
        <span className="text-muted-foreground">{trailing}</span>
      )}
    </button>
  );
}
