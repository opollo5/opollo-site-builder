import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A-4 — Badge primitive.
//
// Low-level CVA-driven label component. Variants resolve to the A-2
// semantic tokens (success, warning, info, destructive) plus the
// existing primary / muted neutrals. StatusPill (sibling file) wraps
// this with semantic per-domain mapping; consumers reach for StatusPill
// 95% of the time and Badge directly only for one-off labels (image
// source category, design-system version, etc.).
//
// Density target: text-xs / py-0.5 / px-2 = ~22px tall. Linear-density.
// `density="default"` (22px) for inline rows; `density="loose"` (24px)
// for badges that sit alongside an H1 and need slightly more weight.
// ---------------------------------------------------------------------------

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded font-medium transition-smooth whitespace-nowrap",
  {
    variants: {
      tone: {
        // Tinted-bg + bold-text pattern (the canonical pill shape — see
        // A-2 documentation block).
        neutral: "bg-muted text-muted-foreground",
        primary: "bg-primary/10 text-primary",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        info: "bg-info/10 text-info",
        error: "bg-destructive/10 text-destructive",
        // Solid-fill — reserved for one-off accent rows. Avoid in
        // information-dense lists.
        "primary-solid": "bg-primary text-primary-foreground",
        "success-solid": "bg-success text-success-foreground",
        "warning-solid": "bg-warning text-warning-foreground",
        // Outline variant for tertiary labels (e.g. "v1.2.0").
        outline: "border border-border bg-transparent text-foreground",
      },
      density: {
        // ~22px tall — the default for inline badge usage in tables / lists.
        default: "px-2 py-0.5 text-xs",
        // ~24px tall — for badges adjacent to H1 / H2 headings.
        loose: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: {
      tone: "neutral",
      density: "default",
    },
  },
);

export interface BadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  function Badge({ className, tone, density, ...props }, ref) {
    return (
      <span
        ref={ref}
        className={cn(badgeVariants({ tone, density }), className)}
        {...props}
      />
    );
  },
);
