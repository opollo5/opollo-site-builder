import * as React from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A-5 — Skeleton + loading-shell primitives.
//
// Five exports cover every loading shape on an admin surface:
//
//   <Skeleton />                base block — tall divs of muted bg
//                                with the .opollo-shimmer sweep.
//   <SkeletonText lines={N} />  text-line stack with each line at the
//                                canonical body-text height.
//   <TableSkeleton rows cols /> mimics the Tailwind table shape used
//                                across admin lists (border + thead).
//   <CardSkeleton />            mimics the rounded-lg border p-4 card
//                                used in posts list / runs list.
//   <DefinitionListSkeleton />  mimics the dl grid used on detail
//                                sidebars (image / page / batch detail).
//
// Density bias: rows/cards are sized so the skeleton occupies the same
// vertical space the real content will, preventing layout shift when
// the skeleton swaps for the data. This is the difference between a
// "loading state" and a "loading state that doesn't suck."
// ---------------------------------------------------------------------------

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  function Skeleton({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        // .opollo-shimmer carries the gradient-sweep keyframe + sets
        // the muted background. Reduced-motion zeroes the animation
        // and pins the bg to the muted token (RS-0 / A-3 contract).
        className={cn("opollo-shimmer rounded", className)}
        aria-hidden="true"
        {...props}
      />
    );
  },
);

// ---------------------------------------------------------------------------

export interface SkeletonTextProps {
  lines?: number;
  /** Width of the LAST line (others are full-width). Mimics paragraph end-of-line ragging. */
  lastLineWidth?: "1/2" | "2/3" | "3/4" | "full";
  className?: string;
}

const LAST_LINE_WIDTH_CLASS: Record<
  NonNullable<SkeletonTextProps["lastLineWidth"]>,
  string
> = {
  "1/2": "w-1/2",
  "2/3": "w-2/3",
  "3/4": "w-3/4",
  full: "w-full",
};

export function SkeletonText({
  lines = 3,
  lastLineWidth = "2/3",
  className,
}: SkeletonTextProps) {
  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      role="status"
      aria-label="Loading content"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-3.5",
            i === lines - 1 ? LAST_LINE_WIDTH_CLASS[lastLineWidth] : "w-full",
          )}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface TableSkeletonProps {
  rows?: number;
  cols?: number;
  /** Show thead bar above rows. Default true. */
  header?: boolean;
  className?: string;
}

export function TableSkeleton({
  rows = 6,
  cols = 5,
  header = true,
  className,
}: TableSkeletonProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-background",
        className,
      )}
      role="status"
      aria-label="Loading table"
    >
      {header && (
        <div className="flex gap-4 border-b bg-muted/40 px-4 py-2">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
      )}
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
                className={cn(
                  "h-4",
                  // First column rendered slightly wider — usually a
                  // title / link — to mimic real list shape.
                  c === 0 ? "flex-[2]" : "flex-1",
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface CardSkeletonProps {
  /** Number of body-text lines below the title. Default 2. */
  lines?: number;
  className?: string;
}

export function CardSkeleton({ lines = 2, className }: CardSkeletonProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-background p-4",
        className,
      )}
      role="status"
      aria-label="Loading card"
    >
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-16" />
      </div>
      <SkeletonText lines={lines} lastLineWidth="2/3" />
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface DefinitionListSkeletonProps {
  rows?: number;
  className?: string;
}

export function DefinitionListSkeleton({
  rows = 5,
  className,
}: DefinitionListSkeletonProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[max-content_1fr] gap-x-4 gap-y-3 text-sm",
        className,
      )}
      role="status"
      aria-label="Loading details"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <React.Fragment key={i}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-3/4" />
        </React.Fragment>
      ))}
    </div>
  );
}
