"use client";

import { useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/nav-icon";
import { celebrate } from "@/lib/celebrate";
import { useFirstTime } from "@/lib/hooks/use-first-time";
import { cn } from "@/lib/utils";

export interface SuccessMomentAction {
  label: string;
  onClick?: () => void;
  href?: string;
  external?: boolean;
}

export interface SuccessMomentProps {
  /** When set, fires celebrate() once and switches to firstTimeTitle. */
  firstTimeKey?: string;
  /** Headline shown on return visits. */
  title: string;
  /** Headline shown on the very first surface-of-key event. */
  firstTimeTitle?: string;
  subtitle?: ReactNode;
  primaryAction?: SuccessMomentAction;
  secondaryAction?: SuccessMomentAction;
  className?: string;
}

// Spec 08 — Tier 1 success moment block.
//
// Renders an above-the-fold success block. First visits with a
// firstTimeKey trigger celebrate() (subtle confetti, reduced-motion
// respecting). Subsequent visits are quiet — same block, no animation.
//
// No emojis in default copy per brief. Toast helpers handle Tier 2.
export function SuccessMoment({
  firstTimeKey,
  title,
  firstTimeTitle,
  subtitle,
  primaryAction,
  secondaryAction,
  className,
}: SuccessMomentProps) {
  const { isFirstTime, hydrated, markSeen } = useFirstTime(
    firstTimeKey ?? "__never__",
  );

  const isCelebrating = Boolean(firstTimeKey) && hydrated && isFirstTime;

  useEffect(() => {
    if (isCelebrating) {
      celebrate();
      markSeen();
    }
    // markSeen is stable per key; only fire when celebration trigger flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCelebrating]);

  const headline = isCelebrating && firstTimeTitle ? firstTimeTitle : title;

  return (
    <section
      className={cn(
        "rounded-xl border border-emerald-200 bg-emerald-50/60 p-5",
        "dark:border-emerald-900/60 dark:bg-emerald-950/30",
        isCelebrating &&
          "animate-in fade-in slide-in-from-top-1 duration-300 ease-out",
        className,
      )}
      data-testid="success-moment"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
        >
          <NavIcon name="checkmark" size={16} />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold leading-tight">{headline}</h3>
          {subtitle ? (
            <div className="mt-1.5 text-sm text-muted-foreground">{subtitle}</div>
          ) : null}
          {(primaryAction || secondaryAction) && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {primaryAction
                ? renderAction(primaryAction, "default")
                : null}
              {secondaryAction
                ? renderAction(secondaryAction, "outline")
                : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function renderAction(
  action: SuccessMomentAction,
  variant: "default" | "outline",
) {
  if (action.href) {
    return (
      <Button asChild variant={variant} size="sm">
        <a
          href={action.href}
          {...(action.external
            ? { target: "_blank", rel: "noreferrer" }
            : {})}
        >
          {action.label}
        </a>
      </Button>
    );
  }
  return (
    <Button type="button" variant={variant} size="sm" onClick={action.onClick}>
      {action.label}
    </Button>
  );
}
