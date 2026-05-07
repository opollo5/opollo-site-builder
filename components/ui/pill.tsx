import * as React from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Spec 18 — Pill primitive.
//
// The canonical inline status / type / role indicator used by DataTable
// cells. Six variants documented in the spec:
//
//   success   — green   (e.g. Connected, Published, Active)
//   neutral   — grey    (e.g. Not Connected, Draft, Customer)
//   warning   — amber   (e.g. Scheduled, Pending review)
//   danger    — red     (e.g. Failed, Removed)
//   info      — blue    (e.g. iStock, Operator)
//   accent    — Opollo  (e.g. "Opollo internal", "super_admin")
//
// Maps to the existing Badge primitive's tones — Pill is a stable public
// API so consumers don't reach into Badge's `tone` enum directly. Keeps
// the variant vocabulary aligned with the spec rather than the legacy
// design-system mapping (success/error/primary/...).
//
// Width: padding-x 1.5 / padding-y 0.5 + text-xs = ~22px tall. Matches
// the spec's `font-size: 12px`, `padding: 4px 2px`, `border-radius: 4px`
// canonical pill geometry once the rounded-md class lands.
// ---------------------------------------------------------------------------

export type PillVariant =
  | "success"
  | "neutral"
  | "warning"
  | "danger"
  | "info"
  | "accent";

const VARIANT_TO_TONE: Record<PillVariant, NonNullable<BadgeProps["tone"]>> = {
  success: "success",
  neutral: "neutral",
  warning: "warning",
  danger: "error",
  info: "info",
  // The accent variant uses the Opollo brand accent. Map to the
  // primary tone in the existing badge palette — that's what
  // resolves to the brand green (or the active theme's primary).
  accent: "primary",
};

export interface PillProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> {
  variant?: PillVariant;
}

export const Pill = React.forwardRef<HTMLSpanElement, PillProps>(
  function Pill({ variant = "neutral", className, children, ...props }, ref) {
    const tone = VARIANT_TO_TONE[variant];
    return (
      <Badge
        ref={ref}
        tone={tone}
        density="default"
        className={cn("rounded text-xs", className)}
        {...props}
      >
        {children}
      </Badge>
    );
  },
);
