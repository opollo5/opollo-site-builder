"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";
import { NavIcon } from "@/components/ui/nav-icon";
import {
  bottomNavItems,
  filterPrimaryItems,
  primaryNavItems,
  type NavUserContext,
  type PrimaryNavItem,
} from "./nav-config";

// ---------------------------------------------------------------------------
// Primary Nav — left rail. Two-state desktop:
//   • Expanded: 112px, icon stacked over full-text label.
//   • Collapsed: 64px, icon only; full label appears as a native title
//     tooltip on hover.
// Active item uses bg-nav-active only (no border, text-color shift, etc.).
// Mobile: rendered through the off-canvas drawer in NavShellClient.
// ---------------------------------------------------------------------------

interface PrimaryNavProps {
  navContext: NavUserContext;
  activeSectionKey: string | null;
  onSectionNavToggle: (key: string) => void;
  isSectionNavVisible: boolean;
  mobile?: boolean;
  onMobileNavItemClick?: () => void;
  /** Desktop collapse state. Hides labels, renders icons only. */
  collapsed?: boolean;
  /** Toggle handler — renders the chevron button when provided. */
  onCollapseToggle?: () => void;
}

export function PrimaryNav({
  navContext,
  activeSectionKey,
  onSectionNavToggle,
  mobile = false,
  onMobileNavItemClick,
  collapsed = false,
  onCollapseToggle,
}: PrimaryNavProps) {
  const visibleItems = filterPrimaryItems(primaryNavItems, navContext);
  const hasUser = !!navContext.email;

  function NavItem({ item }: { item: PrimaryNavItem }) {
    const isActive = item.key === activeSectionKey;
    const hasSectionNav = item.sectionNav !== null;

    const itemClass = cn(
      "group flex w-full items-center rounded-md transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-gr",
      collapsed
        ? "justify-center px-1 py-2.5"
        : "flex-col gap-1 px-1 py-3",
      isActive
        ? "bg-nav-active text-foreground"
        : "text-tx-secondary hover:bg-nav-hover hover:text-gr",
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
            {!collapsed && <span className={labelClass}>{item.label}</span>}
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
          {!collapsed && <span className={labelClass}>{item.label}</span>}
        </Link>
      </li>
    );
  }

  // Desktop width: 112px expanded, 64px collapsed. Mobile drawer is full-width.
  // Width transitions are intentional — section nav + content shift in lockstep.
  const railWidthClass = mobile
    ? "w-full"
    : collapsed
      ? "w-[64px] shrink-0"
      : "w-[112px] shrink-0";

  return (
    <nav
      data-testid="primary-nav"
      aria-label="Primary navigation"
      data-collapsed={!mobile && collapsed ? "true" : "false"}
      className={cn(
        "flex flex-col border-r border-border bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--canvas))_100%)]",
        !mobile && "transition-[width] duration-150 ease-out",
        railWidthClass,
      )}
    >
      {/* Round Opollo logo + (desktop) collapse toggle */}
      <div
        className={cn(
          "flex items-center border-b border-border",
          mobile
            ? "h-14 px-4 justify-start"
            : "h-14 justify-center",
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

      {/* Desktop-only collapse toggle, sits just below the logo bar so it's
          equally reachable in both rail widths. */}
      {!mobile && onCollapseToggle && (
        <div className="flex items-center justify-end border-b border-border px-1.5 py-1">
          <button
            type="button"
            onClick={onCollapseToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            data-testid="nav-collapse-toggle"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-tx-muted transition-smooth hover:bg-nav-hover hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
          >
            <NavIcon name={collapsed ? "chevron-right" : "chevron-left"} size={14} />
          </button>
        </div>
      )}

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
                  title="Command palette"
                  className={cn(
                    "flex items-center rounded-md px-1 py-2 text-tx-muted",
                    collapsed
                      ? "justify-center"
                      : "flex-col gap-1",
                  )}
                >
                  <NavIcon name={item.icon} size={20} className="text-icon-dim" />
                  {!collapsed && (
                    <Kbd keys={["mod", "K"]} className="border-0 bg-transparent px-0 py-0 text-xs leading-none" />
                  )}
                </div>
              );
            }

            if (item.kind === "signout") {
              return (
                <form key={item.key} action="/logout" method="POST">
                  <button
                    type="submit"
                    title={item.label}
                    data-testid={item.testId}
                    className={cn(
                      "group flex w-full items-center rounded-md px-1 py-2 transition-smooth text-destructive hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gr",
                      collapsed
                        ? "justify-center"
                        : "flex-col gap-1",
                    )}
                  >
                    <NavIcon name={item.icon} size={20} className="shrink-0" />
                    {!collapsed && (
                      <span className="text-xs font-medium leading-none truncate w-full text-center">
                        {item.label}
                      </span>
                    )}
                  </button>
                </form>
              );
            }

            return null;
          })}

          {/* Email truncated at very bottom — hidden when collapsed (no room) */}
          {!collapsed && navContext.email && (
            <p
              className="mt-1 truncate border-t border-border pt-1.5 px-1 text-xs text-tx-muted text-center"
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
