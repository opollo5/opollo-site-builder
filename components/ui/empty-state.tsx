import * as React from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A-6 — EmptyState primitive.
//
// Linear / Vercel pattern: every empty list has an icon, a title, a
// one-sentence body that names the next action, and a primary CTA.
//
// Icon is a ReactNode slot — pass `<NavIcon name="..." size={20} />`
// (or any other element). Compositional so the primitive doesn't have
// to know about a specific icon library.
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  icon: React.ReactNode;
  /** Accessible name for the icon. Defaults to "Empty". */
  iconLabel?: string;
  title: string;
  body: React.ReactNode;
  /** Optional primary action — usually a Button, Link, or both. */
  cta?: React.ReactNode;
  /** Visual density. Default = standard list empty (p-8); compact = sidebar / inline (p-6). */
  density?: "default" | "compact";
  className?: string;
}

const DENSITY_PADDING = {
  default: "p-8",
  compact: "p-6",
} as const;

export function EmptyState({
  icon,
  iconLabel = "Empty",
  title,
  body,
  cta,
  density = "default",
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-label={iconLabel}
      className={cn(
        "flex flex-col items-center gap-3 rounded-md border border-dashed bg-muted/20 text-center",
        DENSITY_PADDING[density],
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="mt-1 max-w-md text-sm text-muted-foreground">
          {body}
        </div>
      </div>
      {cta && <div className="mt-1 flex items-center gap-2">{cta}</div>}
    </div>
  );
}
