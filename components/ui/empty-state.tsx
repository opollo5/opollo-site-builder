import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A-6 — EmptyState primitive.
//
// Replaces three drifting variants in the codebase today:
//
//   • <div className="rounded-md border border-dashed p-8 text-center">
//   • <div className="rounded-md border border-muted-foreground/20 bg-muted/20 p-6">
//   • <div className="rounded-md border p-8 text-center">
//
// Linear / Vercel pattern: every empty list has an icon, a title, a
// one-sentence body that names the next action, and a primary CTA.
// "Operator-specific microcopy" is part of the polish brief — generic
// "no items yet" copy is not allowed; the consumer always passes
// surface-specific body text.
//
// Compositional: cta is a slot so the consumer can pass a Button, a
// Link, or a custom action group. Keeping it un-typed (ReactNode)
// avoids forcing the consumer through a Button-only API.
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  icon: LucideIcon;
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
  icon: Icon,
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
        <Icon aria-hidden className="h-5 w-5" />
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
