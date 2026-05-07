"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/ui/nav-icon";
import { PrimaryNav } from "./primary-nav";
import { SectionNav, SECTION_NAV_COLLAPSED_COOKIE } from "./section-nav";
import {
  filterPrimaryItems,
  filterSectionItems,
  getActiveSectionKey,
  primaryNavItems,
  type NavUserContext,
} from "./nav-config";

// ---------------------------------------------------------------------------
// NavShellClient — manages mobile drawer + section-nav collapse state.
// Rendered by the server NavShell; receives children as a prop (RSC pattern).
// ---------------------------------------------------------------------------

const SECTION_NAV_LS_KEY = "opollo:section-nav:collapsed";

function persistSectionNavCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(SECTION_NAV_LS_KEY, next ? "1" : "0");
  } catch {
    /* localStorage disabled */
  }
  try {
    document.cookie = `${SECTION_NAV_COLLAPSED_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    /* cookieless context */
  }
}

interface NavShellClientProps {
  children: React.ReactNode;
  navContext: NavUserContext;
  initialSectionNavCollapsed: boolean;
  skipToId: string;
  contentMaxWidth: string;
  contentPadding: string;
}

export function NavShellClient({
  children,
  navContext,
  initialSectionNavCollapsed,
  skipToId,
  contentMaxWidth,
  contentPadding,
}: NavShellClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sectionNavCollapsed, setSectionNavCollapsed] = useState(
    initialSectionNavCollapsed,
  );

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const visiblePrimaryItems = filterPrimaryItems(primaryNavItems, navContext);
  const activeSectionKey = getActiveSectionKey(pathname, visiblePrimaryItems);
  const activeItem = visiblePrimaryItems.find((i) => i.key === activeSectionKey);
  const hasSectionNav = !!activeItem?.sectionNav;

  function handleSectionNavToggle(sectionKey: string) {
    const item = visiblePrimaryItems.find((i) => i.key === sectionKey);
    if (!item) return;

    if (sectionKey !== activeSectionKey) {
      router.push(item.href);
      setSectionNavCollapsed(false);
      return;
    }

    setSectionNavCollapsed((prev) => {
      const next = !prev;
      persistSectionNavCollapsed(next);
      return next;
    });
  }

  function handleCollapseToggle() {
    setSectionNavCollapsed((prev) => {
      const next = !prev;
      persistSectionNavCollapsed(next);
      return next;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-foreground">
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-topbar px-4 backdrop-blur-[18px] sm:hidden">
        <Link
          href="/admin/sites"
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/opollo-icon.png"
            alt="Opollo"
            width={32}
            height={32}
            className="h-8 w-8"
          />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-m2 transition-smooth hover:bg-b1 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
          data-testid="mobile-nav-button"
        >
          <NavIcon name="menu" size={20} />
        </button>
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/60 sm:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 flex-col border-r border-border bg-[linear-gradient(180deg,var(--d1)_0%,var(--bg)_100%)] sm:hidden transition-transform duration-200",
          mobileOpen ? "flex translate-x-0" : "-translate-x-full flex",
        )}
        hidden={!mobileOpen}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <Link
            href="/admin/sites"
            onClick={() => setMobileOpen(false)}
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/opollo-icon.png"
              alt="Opollo"
              width={32}
              height={32}
              className="h-8 w-8"
            />
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-m2 hover:bg-b1 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
          >
            <NavIcon name="cross" size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <MobileNavContent
            navContext={navContext}
            onClose={() => setMobileOpen(false)}
          />
        </div>
      </div>

      {/* Desktop nav panels (hidden on mobile) */}
      <div className="hidden sm:flex shrink-0 h-full">
        <PrimaryNav
          navContext={navContext}
          activeSectionKey={activeSectionKey}
          onSectionNavToggle={handleSectionNavToggle}
          isSectionNavVisible={hasSectionNav && !sectionNavCollapsed}
        />

        {hasSectionNav && (
          <SectionNav
            navContext={navContext}
            collapsed={sectionNavCollapsed}
            onToggle={handleCollapseToggle}
          />
        )}
      </div>

      {/* Content column — single render for both desktop and mobile */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div aria-hidden className="h-14 shrink-0 sm:hidden" />
        <main
          id={skipToId}
          tabIndex={-1}
          className={cn(
            "flex-1 overflow-auto scroll-mt-4 focus:outline-none",
            contentPadding,
          )}
        >
          <div className={cn("mx-auto", `max-w-${contentMaxWidth}`)}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function MobileNavContent({
  navContext,
  onClose,
}: {
  navContext: NavUserContext;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const visiblePrimaryItems = filterPrimaryItems(primaryNavItems, navContext);
  const activeSectionKey = getActiveSectionKey(pathname, visiblePrimaryItems);
  const [expandedKey, setExpandedKey] = useState<string | null>(activeSectionKey);

  function isItemActive(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <ul className="space-y-0.5">
      {visiblePrimaryItems.map((item) => {
        const isActive = item.key === activeSectionKey;
        const isExpanded = expandedKey === item.key;

        if (item.sectionNav) {
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() =>
                  setExpandedKey((prev) =>
                    prev === item.key ? null : item.key,
                  )
                }
                className={cn(
                  "group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-gr",
                  isActive
                    ? "bg-nav-active font-medium text-foreground"
                    : "text-m2 hover:bg-nav-hover hover:text-gr",
                )}
              >
                <NavIcon
                  name={item.icon}
                  size={16}
                  className={cn(
                    "shrink-0",
                    isActive ? "text-foreground" : "text-icon-dim group-hover:text-gr",
                  )}
                />
                <span className="flex-1 text-left">{item.label}</span>
                <span className={cn("text-xs", isExpanded ? "rotate-180 inline-block" : "")} aria-hidden>
                  ▾
                </span>
              </button>

              {isExpanded && (
                <ul className="ml-7 mt-0.5 space-y-0.5 border-l border-border pl-3">
                  {item.sectionNav.groups.map((group, gi) => (
                    <li key={gi}>
                      {group.label && (
                        <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-m3">
                          {group.label}
                        </p>
                      )}
                      <ul className="space-y-0.5">
                        {filterSectionItems(group.items, navContext).map((subItem) => {
                          const subActive = isItemActive(subItem.href);
                          return (
                            <li key={subItem.href}>
                              <Link
                                href={subItem.href}
                                onClick={onClose}
                                className={cn(
                                  "block rounded-md px-2 py-1.5 text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-gr",
                                  subActive
                                    ? "font-medium text-foreground"
                                    : "text-m2 hover:text-gr",
                                )}
                              >
                                {subItem.label}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        }

        return (
          <li key={item.key}>
            <Link
              href={item.href}
              onClick={onClose}
              className={cn(
                "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-gr",
                isActive
                  ? "bg-nav-active font-medium text-foreground"
                  : "text-m2 hover:bg-nav-hover hover:text-gr",
              )}
            >
              <NavIcon
                name={item.icon}
                size={16}
                className={cn(
                  "shrink-0",
                  isActive ? "text-foreground" : "text-icon-dim group-hover:text-gr",
                )}
              />
              {item.label}
            </Link>
          </li>
        );
      })}

      {navContext.email && (
        <li className="mt-2 border-t border-border pt-2">
          <form action="/logout" method="POST">
            <button
              type="submit"
              data-testid="nav-sign-out"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
            >
              Sign out
            </button>
          </form>
        </li>
      )}
    </ul>
  );
}
