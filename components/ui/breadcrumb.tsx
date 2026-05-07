import Link from "next/link";

import { NavIcon } from "@/components/ui/nav-icon";
import { cn } from "@/lib/utils";

// Spec 02 §1.2 — standalone Breadcrumb primitive.
//
// PageHeader.Breadcrumb is a thin wrapper around this. Exported
// separately so non-PageHeader callers (modals, drill-down panels)
// can render the same trail without pulling the full header layout.
//
// Mobile collapse rule (locked, no JS measurement):
//   - viewport < 640px AND segments.length > 2 → render
//     `First › … › Last`. Implemented as `sm:hidden` for the
//     ellipsis + `hidden sm:inline-flex` for the middle segments.
//   - viewport ≥ 640px → all segments render.
//
// Don't reach for JS overflow detection — pure CSS can't truly
// measure semantic overflow, and the JS path adds re-layout churn
// for marginal benefit. The locked rule covers the operator-typical
// 5-deep navigation depth fine.

export type BreadcrumbSegment = { label: string; href?: string };

export interface BreadcrumbProps {
  segments: BreadcrumbSegment[];
  className?: string;
}

/**
 * Pure helper exposing the breadcrumb partition decisions the
 * component makes. Exposed for vitest coverage without React-DOM.
 * Returns:
 *   - first: the first segment (rendered always)
 *   - middle: middle segments (hidden on mobile via CSS)
 *   - last: the final segment (current page; rendered always)
 *   - showCollapse: whether ellipsis renders on small viewports
 */
export function partitionBreadcrumbSegments(
  segments: BreadcrumbSegment[],
): {
  first: BreadcrumbSegment | null;
  middle: BreadcrumbSegment[];
  last: BreadcrumbSegment | null;
  showCollapse: boolean;
} {
  if (segments.length === 0) {
    return { first: null, middle: [], last: null, showCollapse: false };
  }
  if (segments.length === 1) {
    return {
      first: segments[0],
      middle: [],
      last: null,
      showCollapse: false,
    };
  }
  return {
    first: segments[0],
    middle: segments.slice(1, -1),
    last: segments[segments.length - 1],
    showCollapse: segments.length > 2,
  };
}

export function Breadcrumb({ segments, className }: BreadcrumbProps) {
  if (segments.length === 0) return null;
  const collapsible = segments.length > 2;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const middle = collapsible ? segments.slice(1, -1) : [];

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-sm",
        className,
      )}
    >
      <BreadcrumbItem
        segment={first}
        isLast={segments.length === 1}
      />

      {/* Ellipsis only shows < 640px when there are middle segments. */}
      {collapsible && (
        <>
          <Separator className="sm:hidden" />
          <span
            className="text-muted-foreground sm:hidden"
            aria-hidden="true"
          >
            …
          </span>
        </>
      )}

      {/* Middle segments — hidden < 640px, shown ≥ 640px. */}
      {middle.map((segment, i) => (
        <span
          key={`mid-${i}`}
          className="hidden items-center gap-1.5 sm:inline-flex"
        >
          <Separator />
          <BreadcrumbItem segment={segment} isLast={false} />
        </span>
      ))}

      {segments.length > 1 && (
        <>
          <Separator />
          <BreadcrumbItem segment={last} isLast />
        </>
      )}
    </nav>
  );
}

function BreadcrumbItem({
  segment,
  isLast,
}: {
  segment: BreadcrumbSegment;
  isLast: boolean;
}) {
  if (segment.href && !isLast) {
    return (
      <Link
        href={segment.href}
        className="text-muted-foreground transition-smooth hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
      >
        {segment.label}
      </Link>
    );
  }
  return (
    <span
      aria-current={isLast ? "page" : undefined}
      className={cn(
        isLast ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {segment.label}
    </span>
  );
}

function Separator({ className }: { className?: string }) {
  return (
    <NavIcon
      name="chevron-right"
      size={16}
      className={cn("text-muted-foreground/60", className)}
    />
  );
}
