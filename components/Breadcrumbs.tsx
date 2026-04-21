import Link from "next/link";

// Shared breadcrumb trail for admin detail pages. Each page passes
// its own crumbs; last one is the current page and renders without
// a link.

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {c.href && !isLast ? (
              <Link
                href={c.href}
                className="text-muted-foreground hover:text-foreground"
              >
                {c.label}
              </Link>
            ) : (
              <span
                className={
                  isLast ? "text-foreground" : "text-muted-foreground"
                }
              >
                {c.label}
              </span>
            )}
            {!isLast && (
              <span aria-hidden="true" className="text-muted-foreground">
                ›
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
