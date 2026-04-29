"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsLeft,
  ChevronsRight,
  Globe,
  Image as ImageIcon,
  KeyRound,
  LogOut,
  Menu,
  Settings,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

import type { SessionUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// R1-1 — Sidebar navigation chrome.
//
// Replaces the AdminNav top bar with a Claude.ai / ChatGPT-style left
// rail. Pinned 240px wide on desktop; collapsible to 64px (icon-only)
// via the bottom rail's chevron toggle. Mobile (< sm): off-canvas
// drawer toggled by a top-right hamburger button on the
// in-page mobile header.
//
// Persistence:
//   - localStorage key `opollo:sidebar:collapsed` survives across
//     sessions so an operator who collapses the rail keeps the
//     denser layout on their next visit.
//   - Mobile drawer opens fresh each time (no persistence) — a
//     remembered open-state on a fresh page-load would interfere
//     with the touch-to-content focus rhythm.
// ---------------------------------------------------------------------------

const SIDEBAR_COLLAPSED_LS_KEY = "opollo:sidebar:collapsed";

type NavLink = {
  label: string;
  href: string;
  icon: LucideIcon;
  testId?: string;
};

interface AdminSidebarProps {
  user: SessionUser | null;
  showUsersLink: boolean;
}

export function AdminSidebar({ user, showUsersLink }: AdminSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_LS_KEY);
      if (raw === "1") setCollapsed(true);
    } catch {
      // localStorage disabled — stay expanded.
    }
    setHydrated(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          SIDEBAR_COLLAPSED_LS_KEY,
          next ? "1" : "0",
        );
      } catch {
        // localStorage disabled — change still applies in-memory.
      }
      return next;
    });
  }

  // Auto-close the mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const navLinks: NavLink[] = [
    { label: "Sites", href: "/admin/sites", icon: Globe, testId: "nav-sites" },
    {
      label: "Batches",
      href: "/admin/batches",
      icon: Workflow,
      testId: "nav-batches",
    },
    {
      label: "Images",
      href: "/admin/images",
      icon: ImageIcon,
      testId: "nav-images",
    },
    ...(showUsersLink
      ? [
          {
            label: "Users",
            href: "/admin/users",
            icon: Users,
            testId: "nav-users",
          },
        ]
      : []),
  ];

  function isActiveRoute(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      {/* Mobile-only top bar — hamburger + wordmark. Hidden above sm. */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur sm:hidden">
        <Link
          href="/admin/sites"
          className="text-sm font-semibold transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          Opollo
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          aria-controls="admin-sidebar"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="admin-mobile-nav-button"
        >
          <Menu aria-hidden className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile-only backdrop. Click to close. */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="opollo-fade-in fixed inset-0 z-40 bg-black/40 sm:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — pinned left on desktop, off-canvas on mobile. */}
      <aside
        id="admin-sidebar"
        aria-label="Primary"
        className={cn(
          "border-r bg-background transition-all duration-200",
          // Mobile: fixed off-canvas; slide in via translate.
          "fixed inset-y-0 left-0 z-50 w-72 shrink-0 -translate-x-full",
          mobileOpen && "translate-x-0",
          // Desktop: pinned, full-height.
          "sm:sticky sm:top-0 sm:h-screen sm:translate-x-0",
          collapsed ? "sm:w-16" : "sm:w-60",
        )}
        aria-hidden={!hydrated ? undefined : !mobileOpen ? undefined : false}
      >
        <div className="flex h-full flex-col">
          {/* Wordmark + collapse toggle (desktop) / close button (mobile) */}
          <div className="flex h-14 items-center justify-between border-b px-3">
            {!collapsed && (
              <Link
                href="/admin/sites"
                className="text-sm font-semibold transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
              >
                Opollo
              </Link>
            )}
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={
                collapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(
                "hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex",
                collapsed && "mx-auto",
              )}
            >
              {collapsed ? (
                <ChevronsRight aria-hidden className="h-4 w-4" />
              ) : (
                <ChevronsLeft aria-hidden className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Primary nav */}
          <nav className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-0.5">
              {navLinks.map(({ label, href, icon: Icon, testId }) => {
                const active = isActiveRoute(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      data-testid={testId}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? label : undefined}
                      className={cn(
                        "group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <Icon
                        aria-hidden
                        className={cn(
                          "h-4 w-4 shrink-0",
                          active
                            ? "text-foreground"
                            : "text-muted-foreground group-hover:text-foreground",
                        )}
                      />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Footer rail — ⌘K hint + user menu */}
          <div className="border-t p-2">
            {!collapsed && (
              <div className="mb-2 flex items-center justify-between rounded-md bg-muted/40 px-2 py-1.5">
                <span className="text-xs text-muted-foreground">
                  Command palette
                </span>
                <span
                  className="flex items-center gap-0.5 text-xs text-muted-foreground"
                  aria-hidden
                >
                  <kbd className="rounded border bg-background px-1 font-mono text-[10px]">
                    ⌘
                  </kbd>
                  <kbd className="rounded border bg-background px-1 font-mono text-[10px]">
                    K
                  </kbd>
                </span>
              </div>
            )}
            {user && (
              <Link
                href="/account/security"
                title={collapsed ? "Account security" : undefined}
                className={cn(
                  "group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground transition-smooth hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActiveRoute("/account/security") &&
                    "bg-muted font-medium text-foreground",
                )}
                data-testid="nav-security"
              >
                <KeyRound aria-hidden className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <span className="truncate">Account security</span>
                )}
              </Link>
            )}
            <Link
              href="/"
              title={collapsed ? "Back to builder" : undefined}
              className="group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground transition-smooth hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="nav-back-to-builder"
            >
              <Settings aria-hidden className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">Back to builder</span>}
            </Link>
            {user && (
              <form action="/logout" method="POST">
                <button
                  type="submit"
                  title={collapsed ? "Sign out" : undefined}
                  className="group flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm text-destructive transition-smooth hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="nav-sign-out"
                >
                  <LogOut aria-hidden className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">Sign out</span>}
                </button>
              </form>
            )}
            {user && !collapsed && (
              <p
                className="mt-2 truncate border-t pt-2 px-2.5 text-[11px] text-muted-foreground"
                title={user.email}
              >
                {user.email}
              </p>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
