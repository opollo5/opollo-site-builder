"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Callout — D-10. Banner-shape alert variant for the composer + dashboard.
// Variants: info (blue tint), warning (amber), helpful (yellow / brand).
// ---------------------------------------------------------------------------

export interface CalloutProps {
  variant?: "info" | "warning" | "helpful";
  icon?: React.ReactNode;
  title: string;
  body?: string;
  cta?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  className?: string;
}

const VARIANT_STYLES: Record<NonNullable<CalloutProps["variant"]>, string> = {
  info:    "bg-info-bg border-info-border text-info-fg",
  warning: "bg-warning-bg border-warning-border text-warning-fg",
  helpful: "bg-warning-bg border-warning-border text-warning-fg",
};

export function Callout({
  variant = "info",
  icon,
  title,
  body,
  cta,
  onDismiss,
  className,
}: CalloutProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4",
        VARIANT_STYLES[variant],
        className,
      )}
    >
      {icon && <div className="mt-0.5 shrink-0 text-lg leading-none">{icon}</div>}
      <div className="flex-1 space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {body && <p className="text-sm opacity-80">{body}</p>}
        {cta && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-sm font-medium underline"
            onClick={cta.onClick}
          >
            {cta.label}
          </Button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="shrink-0 text-current opacity-50 hover:opacity-100 transition-opacity"
        >
          ×
        </button>
      )}
    </div>
  );
}
