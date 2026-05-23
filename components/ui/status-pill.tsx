import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// StatusPill — semantic status indicator using Opollo design tokens.
//
// Distinct from the generic <Pill> primitive (which wraps Badge variants).
// StatusPill uses explicit token classes so each kind maps predictably to
// the design system's semantic colour intentions.
// ---------------------------------------------------------------------------

export type StatusPillKind =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "strong_signal"
  | "early_signal"
  | "client_green"
  | "client_amber"
  | "client_red";

const KIND_CLASSES: Record<StatusPillKind, string> = {
  success: "bg-pk/20 text-tx-primary",
  warning: "bg-am/30 text-tx-primary",
  error: "bg-rd/20 text-tx-primary",
  info: "bg-bl/20 text-tx-primary",
  neutral: "bg-su-secondary text-tx-muted",
  strong_signal: "bg-pk text-tx-inverse",
  early_signal: "bg-am text-tx-primary",
  client_green: "bg-pk/20 text-tx-primary",
  client_amber: "bg-am/30 text-tx-primary",
  client_red: "bg-rd/20 text-tx-primary",
};

const DEFAULT_LABELS: Partial<Record<StatusPillKind, string>> = {
  strong_signal: "Strong signal",
  early_signal: "Early signal",
  client_green: "Green",
  client_amber: "Amber",
  client_red: "Red",
};

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  kind: StatusPillKind;
  label?: string;
}

export function StatusPill({ kind, label, className, ...props }: StatusPillProps) {
  const displayLabel = label ?? DEFAULT_LABELS[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
        KIND_CLASSES[kind],
        className,
      )}
      {...props}
    >
      {displayLabel}
    </span>
  );
}
