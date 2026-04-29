import Link from "next/link";
import { ChevronRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Shared breadcrumb trail. Last crumb is the current page (renders as
// plain bold text, no link). B-1 swaps the `›` glyph for ChevronRight
// + bumps the active-crumb weight to font-medium for slight separation.
// ---------------------------------------------------------------------------

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1.5 text-xs"
    >
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {c.href && !isLast ? (
              <Link
                href={c.href}
                className="text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
              >
                {c.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? "page" : undefined}
                className={
                  isLast
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                }
              >
                {c.label}
              </span>
            )}
            {!isLast && (
              <ChevronRight
                aria-hidden
                className="h-3 w-3 text-muted-foreground/60"
              />
            )}
          </span>
        );
      })}
    </nav>
  );
}
