"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  filterPrimaryItems,
  filterSectionItems,
  getActiveSectionKey,
  primaryNavItems,
  type NavUserContext,
} from "./nav-config";
import { CompanySelector } from "./company-selector";

// ---------------------------------------------------------------------------
// Section Nav — secondary panel, ~220px wide, conditionally visible.
// Appears when the active primary section has sub-items.
// Collapsible via toggle button; state persisted in cookie.
// ---------------------------------------------------------------------------

export const SECTION_NAV_COLLAPSED_COOKIE = "opollo_section_nav_collapsed";

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

  // No section nav for this section
  if (!activeItem?.sectionNav) {
    return null;
  }

  const { title, showCompanySelector, groups } = activeItem.sectionNav;

  function isItemActive(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  // When collapsed: a 24px sliver with just the expand toggle
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
          className="mx-auto mt-3 flex h-6 w-5 items-center justify-center rounded-sm text-m2 hover:bg-nav-hover hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
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
      {/* Header: title + collapse toggle */}
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
          className="flex h-6 w-6 items-center justify-center rounded-sm text-m2 hover:bg-nav-hover hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {/* Company selector (Social section, Opollo staff only) */}
      {showCompanySelector && (
        <div className="border-b border-border py-1">
          <CompanySelector
            isOpolloStaff={navContext.isOpolloStaff}
            companyId={navContext.companyId}
            companyName={navContext.companyName}
          />
        </div>
      )}

      {/* Navigation groups */}
      <nav className="flex-1 p-3">
        {groups.map((group, gi) => {
          const visibleItems = filterSectionItems(group.items, navContext);
          if (visibleItems.length === 0) return null;

          return (
            <div key={gi} className={cn(gi > 0 && "mt-4")}>
              {group.label && (
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-m3">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {visibleItems.map((item) => {
                  const active = isItemActive(item.href);
                  return (
                    <li key={item.href} className="relative">
                      {active && (
                        <span
                          aria-hidden
                          className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-pk"
                        />
                      )}
                      <Link
                        href={item.href}
                        data-testid={item.testId}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "block rounded-md px-3 py-1.5 text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-gr",
                          active
                            ? "bg-nav-active text-pk font-medium"
                            : "text-m2 hover:bg-nav-hover hover:text-gr",
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
