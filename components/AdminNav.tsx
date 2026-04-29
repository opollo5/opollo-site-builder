"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Menu, X } from "lucide-react";

import type { SessionUser } from "@/lib/auth";

// ---------------------------------------------------------------------------
// B-1 — Admin shell navigation. Sticky top, mobile-collapse, Linear-
// density. Active-link weight bumped (font-semibold + border-bottom).
// Focus rings normalized via the standard ring-ring pattern. Hover/
// focus transitions land via the .transition-smooth motion token.
// ---------------------------------------------------------------------------

type NavLink = {
  label: string;
  href: string;
  testId?: string;
};

export function AdminNav({ user, showUsersLink }: { user: SessionUser | null; showUsersLink: boolean }) {
  const pathname = usePathname();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const navLinks: NavLink[] = [
    { label: "Sites", href: "/admin/sites", testId: "nav-sites" },
    { label: "Batches", href: "/admin/batches", testId: "nav-batches" },
    { label: "Images", href: "/admin/images", testId: "nav-images" },
    ...(showUsersLink ? [{ label: "Users", href: "/admin/users", testId: "nav-users" }] : []),
  ];

  function isActiveRoute(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  // Close the user menu on any click outside.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }

    if (userMenuOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [userMenuOpen]);

  // Close the mobile nav on route change so an in-app navigation
  // doesn't leave the disclosure stuck open.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Escape closes whichever disclosure is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (userMenuOpen) setUserMenuOpen(false);
      if (mobileNavOpen) setMobileNavOpen(false);
    }
    if (userMenuOpen || mobileNavOpen) {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [userMenuOpen, mobileNavOpen]);

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
        {/* Left: logo + (desktop) primary nav */}
        <div className="flex items-center gap-6">
          <Link
            href="/admin/sites"
            className="text-sm font-semibold whitespace-nowrap transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          >
            Opollo
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary">
            {navLinks.map(({ label, href, testId }) => {
              const active = isActiveRoute(href);
              return (
                <Link
                  key={href}
                  href={href}
                  data-testid={testId}
                  aria-current={active ? "page" : undefined}
                  className={`relative h-14 inline-flex items-center px-3 text-xs font-medium whitespace-nowrap transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                    active
                      ? "text-foreground font-semibold after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: mobile-nav button + user menu */}
        <div className="flex items-center gap-2">
          {/* Mobile-only hamburger */}
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileNavOpen}
            aria-controls="admin-mobile-nav"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
            data-testid="admin-mobile-nav-button"
          >
            {mobileNavOpen ? (
              <X aria-hidden className="h-5 w-5" />
            ) : (
              <Menu aria-hidden className="h-5 w-5" />
            )}
          </button>

          {/* User menu (desktop + mobile) */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-xs text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="User menu"
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              data-testid="admin-user-menu-button"
            >
              <span className="hidden max-w-[180px] truncate sm:inline">
                {user?.email ?? "Admin"}
              </span>
              <ChevronDown
                aria-hidden
                className={`h-4 w-4 transition-transform ${userMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {userMenuOpen && (
              <div
                className="opollo-fade-in absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg"
                role="menu"
              >
                {user && (
                  <div className="border-b px-3 py-2 text-xs text-muted-foreground">
                    Signed in as
                    <div className="mt-0.5 truncate font-medium text-foreground">
                      {user.email}
                    </div>
                  </div>
                )}
                {user && (
                  <Link
                    href="/account/security"
                    className="block px-3 py-2 text-xs transition-smooth hover:bg-muted"
                    onClick={() => setUserMenuOpen(false)}
                    data-testid="nav-security"
                    role="menuitem"
                  >
                    Security
                  </Link>
                )}
                <Link
                  href="/"
                  className="block px-3 py-2 text-xs transition-smooth hover:bg-muted"
                  onClick={() => setUserMenuOpen(false)}
                  data-testid="nav-back-to-builder"
                  role="menuitem"
                >
                  ← Back to builder
                </Link>
                {user && (
                  <form action="/logout" method="POST" className="border-t">
                    <button
                      type="submit"
                      className="block w-full px-3 py-2 text-left text-xs text-destructive transition-smooth hover:bg-destructive/10"
                      data-testid="nav-sign-out"
                      role="menuitem"
                    >
                      Sign out
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile-only nav disclosure */}
      {mobileNavOpen && (
        <nav
          id="admin-mobile-nav"
          className="opollo-fade-in border-t sm:hidden"
          aria-label="Primary (mobile)"
        >
          <ul className="flex flex-col p-2">
            {navLinks.map(({ label, href, testId }) => {
              const active = isActiveRoute(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    data-testid={`${testId}-mobile`}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-11 items-center rounded-md px-3 text-sm transition-smooth ${
                      active
                        ? "bg-muted font-semibold text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
