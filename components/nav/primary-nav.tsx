"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/ui/nav-icon";
import {
  bottomNavItems,
  filterPrimaryItems,
  primaryNavItems,
  type NavUserContext,
  type PrimaryNavItem,
} from "./nav-config";

// ---------------------------------------------------------------------------
// Primary Nav — left rail, always visible at 70px on desktop.
// Icon stacked above label. Active item uses a single subtle background
// tint (bg-nav-active) — no border, no text-color shift, no other signal.
// Mobile: shown as part of the off-canvas drawer managed by NavShellClient.
// ---------------------------------------------------------------------------

interface PrimaryNavProps {
  navContext: NavUserContext;
  activeSectionKey: string | null;
  onSectionNavToggle: (key: string) => void;
  isSectionNavVisible: boolean;
  mobile?: boolean;
  onMobileNavItemClick?: () => void;
}

export function PrimaryNav({
  navContext,
  activeSectionKey,
  onSectionNavToggle,
  mobile = false,
  onMobileNavItemClick,
}: PrimaryNavProps) {
  const visibleItems = filterPrimaryItems(primaryNavItems, navContext);
  const hasUser = !!navContext.email;

  function NavItem({ item }: { item: PrimaryNavItem }) {
    const isActive = item.key === activeSectionKey;
    const hasSectionNav = item.sectionNav !== null;

    const itemClass = cn(
      "group flex w-full flex-col items-center gap-1 rounded-md px-1 py-3 transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-gr",
      isActive
        ? "bg-nav-active text-foreground"
        : "text-m2 hover:bg-nav-hover hover:text-gr",
    );

    const iconClass = cn(
      isActive ? "text-foreground" : "text-icon-dim group-hover:text-gr",
    );
    const labelClass = "w-full truncate text-center leading-none text-xs font-medium";

    if (hasSectionNav) {
      return (
        <li>
          <button
            type="button"
            data-testid={item.testId}
            aria-current={isActive ? "page" : undefined}
            title={item.label}
            onClick={() => {
              onSectionNavToggle(item.key);
              onMobileNavItemClick?.();
            }}
            className={itemClass}
          >
            <NavIcon name={item.icon} size={20} className={iconClass} />
            <span className={labelClass}>{item.label}</span>
          </button>
        </li>
      );
    }

    return (
      <li>
        <Link
          href={item.href}
          data-testid={item.testId}
          aria-current={isActive ? "page" : undefined}
          title={item.label}
          onClick={onMobileNavItemClick}
          className={itemClass}
        >
          <NavIcon name={item.icon} size={20} className={iconClass} />
          <span className={labelClass}>{item.label}</span>
        </Link>
      </li>
    );
  }

  return (
    <nav
      data-testid="primary-nav"
      aria-label="Primary navigation"
      className={cn(
        "flex flex-col border-r border-border bg-[linear-gradient(180deg,var(--d1)_0%,var(--bg)_100%)]",
        mobile ? "w-full" : "w-[70px] shrink-0",
      )}
    >
      {/* Round Opollo logo — fixed 36×36 in the rail header */}
      <div
        className={cn(
          "flex items-center justify-center border-b border-border",
          mobile ? "h-14 px-4 justify-start" : "h-14",
        )}
      >
        <Link
          href="/admin/sites"
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
          onClick={onMobileNavItemClick}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/opollo-icon.png"
            alt="Opollo"
            width={36}
            height={36}
            className="h-9 w-9"
          />
        </Link>
      </div>

      {/* Primary items */}
      <ul
        className={cn(
          "flex-1 overflow-y-auto p-1.5 space-y-0.5",
          mobile && "flex-row flex flex-wrap gap-1 p-3 space-y-0",
        )}
      >
        {visibleItems.map((item) => (
          <NavItem key={item.key} item={item} />
        ))}
      </ul>

      {/* Footer rail — visual separator + ⌘K and Sign out only */}
      {!mobile && (
        <div className="border-t border-border p-1.5 space-y-0.5">
          {bottomNavItems.map((item) => {
            if (item.requiresUser && !hasUser) return null;

            if (item.kind === "cmdpalette") {
              return (
                <div
                  key={item.key}
                  title="Command palette (⌘K)"
                  className="flex flex-col items-center gap-1 rounded-md px-1 py-2 text-m3"
                >
                  <NavIcon name={item.icon} size={20} className="text-icon-dim" />
                  <span className="text-xs font-mono leading-none">⌘K</span>
                </div>
              );
            }

            if (item.kind === "signout") {
              return (
                <form key={item.key} action="/logout" method="POST">
                  <button
                    type="submit"
                    title="Sign out"
                    data-testid={item.testId}
                    className="group flex w-full flex-col items-center gap-1 rounded-md px-1 py-2 transition-smooth text-destructive hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
                  >
                    <NavIcon name={item.icon} size={20} className="shrink-0" />
                    <span className="text-xs font-medium leading-none truncate w-full text-center">
                      {item.label}
                    </span>
                  </button>
                </form>
              );
            }

            return null;
          })}

          {/* Email truncated at very bottom */}
          {navContext.email && (
            <p
              className="mt-1 truncate border-t border-border pt-1.5 px-1 text-xs text-m3 text-center"
              title={navContext.email}
            >
              {navContext.email}
            </p>
          )}
        </div>
      )}
    </nav>
  );
}
