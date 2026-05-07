import * as React from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Spec 18 — TableCell typographic helpers.
//
// Drop-in cell content components that enforce the spec's text rules:
//
//   Primary    — body color, weight 500 (the headline cell — site name,
//                user email, image title)
//   Secondary  — muted color, 13px (timestamps, secondary metadata)
//   Mono       — monospace 13px (slugs, IDs, URLs, dimensions)
//   Stack      — Primary line + Secondary line stacked vertically
//                (the "Test Site 2 / never tested" pattern)
//
// Composable inside a `cell: (row) => ...` callback; consumers don't
// need to know the exact Tailwind classes.
// ---------------------------------------------------------------------------

export interface TextCellProps {
  className?: string;
  children: React.ReactNode;
}

function Primary({ className, children }: TextCellProps) {
  return (
    <span className={cn("text-sm font-medium text-foreground", className)}>
      {children}
    </span>
  );
}

function Secondary({ className, children }: TextCellProps) {
  return (
    <span
      className={cn(
        "text-[13px] leading-tight text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Mono({ className, children }: TextCellProps) {
  return (
    <code
      className={cn(
        "font-mono text-[13px] text-foreground",
        // Reset code's default browser background so it sits flush in a
        // cell. Consumers who want a chip-shaped mono cell apply
        // bg-muted themselves.
        "bg-transparent p-0",
        className,
      )}
    >
      {children}
    </code>
  );
}

interface StackProps {
  /** Primary (top) line. Always rendered. */
  primary: React.ReactNode;
  /** Secondary (bottom) line. When falsy, only the primary renders. */
  secondary?: React.ReactNode;
  className?: string;
}

function Stack({ primary, secondary, className }: StackProps) {
  return (
    <span className={cn("flex flex-col gap-0.5", className)}>
      <Primary>{primary}</Primary>
      {secondary && <Secondary>{secondary}</Secondary>}
    </span>
  );
}

/**
 * Em-dash placeholder for empty cells. Spec 18: "Empty cells: em-dash —
 * in muted color. Never blank."
 */
function Empty() {
  return <span className="text-sm text-muted-foreground">—</span>;
}

export const TableCell = {
  Primary,
  Secondary,
  Mono,
  Stack,
  Empty,
};
