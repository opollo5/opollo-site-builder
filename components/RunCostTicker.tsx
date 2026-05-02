"use client";

import { useEffect, useRef, useState } from "react";
import { Info, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { BriefPageRow } from "@/lib/briefs";

// ---------------------------------------------------------------------------
// RS-6 — floating cost ticker.
//
// Replaces the in-flow cost card with a sticky bottom-right (desktop) /
// bottom-bar (mobile) widget that stays visible across the run-surface
// scroll. The big number is the operator's primary signal — "is the
// run still costing me money?" — so it surfaces immediately on every
// snapshot tick (RS-4 polling already drives this).
//
// Click expands a "Run details" panel with per-page cost breakdown +
// the model strings that previously cluttered the inline cost card.
//
// Stacking: z-40, deliberately below the RS-0 Dialog (z-50) so any
// open modal paints over the ticker rather than the ticker poking
// through a translucent backdrop. If a future floating affordance
// (e.g. command palette, toast stack) needs to sit above the ticker
// but below modals, use z-40..49.
// ---------------------------------------------------------------------------

const COUNT_UP_MS = 600;

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface RunCostTickerProps {
  estimateCents: number;
  remainingBudgetCents: number;
  spentCents: number;
  pages: BriefPageRow[];
  textModel: string | null;
  visualModel: string | null;
}

// Smooth count-up animation that snaps to the target value within
// COUNT_UP_MS. Returns the currently-displayed cents.
function useAnimatedCount(target: number, durationMs: number): number {
  const [displayed, setDisplayed] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === displayed) return;
    fromRef.current = displayed;
    startRef.current = null;

    function step(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      // Ease-out cubic: matches the `transition-smooth` token feel.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(
        fromRef.current + (target - fromRef.current) * eased,
      );
      setDisplayed(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // displayed intentionally excluded — we only restart the animation
    // when the externally-driven target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return displayed;
}

export function RunCostTicker({
  estimateCents,
  remainingBudgetCents,
  spentCents,
  pages,
  textModel,
  visualModel,
}: RunCostTickerProps) {
  const [expanded, setExpanded] = useState(false);
  const animatedSpent = useAnimatedCount(spentCents, COUNT_UP_MS);

  return (
    <div
      className={cn(
        "fixed z-40 transition-smooth",
        // Mobile: full-width bottom ribbon. Desktop: bottom-right corner card.
        "inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-4 sm:right-4",
      )}
      role="region"
      aria-label="Run cost"
    >
      <div
        className={cn(
          "border-t bg-background shadow-lg sm:rounded-lg sm:border",
          expanded ? "max-h-[60vh] overflow-y-auto" : "",
        )}
      >
        <div className="flex items-center justify-between gap-3 p-3 sm:min-w-[280px]">
          <div className="flex items-baseline gap-2">
            <span className="text-sm uppercase tracking-wide text-muted-foreground">
              Run cost
            </span>
            <span
              className="font-mono text-lg font-semibold"
              data-testid="run-cost-ticker-spent"
            >
              {centsToUsd(animatedSpent)}
            </span>
            <span className="text-sm text-muted-foreground">
              of {centsToUsd(estimateCents)} est
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="run-cost-details"
            // h-11 w-11 = 44×44 tap target (mobile floor).
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md",
              "text-muted-foreground hover:bg-muted hover:text-foreground",
              "focus:outline-none focus:ring-2 focus:ring-ring",
              "transition-smooth",
            )}
          >
            {expanded ? (
              <X aria-hidden className="h-5 w-5" />
            ) : (
              <Info aria-hidden className="h-5 w-5" />
            )}
            <span className="sr-only">
              {expanded ? "Close run details" : "Open run details"}
            </span>
          </button>
        </div>

        {expanded && (
          <div
            id="run-cost-details"
            className="border-t px-3 pb-3 pt-2 text-sm"
          >
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Remaining this month</dt>
              <dd className="text-right font-mono">
                {centsToUsd(remainingBudgetCents)}
              </dd>
              <dt className="text-muted-foreground">Estimate</dt>
              <dd className="text-right font-mono">
                {centsToUsd(estimateCents)}
              </dd>
              <dt className="text-muted-foreground">Pages</dt>
              <dd className="text-right">{pages.length}</dd>
              <dt className="text-muted-foreground">Text model</dt>
              <dd className="text-right break-all font-mono text-[10px]">
                {textModel ?? "—"}
              </dd>
              <dt className="text-muted-foreground">Visual model</dt>
              <dd className="text-right break-all font-mono text-[10px]">
                {visualModel ?? "—"}
              </dd>
            </dl>

            {pages.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Per-page breakdown
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {[...pages]
                    .sort((a, b) => a.ordinal - b.ordinal)
                    .map((page) => (
                      <li key={page.id} className="flex justify-between gap-2">
                        <span className="truncate">
                          {page.ordinal + 1}. {page.title}
                        </span>
                        <span className="shrink-0 font-mono">
                          {centsToUsd(Number(page.page_cost_cents ?? 0))}
                        </span>
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
