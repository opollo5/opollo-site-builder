"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/ui/nav-icon";
import {
  filterPrimaryItems,
  filterSectionItems,
  getActiveSectionKey,
  primaryNavItems,
  type NavUserContext,
} from "./nav-config";
import { CompanySelector } from "./company-selector";
import { SiteSelector } from "./site-selector";

// ---------------------------------------------------------------------------
// Section Nav — secondary panel, ~220px wide, conditionally visible.
// Appears when the active primary section has sub-items.
// Collapsible via toggle button; state persisted in cookie.
// Active item uses background + font-weight only — no accent bar, no
// text-color shift, per the two-level-nav spec.
// ---------------------------------------------------------------------------

// Re-export so existing callers (NavShellClient) keep working. Source of
// truth for both nav cookies is `nav-shell-cookies.ts` so server components
// can import them without crossing the "use client" boundary.
export { SECTION_NAV_COLLAPSED_COOKIE } from "./nav-shell-cookies";

interface SectionNavProps {
  navContext: NavUserContext;
  collapsed: boolean;
  onToggle: () => void;
}

export function SectionNav({ navContext, collapsed, onToggle }: SectionNavProps) {
  const pathname = usePathname();
  const visiblePrimaryItems = filterPrimaryItems(primaryNavItems, navContext);
  const activeSectionKey = getActiveSectionKey(pathname, visiblePrimaryItems);
  const activeItem = visiblePrimaryItems.find((i) => i.key === activeSectionKey);

  if (!activeItem?.sectionNav) {
    return null;
  }

  const { title, showCompanySelector, showSiteSelector, siteIdSegment, siteSelectPath, groups } =
    activeItem.sectionNav;

  // Extract the active siteId from the URL when this section is site-scoped.
  const siteId: string | null =
    showSiteSelector && siteIdSegment !== undefined
      ? (pathname.split("/")[siteIdSegment] ?? null) || null
      : null;

  // Replace the {siteId} token in item hrefs with the extracted siteId.
  // If no siteId yet, the href is left as-is (will resolve to the entry-point
  // empty state when clicked, which prompts the user to pick a site first).
  function resolveHref(href: string): string {
    return siteId ? href.replace("{siteId}", siteId) : href.replace("/{siteId}", "").replace("{siteId}", "");
  }

  function isItemActive(href: string): boolean {
    const resolved = resolveHref(href);
    return pathname === resolved || pathname.startsWith(resolved + "/");
  }

  if (collapsed) {
    return (
      <aside
        data-testid="section-nav"
        aria-label={`${title} navigation`}
        className="flex w-6 shrink-0 flex-col border-r border-border bg-background"
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Expand ${title} navigation`}
          className="mx-auto mt-3 flex h-6 w-5 items-center justify-center rounded-sm text-tx-secondary hover:bg-nav-hover hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
        >
          <NavIcon name="chevron-right" size={12} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      data-testid="section-nav"
      aria-label={`${title} navigation`}
      className="flex w-[220px] shrink-0 flex-col border-r border-border bg-background overflow-y-auto"
    >
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <span
          data-testid="section-nav-title"
          className="text-sm font-semibold text-foreground"
        >
          {title}
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Collapse ${title} navigation`}
          className="flex h-6 w-6 items-center justify-center rounded-sm text-tx-secondary hover:bg-nav-hover hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
        >
          <NavIcon name="chevron-left" size={12} />
        </button>
      </div>

      {showCompanySelector && (
        <div className="border-b border-border py-1">
          <CompanySelector
            isOpolloStaff={navContext.isOpolloStaff}
            companyId={navContext.companyId}
            companyName={navContext.companyName}
          />
        </div>
      )}

      {showSiteSelector && siteSelectPath && (
        <div className="border-b border-border py-1">
          <SiteSelector
            currentSiteId={siteId}
            currentSiteName={null}
            siteSelectPath={siteSelectPath}
          />
        </div>
      )}

      <nav className="flex-1 p-3">
        {groups.map((group, gi) => {
          const visibleItems = filterSectionItems(group.items, navContext);
          if (visibleItems.length === 0) return null;

          return (
            <div key={gi} className={cn(gi > 0 && "mt-4")}>
              {group.label && (
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-tx-muted">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {visibleItems.map((item) => {
                  const resolved = resolveHref(item.href);
                  const active = isItemActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={resolved}
                        data-testid={item.testId}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "block rounded-md px-3 py-1.5 text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-gr",
                          active
                            ? "bg-nav-active font-medium text-foreground"
                            : "text-tx-secondary hover:bg-nav-hover hover:text-gr",
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
