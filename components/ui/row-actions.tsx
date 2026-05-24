"use client";

import * as React from "react";

import { NavIcon } from "@/components/ui/nav-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Spec 18 — RowActions overflow menu.
//
// The canonical `...` button + popover used in the rightmost column of
// every DataTable row. Consumers pass an array of `RowAction` objects;
// each renders as a menu item with optional icon + variant + disabled.
//
// Used internally by DataTable; also exported for non-table surfaces
// that need the same overflow-menu pattern.
// ---------------------------------------------------------------------------

export interface RowAction {
  label: string;
  icon?: React.ReactNode;
  /** `destructive` swaps the item to a red danger treatment. */
  variant?: "default" | "destructive";
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  /** When set, renders an external link instead of a button. */
  href?: string;
  /** Optional data-testid on the menu item button/anchor. */
  testId?: string;
}

export interface RowActionsProps {
  actions: RowAction[];
  /** Accessible label for the trigger button. */
  label?: string;
  /** Test-id for the trigger button. */
  testId?: string;
  align?: "start" | "center" | "end";
}

export function RowActions({
  actions,
  label = "Row actions",
  testId,
  align = "end",
}: RowActionsProps) {
  const [open, setOpen] = React.useState(false);

  if (actions.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={label}
        data-testid={testId}
        // Stop click propagation so a row's onRowClick handler doesn't
        // fire when the operator opens the menu.
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground",
          "transition-smooth hover:bg-muted hover:text-foreground",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          open && "bg-muted text-foreground",
        )}
      >
        <NavIcon name="ellipsis" size={16} />
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={4}
        className="w-56 p-1"
        // Stop click propagation here too so menu-item clicks don't
        // bubble to a row's onRowClick handler.
        onClick={(e) => e.stopPropagation()}
      >
        <ul role="menu" className="flex flex-col">
          {actions.map((action, idx) => {
            const isDestructive = action.variant === "destructive";
            const itemClassName = cn(
              "flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
              "transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isDestructive
                ? "text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
                : "text-foreground hover:bg-muted focus:bg-muted",
              action.disabled &&
                "cursor-not-allowed opacity-50 hover:bg-transparent focus:bg-transparent",
            );
            const content = (
              <>
                {action.icon && (
                  <span className="text-muted-foreground" aria-hidden>
                    {action.icon}
                  </span>
                )}
                <span>{action.label}</span>
              </>
            );
            return (
              <li key={idx} role="none">
                {action.href ? (
                  <a
                    role="menuitem"
                    href={action.href}
                    aria-disabled={action.disabled || undefined}
                    data-testid={action.testId}
                    onClick={(e) => {
                      if (action.disabled) {
                        e.preventDefault();
                        return;
                      }
                      setOpen(false);
                    }}
                    className={itemClassName}
                  >
                    {content}
                  </a>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={action.disabled}
                    data-testid={action.testId}
                    onClick={() => {
                      if (action.disabled) return;
                      setOpen(false);
                      void action.onClick();
                    }}
                    className={cn(itemClassName, "w-full text-left")}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
